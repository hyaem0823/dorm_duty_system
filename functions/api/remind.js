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
    const duty = computeDuty(data, today, bj.getUTCDay());
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

function computeDuty(data, dateStr, weekday) {
  if (data.overrides && data.overrides[dateStr] !== undefined) return data.overrides[dateStr];

  // 取所有 active 且 from <= dateStr 的插入顺延，按 from 升序
  const shifts = (Array.isArray(data.shifts) ? data.shifts : [])
    .filter((s) => s && s.active && s.from <= dateStr)
    .sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0));

  // 无插入顺延：按 weekly / rotation 原始排班
  if (!shifts.length) return computeRawDuty(data, dateStr, weekday);

  // 有插入顺延：从最早插入点起迭代到 dateStr
  const startMs = Date.UTC(+(shifts[0].from.slice(0, 4)), +(shifts[0].from.slice(5, 7)) - 1, +(shifts[0].from.slice(8, 10)));
  const cp = String(dateStr).split("-");
  const curMs = Date.UTC(+cp[0], +cp[1] - 1, +cp[2]);
  const totalDays = Math.floor((curMs - startMs) / 86400000);
  if (totalDays < 0) return computeRawDuty(data, dateStr, weekday);

  // 模拟顺延：每天 rawDuty 入队尾；有 shift 插入则当天值日 = shift.names；否则取队首
  const deferred = [];
  let shiftIdx = 0;
  for (let i = 0; i <= totalDays; i++) {
    const ms = startMs + i * 86400000;
    const d = new Date(ms);
    const curDate = d.getUTCFullYear() + "-" + String(d.getUTCMonth() + 1).padStart(2, "0") + "-" + String(d.getUTCDate()).padStart(2, "0");
    const curWd = String(d.getUTCDay());
    const rawDuty = computeRawDuty(data, curDate, curWd);
    // 当天原默认入队尾（被推迟到后面某天）
    if (rawDuty && rawDuty.length) deferred.push(...rawDuty);

    // 收集今天的所有插入
    const todayShifts = [];
    while (shiftIdx < shifts.length && shifts[shiftIdx].from === curDate) {
      todayShifts.push(shifts[shiftIdx]);
      shiftIdx++;
    }
    let actual;
    if (todayShifts.length) {
      actual = todayShifts.map((s) => s.name);
    } else {
      actual = deferred.length ? [deferred.shift()] : [];
    }
    if (i === totalDays) return actual;
  }
  return computeRawDuty(data, dateStr, weekday);
}

// computeRawDuty：按 weekly 或 rotation 原始排班，不考虑 overrides / shifts
function computeRawDuty(data, dateStr, weekday) {
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
  } else if (s.notify === "uids_all") {
    // UID 推送给所有填了 UID 的成员（不限于当天值日生）
    const uids = (data.members || []).filter((x) => x.uid).map((x) => x.uid);
    if (!uids.length) return { ok: false, msg: "没有成员绑定 UID" };
    payload.uids = uids;
  } else {
    const uids = (data.members || []).filter((x) => dutyNames.includes(x.name) && x.uid).map((x) => x.uid);
    if (!uids.length) return { ok: false, msg: "值日生尚未绑定 UID" };
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
  mode: "weekly",
  rotation: { startDate: "", order: [] },
  shifts: [],
  pendingSwaps: [],
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
    shifts: Array.isArray(d.shifts) ? d.shifts.filter((x) => x && typeof x === "object") : [],
    pendingSwaps: Array.isArray(d.pendingSwaps) ? d.pendingSwaps.filter((x) => x && typeof x === "object") : [],
    settings: { ...DEFAULTS.settings, ...(d.settings || {}) }
  };
}

async function saveData(kv, data) {
  await kv.put("duty_data", JSON.stringify(data));
}
