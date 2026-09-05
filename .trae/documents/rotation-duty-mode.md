# 轮班制功能实现计划

## Context

宿舍值日系统现有 5 人轮 7 天的需求，当前只支持"每周固定排班"（同一个人每周固定负责同一天）。需要新增"轮班制"模式：从起始日起，按顺序每天一人，循环往复。两种模式可切换，调班（override）在两种模式下都生效。

## 数据模型变更

在 KV 存储的 `duty_data` 中新增两个字段：

```json
{
  "mode": "weekly",           // "weekly" | "rotation"
  "rotation": {
    "startDate": "",           // "YYYY-MM-DD"
    "order": []                // ["张三", "李四", ...]
  }
}
```

所有 6 个函数文件的 `DEFAULTS` 和 `loadData` 都需同步更新（否则 `saveData` 会丢失新字段）。

## 值日计算公式

```
if overrides[date] 存在: 用 override
else if mode == "rotation":
  days = floor((Date.UTC(date) - Date.UTC(startDate)) / 86400000)
  if days < 0: 返回空
  返回 [order[days % order.length]]   // 每天一人
else: 用 weekly[weekday]
```

用 `Date.UTC(y, m-1, d)` 从字符串拆分计算，避免时区问题。

## 修改文件清单

### 后端（6 个文件，按依赖顺序）

1. **`functions/api/data.js`** — `DEFAULTS`+`loadData` 更新；返回值增加 `mode`、`rotation`
2. **`functions/api/schedule.js`** — `DEFAULTS`+`loadData` 更新；新增两个 `type`：
   - `"mode"`：切换模式 `{ type:"mode", mode:"rotation" }`
   - `"rotation"`：保存轮班配置 `{ type:"rotation", startDate:"...", order:[...] }`
3. **`functions/api/members.js`** — `DEFAULTS`+`loadData` 更新；删除成员时同步清理 `rotation.order`
4. **`functions/api/settings.js`** — `DEFAULTS`+`loadData` 更新（无逻辑变更，但必须做，否则保存设置会擦除新字段）
5. **`functions/api/remind.js`** — `DEFAULTS`+`loadData` 更新；用 `computeDuty()` 替换原有的一行值日计算
6. **`functions/cron/remind.js`** — 同上

### 前端（1 个文件）

**`index.html`** 修改点：

- `dutyFor()` 增加 rotation 分支 + `dutyForRotation()` 辅助函数
- 排班 tab 改为三张卡片：
  - **排班模式**（始终显示）：下拉选择 + 切换按钮
  - **每周固定排班**（weekly 模式显示）：现有 UI 不变
  - **轮班设置**（rotation 模式显示）：起始日期 + 成员顺序（上下箭头）+ 保存按钮 + 未来 14 天预览
- `renderAll()` 中加入 `renderMode()` 调用
- 新增 CSS：`.rot-row` 和上下箭头按钮样式

## 实现顺序

1. 先改 6 个后端文件的 `DEFAULTS` + `loadData`（纯 schema 扩展，不破坏现有功能）
2. 改 `schedule.js` 新增 type 分支
3. 改 `members.js` 删除清理逻辑
4. 改 `data.js` 返回值
5. 改两个 `remind.js` 的 `computeDuty`
6. 最后改 `index.html`（最大改动，依赖新 API）

## 验证方式

1. 推送代码后，在管理页添加 5 个成员
2. 切到排班页，选"轮班制"，设起始日期为今天，调整顺序，保存
3. 回今日页，确认今日值日显示正确的人
4. 在排班页查看 14 天预览，确认轮换正确
5. 切回调班页，选一个未来日期覆盖，确认 override 生效
6. 切回每周固定模式，确认旧功能不受影响
