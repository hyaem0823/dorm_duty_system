# 宿舍值日表

基于 Cloudflare Pages + KV 存储 + WxPusher 微信推送的宿舍值日管理系统。
零成本部署、无需服务器、自动每天微信提醒当天值日生。

## 功能

### 今日值日

- 一眼看到今天谁值日，用大字显示在首页

- 未来 7 天排班预览，提前知道接下来谁值日

- 本周日历视图，可视化一周排班

### 两种排班模式

- **每周固定排班**：按周一\~周日分别配置值日人，每周循环

  - 适合人数固定、作息规律的场景

  - 周一到周日每天可设多人值日

- **轮班制**：从起始日起按顺序每天一人，自动循环

  - 适合人数和天数不匹配的情况（如 5 人轮 7 天）

  - 自动按顺序循环，无需手动调整

### 调班（三个子标签）

进入「调班」标签页，顶部有 3 个子标签：

#### 1. 插入顺延

某人临时加入值日（比如偶尔回宿舍的室友），从他/她插入那天起，后续值日整体往后推一天。

**示例**：

- 默认排班：周一=A、周二=B、周三=C、周四=D

- 在周二插入「李四」

- 实际排班：

  - 周一 = A（不变）

  - 周二 = 李四（新插入）

  - 周三 = B（原周二）

  - 周四 = C（原周三）

  - 周五 = D（原周四）

特点：

- 原顺序保留，整体顺延

- 永久顺延，直到手动清空

- 支持多次插入（按日期顺序叠加）

- 支持单条撤销或一键清空所有

#### 2. 调班请求

A 想跟 B 换班但 B 可能没空：发起请求写入"待确认"列表，B 有空时点确认才真正互换。

**流程**：

1. A 选「成员 A」+「成员 B」+「日期1（A 原本值日）」+「日期2（B 原本值日）」
2. 点「发起请求」→ 写入待确认列表
3. B 进入调班页 → 看到「待确认」状态 → 点「确认换班」或「拒绝」
4. B 确认 → 互调生效（A 在 date1 的值日改由 B，B 在 date2 的值日改由 A）
5. B 拒绝 → 请求标记为「已拒绝」，不换班

特点：

- 14 天未确认自动作废

- 不会立即互换，B 有充分时间考虑

- 只影响 date1 和 date2 两天，其他人不受影响

#### 3. 调整记录

显示最近 7 天所有操作日志，包括：

- 插入顺延 / 撤销顺延 / 清空顺延

- 发起请求 / 确认互调 / 拒绝互调

每条记录显示：日期 · 动作 · 时间 · 调整前→调整后 · 备注
7 天后自动清理，避免历史记录堆积。

### 微信提醒

4 种推送方式可选：

| 值          | 模式           | 接收人          | 需要的数据              | 适用场景            |
| ---------- | ------------ | ------------ | ------------------ | --------------- |
| `off`      | 关闭           | 无            | 无                  | 不推送             |
| `topic`    | 主题推送         | 订阅了该主题的所有人   | appToken + topicId | 全员都收到通知         |
| `uids`     | UID 推送（仅值日生） | **仅当天值日生**   | appToken + 成员 UID  | 只提醒值日生，不扰民      |
| `uids_all` | UID 推送（全员）   | 所有填了 UID 的成员 | appToken + 成员 UID  | 全员都收到，不需要扫码订阅主题 |

特点：

- 支持设置每天推送时间（北京时间，如 `08:00`）

- 已推送过当天不会重复推送（防骚扰）

- 推送失败自动重试（每 5 分钟轮询一次）

- 支持手动「发送测试推送」验证配置

### 成员管理

- 添加/删除成员

- 每个成员可绑定 WxPusher UID（用于 UID 推送模式）

- 修改成员姓名或 UID 即时生效

## 部署到 Cloudflare Pages

### 1. Fork 仓库

点击 GitHub 页面右上角 Fork，复制到自己账号下。

### 2. 在 Cloudflare Pages 创建项目

1. 登录 [Cloudflare Pages 控制台](https://dash.cloudflare.com)
2. **Workers & Pages** → **Create application** → **Pages** → **Connect to Git**
3. 授权并选择你 Fork 的仓库
4. 配置：

   - **Project name**：`dorm-duty`（任意，会成为域名一部分）

   - **Production branch**：`main`

   - **Framework preset**：`None`

   - **Build command**：留空

   - **Build output directory**：`/`（根目录）

   - **Root directory**：`/`
5. **Save and Deploy**

部署完成后会得到一个 `*.pages.dev` 永久域名。

### 3. 绑定 KV 存储（必须）

1. Cloudflare 控制台 → **Workers & Pages** → **KV** → **Create a namespace**
2. 名字随便填（如 `DUTY`），创建
3. 回到你刚部署的 Pages 项目 → **Settings** → **Functions** → **KV namespace bindings**
4. **Add binding**：

   - **Variable name**：`DUTY_KV` ← 必须是这个，代码写死的

   - **KV namespace**：选你刚创建的那个
5. **Production** 和 **Preview** 两个环境都加上
6. 回到 **Deployments** → 找到最新一次部署 → 点右边 ⋯ → **Retry deployment** 让绑定生效

> 关键：绑定 KV 后必须重新部署一次，否则接口会报「KV 未绑定」。

### 4. 访问站点并初始化

打开 `https://你的项目名.pages.dev`，按顺序操作：

1. **管理页** → 填管理员口令（首次设置，自己定一个）→ 添加成员
2. **排班页** → 选模式（固定排班 / 轮班制）→ 配置 → 保存
3. **调班页** → 如需临时调整，选「插入顺延」或「调班请求」子标签

### 5. 配置微信推送

#### 5.1 注册 WxPusher 拿 appToken

1. 打开 [wxpusher.zjiecode.com](https://wxpusher.zjiecode.com) 注册登录
2. 管理后台 → 应用管理 → 创建应用
3. 复制 `appToken`（`AT_` 开头的一长串）

> 注意：WxPusher 是一个 HTTP 接口服务，不是"集成"或"连接"应用。你的网站代码直接 POST 到 WxPusher 服务器，Cloudflare 这边不需要做任何 WxPusher 配置。

#### 5.2 成员绑定 UID

每个成员都要单独绑定自己的 WxPusher UID：

1. 每个成员用自己要收消息的微信扫码 WxPusher 后台「获取 UID」入口
2. 把得到的 UID（`UID_` 开头）发给你
3. 在网站「成员管理」里把 UID 填到对应成员

> 重要：UID 是「微信号 + 应用」绑定的唯一 ID。不能用别人的 UID，换微信号了要重新扫码获取。

#### 5.3 选推送方式并保存

1. 进入网站「管理」→「推送设置」
2. 填 WxPusher appToken（`AT_` 开头）
3. 选提醒方式（4 选 1，见上方功能说明的对比表）
4. 设每天推送时间（如 `08:00`）
5. 点「保存设置」→ 点「发送测试推送」验证

> 提醒方式选「UID 推送（仅值日生）」最常用：只推给当天值日的人，不扰民。
> 主题推送需要成员扫码订阅主题，配置稍麻烦，但所有成员都能收到。

#### 5.4 手机收不到推送的排查清单

1. **微信关注公众号「WxPusher 消息服务」**（必须先关注才能收到任何推送）
2. UID 是不是当前要收消息的微信号扫出来的（不能用别人的 UID）
3. 应用是否通过审核（WxPusher 后台 → 应用管理 → 看状态）
4. 在「WxPusher 消息服务」公众号里查看推送历史，确认是否实际下发
5. 网站管理页点「发送测试推送」后，看返回的 `wxpusher` 字段：

   - `code: 1000` 表示 WxPusher 接受了请求，但实际下发以公众号推送历史为准

   - 其他 code 是错误，按 `msg` 字段排查

### 6. 配置定时推送

Cloudflare Pages 不直接支持 cron，需要外部服务定时访问 `/cron/remind` 触发推送。系统会在每天设定时间（北京时间，按网站「推送设置」里的时间）自动推送，已推送过当天不会重复。

#### 方案 A：外部 cron 服务（最简单）

1. 注册 [cron-job.org](https://cron-job.org)（免费）或 [UptimeRobot](https://uptimerobot.com)
2. 创建定时任务：

   - URL：`https://你的项目名.pages.dev/cron/remind`

   - 频率：每 5 分钟

   - 方式：GET
3. 完成

#### 方案 B：Cloudflare Worker Cron Triggers（推荐）

1. Cloudflare 控制台 → **Workers & Pages** → **Create application** → **Create Worker**
2. 名字填 `duty-cron`
3. 部署后 → **Settings** → **Triggers** → **Cron Triggers** → 添加：

   - Cron expression：`*/5 * * * *`（每 5 分钟）
4. 编辑 Worker 代码（复制下面这段）：

```javascript
export default {
  async scheduled(event, env, ctx) {
    const url = `https://你的项目名.pages.dev/cron/remind`;
    await fetch(url);
  }
};
```

1. 保存 → 部署

#### 可选防护：CRON\_KEY

防止他人恶意触发 `/cron/remind`：

1. Cloudflare Pages 项目 → **Settings** → **Environment variables**
2. 添加变量 `CRON_KEY` = 你自己定的密钥（如 `mySecret123`）
3. cron URL 改为 `https://你的项目名.pages.dev/cron/remind?key=mySecret123`

### 7. 绑定自定义域名（可选）

Cloudflare Pages 自带 `*.pages.dev` 永久域名，如果想用自己的域名：

1. 进入 Pages 项目 → **Custom domains** → **Set up a custom domain**
2. 输入你的域名（如 `duty.你的域名.com`）
3. 如果域名 DNS 在 Cloudflare：自动加 CNAME 记录，无需手动操作
4. 如果域名 DNS 在别处：手动添加 CNAME 记录指向 `你的项目名.pages.dev`
5. 等 1-5 分钟生效，HTTPS 自动配好

## 技术栈

- 前端：原生 HTML/CSS/JS（单文件 [index.html](file:///d:/000box/duty-system/index.html)，无框架）

- 后端：Cloudflare Pages Functions（`functions/` 目录，基于 Web 标准 Request/Response）

- 存储：Cloudflare KV（变量名 `DUTY_KV`）

- 推送：[WxPusher](https://wxpusher.zjiecode.com) 微信消息服务

## 项目结构

```
├── index.html              # 前端页面（单文件）
├── _redirects              # Cloudflare Pages SPA 重写规则
├── functions/
│   ├── api/
│   │   ├── data.js         # 读取全部数据（GET /api/data）
│   │   ├── schedule.js     # 排班管理：固定/轮班/插入顺延/调班请求
│   │   ├── members.js      # 成员管理：增删改查
│   │   ├── settings.js     # 推送设置：appToken/notify/pushTime
│   │   └── remind.js       # 手动推送测试（POST /api/remind）
│   └── cron/
│       └── remind.js       # 定时推送入口（GET /cron/remind）
```

## API 接口

| 路径              | 方法   | 说明                                                |
| --------------- | ---- | ------------------------------------------------- |
| `/api/data`     | GET  | 读取全部数据（成员、排班、设置等）                                 |
| `/api/schedule` | POST | 排班管理（weekly/rotation/shift-insert/swap-request 等） |
| `/api/members`  | POST | 成员管理（add/remove/update）                           |
| `/api/settings` | POST | 推送设置（appToken/notify/pushTime）                    |
| `/api/remind`   | POST | 手动推送一次（需 adminKey）                                |
| `/cron/remind`  | GET  | 定时任务入口（每 5 分钟轮询，到点推送）                             |

## License

MIT
