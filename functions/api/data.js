// GET /api/data 读取全部数据（公开，口令等敏感字段不出参）
export async function onRequest({ env }) {
  try {
    const kv = getKV(env);
    if (!kv) return json({ error: "KV 未绑定：请在控制台将 KV 命名空间绑定到项目，运行时变量名填 DUTY_KV，绑定后重新部署" }, 500);
    const data = await loadData(kv);
    return json({
      members: data.members.map((m) => ({ name: m.name, uid: m.uid || "" })),
      weekly: data.weekly,
      overrides: data.overrides,
      settings: {
        notify: data.settings.notify,
        pushTime: data.settings.pushTime,
        topicId: data.settings.topicId,
        pushConfigured: !!data.settings.appToken,
        lastPushDate: data.settings.lastPushDate || "",
        lastPushResult: data.settings.lastPushResult || "",
        hasAdmin: !!(env && env.ADMIN_SECRET) || !!data.settings.adminKey
      }
    });
  } catch (e) {
    return json({ error: String((e && e.message) || e) }, 500);
  }
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
