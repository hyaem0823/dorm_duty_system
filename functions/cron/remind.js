// GET /cron/remind 定时任务入口（edgeone.json schedules 每 5 分钟触发一次）
// 逻辑：北京时间到达 pushTime 且今天未推送过 → 给今日值日生推送提醒
export async function onRequest({ request, env }) {
  try {
    const kv = getKV(env);
    if (!kv) return json({ ok: false, reason: "KV 未绑定" }, 500);

    // 可选防护：设置了环境变量 CRON_KEY 时，URL 必须带 ?key=正确的值
    if (env && env.CRON_KEY) {
      const key = new URL(request.url).searchParams.get("key") || "";
      if (key !== env.CRON_KEY) return json({ ok: false, reason: "cron key 无效" }, 403);
    }

    const data = await loadData(kv);
    const bj = bjNow();
    const today = bjDate(bj);
    const s = data.settings;

    const duty = computeDuty(data, today, bj.getUTCDay());
    if (!duty.length) return json({ ok: true, pushed: false, reason: "今日无人值日" });

    if (s.lastPushDate === today) return json({ ok: true, pushed: false, reason: "今日已推送" });

    const nowHHMM = pad2(bj.getUTCHours()) + ":" + pad2(bj.getUTCMinutes());
    const pushTime = s.pushTime || "08:00";
    if (nowHHMM < pushTime) return json({ ok: true, pushed: false, reason: "未到推送时间 " + pushTime });

    const r = await pushRemind(data, duty, bj);
    const wxOK = !!(r && (r.ok === true || r.code === 1000));
    if (wxOK) {
      s.lastPushDate = today;
      s.lastPushResult = "推送成功";
      await saveData(kv, data);
    } else {
      // 保留失败信息，下一轮 5 分钟后自动重试
      s.lastPushResult = "推送失败：" + JSON.stringify(r).slice(0, 300);
      await saveData(kv, data);
    }
    return json({ ok: true, pushed: wxOK, duty, wxpusher: r });
  } catch (e) {
    return json({ ok: false, error: String((e && e.message) || e) }, 500);
  }
}

function bjNow() {
  return new Date(Date.now() + 8 * 3600 * 1000); // 用 getUTC* 读取即为北京时间
}
function pad2(n) { return String(n).padStart(2, "0"); }
function bjDate(bj) { return bj.getUTCFullYear() + "-" + pad2(bj.getUTCMonth() + 1) + "-" + pad2(bj.getUTCDate()); }

function computeDuty(data, dateStr, weekday) {
  if (data.overrides[dateStr] !== undefined) return data.overrides[dateStr];
  if (data.mode === "rotation") {
    const r = data.rotation;
    if (!r || !r.startDate || !Array.isArray(r.order) || !r.order.length) return [];
    const sp = String(r.startDate).split("-");
    const cp = String(dateStr).split("-");
    const startMs = Date.UTC(+sp[0], +sp[1] - 1, +sp[2]);
    const curMs = Date.UTC(+cp[0], +cp[1] - 1, +cp[2]);
    const days = Math.floor((curMs - startMs) / 86400000);
    if (days < 0) return [];
    return [r.order[days % r.order.length]];
  }
  return data.weekly[weekday] || [];
}

async function pushRemind(data, dutyNames, bj) {
  const s = data.settings;
  if (!s.appToken) return { ok: false, msg: "尚未配置 appToken" };
  if (s.notify === "off") return { ok: false, msg: "推送已关闭" };

  const m = bj.getUTCMonth() + 1, d = bj.getUTCDate();
  const week = "日一二三四五六"[bj.getUTCDay()];
  const content =
    "宿舍值日提醒\n" + m + "月" + d + "日 周" + week +
    "\n今日值日：" + dutyNames.join("、") + "\n请记得完成值日任务";
  const payload = {
    appToken: s.appToken,
    content,
    summary: "今日值日：" + dutyNames.join("、"),
    contentType: 1
  };
  if (s.notify === "topic") {
    const tid = Number(s.topicId);
    if (!tid) return { ok: false, msg: "未配置主题 ID" };
    payload.topicIds = [tid];
  } else {
    const uids = (data.members || []).map((x) => x.uid).filter(Boolean);
    if (!uids.length) return { ok: false, msg: "成员尚未绑定 UID" };
    payload.uids = uids;
  }

  const resp = await fetch("https://wxpusher.zjiecode.com/api/send/message", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  });
  const r = await resp.json().catch(() => ({ ok: false, msg: "WxPusher 响应解析失败" }));
  return r;
}

function getKV(env) {
  try {
    if (typeof DUTY_KV !== "undefined") return DUTY_KV;
  } catch (e) { /* 未定义 */ }
  return (env && env.DUTY_KV) || null;
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" }
  });
}

const DEFAULTS = {
  members: [],
  weekly: { 1: [], 2: [], 3: [], 4: [], 5: [], 6: [], 0: [] },
  overrides: {},
  mode: "weekly",
  rotation: { startDate: "", order: [] },
  settings: {
    appToken: "",
    notify: "off",
    topicId: "",
    pushTime: "08:00",
    adminKey: "",
    lastPushDate: "",
    lastPushResult: ""
  }
};

async function loadData(kv) {
  let d = null;
  try { d = await kv.get("duty_data", "json"); } catch (e) { d = null; }
  d = d && typeof d === "object" ? d : {};
  return {
    members: Array.isArray(d.members) ? d.members : [],
    weekly: { ...DEFAULTS.weekly, ...(d.weekly || {}) },
    overrides: d.overrides && typeof d.overrides === "object" ? d.overrides : {},
    mode: d.mode === "rotation" ? "rotation" : "weekly",
    rotation: {
      startDate: (d.rotation && d.rotation.startDate) ? String(d.rotation.startDate) : "",
      order: (d.rotation && Array.isArray(d.rotation.order)) ? d.rotation.order.map(String) : []
    },
    settings: { ...DEFAULTS.settings, ...(d.settings || {}) }
  };
}

async function saveData(kv, data) {
  await kv.put("duty_data", JSON.stringify(data));
}
