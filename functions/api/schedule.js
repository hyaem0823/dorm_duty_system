// POST /api/schedule 排班管理
// { adminKey, type: "weekly", weekday: "1".."6"|"0", names: [] }         设置每周固定排班
// { adminKey, type: "shift-insert", from: "2026-09-08", name: "李四", note? }  插入顺延：从 from 起整体往后顺延一天
// { adminKey, type: "shift-cancel", id: "sh_xxx" }                       取消某次插入顺延
// { adminKey, type: "shift-clear" }                                       清空所有插入顺延（即"下次清空"中的清空动作）
// { adminKey, type: "swap-request", from: "张三", to: "李四", date1, date2, note? }  A 发起调班请求，等 B 确认
// { adminKey, type: "swap-respond", id: "sw_xxx", action: "confirm"|"reject" }     B 确认/拒绝调班请求
// { adminKey, type: "log-clear" }                                          清空换班记录
export async function onRequestPost({ request, env }) {
  try {
    const kv = getKV(env);
    if (!kv) return json({ error: "KV 未绑定，请先在控制台绑定 KV 命名空间（变量名 DUTY_KV）" }, 500);
    const data = await loadData(kv);
    const body = await request.json().catch(() => ({}));

    const auth = checkAuth(body, data, env);
    if (!auth.ok) return json({ error: auth.error }, 401);
    if (auth.bootstrap) data.settings.adminKey = body.adminKey;

    const names = Array.isArray(body.names) ? body.names.map((n) => String(n).trim()).filter(Boolean) : [];
    if (!Array.isArray(data.swapLog)) data.swapLog = [];
    if (!Array.isArray(data.shifts)) data.shifts = [];
    if (!Array.isArray(data.pendingSwaps)) data.pendingSwaps = [];

    if (body.type === "weekly") {
      const wd = String(body.weekday);
      if (!(wd in { 0: 1, 1: 1, 2: 1, 3: 1, 4: 1, 5: 1, 6: 1 })) return json({ error: "weekday 无效" }, 400);
      data.weekly[wd] = names;
    } else if (body.type === "shift-insert") {
      // 插入顺延：从 from 起整体顺延一天
      const from = String(body.from || "");
      const name = String(body.name || "").trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(from)) return json({ error: "from 日期格式无效" }, 400);
      if (!name) return json({ error: "请选择要插入的人" }, 400);
      const id = "sh_" + Date.now().toString(36);
      data.shifts.push({ id, ts: Date.now(), from, name, note: String(body.note || ""), active: true });
      pushLog(data, { date: from, before: [], after: [name], action: "shift-insert", note: String(body.note || "") });
    } else if (body.type === "shift-cancel") {
      const id = String(body.id || "");
      const idx = data.shifts.findIndex((s) => s.id === id);
      if (idx < 0) return json({ error: "插入记录不存在" }, 400);
      const s = data.shifts[idx];
      data.shifts.splice(idx, 1);
      pushLog(data, { date: s.from, before: [s.name], after: [], action: "shift-cancel", note: s.note || "" });
    } else if (body.type === "shift-clear") {
      const cleared = data.shifts.filter((s) => s.active);
      data.shifts = [];
      cleared.forEach((s) => pushLog(data, { date: s.from, before: [s.name], after: [], action: "shift-clear", note: s.note || "" }));
    } else if (body.type === "swap-request") {
      // A 发起调班请求，等 B 确认
      const from = String(body.from || "").trim();
      const to = String(body.to || "").trim();
      const date1 = String(body.date1 || "");
      const date2 = String(body.date2 || "");
      if (!from || !to) return json({ error: "请选择两个成员" }, 400);
      if (from === to) return json({ error: "两个成员不能相同" }, 400);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date1) || !/^\d{4}-\d{2}-\d{2}$/.test(date2)) return json({ error: "日期格式无效" }, 400);
      if (date1 === date2) return json({ error: "两个日期不能相同" }, 400);
      const id = "sw_" + Date.now().toString(36);
      data.pendingSwaps.push({
        id, ts: Date.now(), from, to, date1, date2,
        note: String(body.note || ""), status: "pending"
      });
      pushLog(data, { date: date1, before: [from], after: [to], action: "swap-request", note: String(body.note || "") });
    } else if (body.type === "swap-respond") {
      const id = String(body.id || "");
      const action = String(body.action || "");
      const idx = data.pendingSwaps.findIndex((s) => s.id === id);
      if (idx < 0) return json({ error: "调班请求不存在" }, 400);
      const req = data.pendingSwaps[idx];
      if (req.status !== "pending") return json({ error: "该请求已处理" }, 400);
      if (action === "confirm") {
        // 真正执行互调：date1 的 from 改 to；date2 的 to 改 from
        const before1 = Array.isArray(data.overrides[req.date1]) ? data.overrides[req.date1].slice() : computeDefaultDuty(data, req.date1);
        const before2 = Array.isArray(data.overrides[req.date2]) ? data.overrides[req.date2].slice() : computeDefaultDuty(data, req.date2);
        const after1 = replaceName(before1, req.from, req.to);
        const after2 = replaceName(before2, req.to, req.from);
        data.overrides[req.date1] = after1;
        data.overrides[req.date2] = after2;
        req.status = "confirmed";
        req.resolvedTs = Date.now();
        pushLog(data, { date: req.date1, before: before1, after: after1, action: "swap-confirmed", note: req.note });
        pushLog(data, { date: req.date2, before: before2, after: after2, action: "swap-confirmed", note: req.note });
      } else if (action === "reject") {
        req.status = "rejected";
        req.resolvedTs = Date.now();
        pushLog(data, { date: req.date1, before: [req.from], after: [req.from], action: "swap-rejected", note: req.note });
      } else {
        return json({ error: "action 必须是 confirm 或 reject" }, 400);
      }
    } else if (body.type === "log-clear") {
      data.swapLog = [];
    } else if (body.type === "mode") {
      const m = String(body.mode);
      if (m !== "weekly" && m !== "rotation") return json({ error: "mode 无效" }, 400);
      data.mode = m;
    } else if (body.type === "rotation") {
      const startDate = String(body.startDate || "");
      if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) return json({ error: "startDate 格式无效" }, 400);
      const order = Array.isArray(body.order)
        ? body.order.map((n) => String(n).trim()).filter(Boolean)
        : [];
      data.rotation = { startDate, order };
    } else {
      return json({ error: "未知操作" }, 400);
    }

    // 自动清理 7 天前的换班记录
    const cutoff = Date.now() - 7 * 86400000;
    data.swapLog = data.swapLog.filter((x) => (x.ts || 0) >= cutoff);
    // 自动清理 14 天前的调班请求
    const swapCutoff = Date.now() - 14 * 86400000;
    data.pendingSwaps = data.pendingSwaps.filter((x) => (x.ts || 0) >= swapCutoff);

    await saveData(kv, data);
    return json({ ok: true });
  } catch (e) {
    return json({ error: String((e && e.message) || e) }, 500);
  }
}

function pushLog(data, entry) {
  data.swapLog.push(Object.assign({ ts: Date.now() }, entry));
}

function replaceName(arr, fromN, toN) {
  const out = arr.map((n) => (n === fromN ? toN : n));
  if (!out.includes(toN)) out.push(toN);
  return out;
}

// computeDefaultDuty：不读 overrides / 不读 shifts，按 weekly 或 rotation 还原"原始"值日
function computeDefaultDuty(data, dateStr) {
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
  const d = new Date(dateStr + "T00:00:00Z");
  return data.weekly[d.getUTCDay()] || [];
}

function checkAuth(body, data, env) {
  const expected = (env && env.ADMIN_SECRET) || data.settings.adminKey || "";
  if (!expected) {
    if (body.adminKey && String(body.adminKey).trim()) return { ok: true, bootstrap: true };
    return { ok: false, error: "尚未设置管理员口令，请在口令输入框填写并提交（首次提交即设为口令）" };
  }
  if (body.adminKey !== expected) return { ok: false, error: "管理员口令错误" };
  return { ok: true, bootstrap: false };
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
  swapLog: [],
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
    swapLog: Array.isArray(d.swapLog) ? d.swapLog.filter((x) => x && typeof x === "object") : [],
    shifts: Array.isArray(d.shifts) ? d.shifts.filter((x) => x && typeof x === "object") : [],
    pendingSwaps: Array.isArray(d.pendingSwaps) ? d.pendingSwaps.filter((x) => x && typeof x === "object") : [],
    settings: { ...DEFAULTS.settings, ...(d.settings || {}) }
  };
}

async function saveData(kv, data) {
  await kv.put("duty_data", JSON.stringify(data));
}
