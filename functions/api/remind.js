// POST /api/remind 立即推送一次今日值日提醒（手动测试，需口令）
export async function onRequestPost({ request, env }) {
  try {
    const kv = getKV(env);
    if (!kv) return json({ error: "KV 未绑定，请先在控制台绑定 KV 命名空间（变量名 DUTY_KV）" }, 500);
    const data = await loadData(kv);
    const body = await request.json().catch(() => ({}));

    const auth = checkAuth(body, data, env);
    if (!auth.ok) return json({ error: auth.error }, 401);

    const bj = bjNow();
    const today = bjDate(bj);
    const duty = data.overrides[today] !== undefined ? data.overrides[today] : (data.weekly[bj.getUTCDay()] || []);
    if (!duty.length) return json({ pushed: false, reason: "今日无人值日，未推送" });

    const r = await pushRemind(data, duty, bj);
    const wxOK = !!(r && (r.ok === true || r.code === 1000));
    if (wxOK) {
      data.settings.lastPushDate = today;
      data.settings.lastPushResult = "手动推送成功";
      await saveData(kv, data);
    }
    return json({ pushed: wxOK, duty, wxpusher: r, reason: wxOK ? "" : "WxPusher 返回失败" });
  } catch (e) {
    return json({ error: String((e && e.message) || e) }, 500);
  }
}

function bjNow() {
  return new Date(Date.now() + 8 * 3600 * 1000); // 用 getUTC* 读取即为北京时间
}
function pad2(n) { return String(n).padStart(2, "0"); }
function bjDate(bj) { return bj.getUTCFullYear() + "-" + pad2(bj.getUTCMonth() + 1) + "-" + pad2(bj.getUTCDate()); }

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

function checkAuth(body, data, env) {
  const expected = (env && env.ADMIN_SECRET) || data.settings.adminKey || "";
  if (!expected) return { ok: false, error: "尚未设置管理员口令，请先在管理页保存一次设置以初始化口令" };
  if (body.adminKey !== expected) return { ok: false, error: "管理员口令错误" };
  return { ok: true };
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
    settings: { ...DEFAULTS.settings, ...(d.settings || {}) }
  };
}

async function saveData(kv, data) {
  await kv.put("duty_data", JSON.stringify(data));
}
