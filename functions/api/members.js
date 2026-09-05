// POST /api/members 成员管理 { adminKey, action: "add"|"del"|"setuid", name, uid }
export async function onRequestPost({ request, env }) {
  try {
    const kv = getKV(env);
    if (!kv) return json({ error: "KV 未绑定，请先在控制台绑定 KV 命名空间（变量名 DUTY_KV）" }, 500);
    const data = await loadData(kv);
    const body = await request.json().catch(() => ({}));

    const auth = checkAuth(body, data, env);
    if (!auth.ok) return json({ error: auth.error }, 401);
    if (auth.bootstrap) data.settings.adminKey = body.adminKey;

    const name = String(body.name || "").trim();
    if (!name) return json({ error: "姓名不能为空" }, 400);

    if (body.action === "add") {
      if (data.members.some((m) => m.name === name)) return json({ error: "成员已存在" }, 400);
      data.members.push({ name, uid: String(body.uid || "").trim() });
    } else if (body.action === "del") {
      data.members = data.members.filter((m) => m.name !== name);
      // 同步清理排班中对该成员的引用
      for (const k of Object.keys(data.weekly)) {
        data.weekly[k] = data.weekly[k].filter((n) => n !== name);
      }
      for (const k of Object.keys(data.overrides)) {
        data.overrides[k] = data.overrides[k].filter((n) => n !== name);
      }
      if (data.rotation && Array.isArray(data.rotation.order)) {
        data.rotation.order = data.rotation.order.filter((n) => n !== name);
      }
    } else if (body.action === "setuid") {
      const m = data.members.find((x) => x.name === name);
      if (!m) return json({ error: "成员不存在" }, 400);
      m.uid = String(body.uid || "").trim();
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
    // 首次使用：允许调用者用本次提交的口令初始化管理员
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
