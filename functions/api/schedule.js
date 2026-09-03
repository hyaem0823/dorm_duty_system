// POST /api/schedule 排班管理
// { adminKey, type: "weekly", weekday: "1".."6"|"0", names: [] }         设置每周固定排班
// { adminKey, type: "override", date: "2026-09-05", names: [] }          指定日期调整（空数组=无人值日）
// { adminKey, type: "override-del", date: "2026-09-05" }                 删除某日调整，恢复默认
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

    if (body.type === "weekly") {
      const wd = String(body.weekday);
      if (!(wd in { 0: 1, 1: 1, 2: 1, 3: 1, 4: 1, 5: 1, 6: 1 })) return json({ error: "weekday 无效" }, 400);
      data.weekly[wd] = names;
    } else if (body.type === "override") {
      const date = String(body.date || "");
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return json({ error: "日期格式无效" }, 400);
      data.overrides[date] = names;
    } else if (body.type === "override-del") {
      const date = String(body.date || "");
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return json({ error: "日期格式无效" }, 400);
      delete data.overrides[date];
    } else {
      return json({ error: "未知操作" }, 400);
    }

    await saveData(kv, data);
    return json({ ok: true });
  } catch (e) {
    return json({ error: String((e && e.message) || e) }, 500);
  }
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
