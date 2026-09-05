// POST /api/schedule 排班管理
// { adminKey, type: "weekly", weekday: "1".."6"|"0", names: [] }         设置每周固定排班
// { adminKey, type: "override", date: "2026-09-05", names: [], note? }  指定日期调整（空数组=无人值日）
// { adminKey, type: "override-del", date: "2026-09-05" }                删除某日调整，恢复默认
// { adminKey, type: "swap", a: "张三", b: "李四", date1: "..", date2: "..", note? }  A B 两人互调两天
// { adminKey, type: "log-clear" }                                       清空换班记录
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

    if (body.type === "weekly") {
      const wd = String(body.weekday);
      if (!(wd in { 0: 1, 1: 1, 2: 1, 3: 1, 4: 1, 5: 1, 6: 1 })) return json({ error: "weekday 无效" }, 400);
      data.weekly[wd] = names;
    } else if (body.type === "override") {
      const date = String(body.date || "");
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return json({ error: "日期格式无效" }, 400);
      const before = Array.isArray(data.overrides[date]) ? data.overrides[date].slice() : computeDefaultDuty(data, date);
      data.overrides[date] = names;
      pushLog(data, { date, before, after: names.slice(), action: "override", note: String(body.note || "") });
    } else if (body.type === "override-del") {
      const date = String(body.date || "");
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return json({ error: "日期格式无效" }, 400);
      const before = Array.isArray(data.overrides[date]) ? data.overrides[date].slice() : [];
      delete data.overrides[date];
      pushLog(data, { date, before, after: computeDefaultDuty(data, date), action: "del", note: String(body.note || "") });
    } else if (body.type === "swap") {
      // A B 两人互调两天：date1 原本含 A 的位置改放 B；date2 原本含 B 的位置改放 A
      const a = String(body.a || "").trim();
      const b = String(body.b || "").trim();
      const date1 = String(body.date1 || "");
      const date2 = String(body.date2 || "");
      if (!a || !b) return json({ error: "请选择两个成员" }, 400);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date1) || !/^\d{4}-\d{2}-\d{2}$/.test(date2)) return json({ error: "日期格式无效" }, 400);
      if (date1 === date2) return json({ error: "两个日期不能相同" }, 400);
      const before1 = Array.isArray(data.overrides[date1]) ? data.overrides[date1].slice() : computeDefaultDuty(data, date1);
      const before2 = Array.isArray(data.overrides[date2]) ? data.overrides[date2].slice() : computeDefaultDuty(data, date2);
      const after1 = replaceName(before1, a, b);
      const after2 = replaceName(before2, b, a);
      data.overrides[date1] = after1;
      data.overrides[date2] = after2;
      const note = String(body.note || "");
      pushLog(data, { date: date1, before: before1, after: after1, action: "swap", note: note + (note ? " " : "") + a + "→" + b });
      pushLog(data, { date: date2, before: before2, after: after2, action: "swap", note: note + (note ? " " : "") + b + "→" + a });
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

function computeDefaultDuty(data, dateStr) {
  // 不读 overrides，按周排/轮排还原"原本应该是谁"
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
    settings: { ...DEFAULTS.settings, ...(d.settings || {}) }
  };
}

async function saveData(kv, data) {
  await kv.put("duty_data", JSON.stringify(data));
}
