# 宿舍值日表

基于腾讯云 EdgeOne Pages + KV 存储 + WxPusher 微信推送的宿舍值日管理系统。

## 功能

- **今日值日**：一眼看到今天谁值日，以及未来 7 天排班
- **两种排班模式**：
  - 每周固定排班：按周一~周日分别配置值日人
  - 轮班制：从起始日起按顺序每天一人，自动循环（适合人数和天数不匹配的情况）
- **调班**（三个子标签）：
  - **插入顺延**：某人临时加入值日，从他/她插入那天起，后续值日整体往后推一天（原顺序保留，永久顺延直到清空）
  - **调班请求**：A 想跟 B 换班但 B 可能没空 → 发起请求写入"待确认"列表 → B 有空时点确认才真正互换（14 天未确认自动作废）
  - **调整记录**：最近 7 天所有操作日志
- **微信提醒**：4 种推送方式可选（关闭 / 主题推送全员 / UID 推送仅当天值日生 / UID 推送全员）
- **成员管理**：添加/删除成员，绑定 WxPusher UID

## 部署指南

### 1. Fork 仓库

点击 GitHub 页面右上角 Fork，复制到自己账号下。

### 2. 部署到 EdgeOne Pages

1. 登录 [腾讯云 EdgeOne Pages 控制台](https://console.cloud.tencent.com/edgeone/pages)
2. 创建项目 → 选择 GitHub 导入 → 选你 Fork 的仓库
3. 框架选 **Custom** 或 **EdgeOne Functions**
4. 构建命令留空，输出目录保持根目录
5. 部署完成后会分配一个 `*.edgeone.cool` 域名

### 3. 绑定 KV 存储（必须）

1. EdgeOne 控制台 → KV 存储 → 新建命名空间
2. 回到项目 → 设置 → 运行时变量绑定：
   - 变量名：`DUTY_KV`
   - 绑定你刚建的 KV 命名空间
3. 重新部署项目让绑定生效

### 4. 开始使用

打开你的域名，按顺序操作：

1. **管理页** → 填管理员口令（首次设置）→ 添加成员
2. **排班页** → 选模式（固定排班 / 轮班制）→ 配置 → 保存
3. **调班页** → 如需临时调整，选「插入顺延」或「调班请求」子标签

### 5. 配置微信推送

#### 5.1 注册 WxPusher 拿 appToken

1. 打开 [wxpusher.zjiecode.com](https://wxpusher.zjiecode.com) 注册登录
2. 管理后台 → 应用管理 → 创建应用 → 复制 `appToken`（`AT_` 开头）

#### 5.2 成员绑定（二选一）

- **主题模式**（推荐用于全员通知）：
  1. WxPusher 后台 → 主题管理 → 创建主题 → 复制主题 ID（数字）
  2. 把主题订阅链接/二维码发到宿舍群
  3. 室友用微信扫码 → 关注该主题
- **UID 模式**（推荐用于只推值日生）：
  1. 每个成员用自己要收消息的微信扫码 WxPusher 后台「获取 UID」入口
  2. 在网站「成员管理」里把得到的 UID 填到对应成员

#### 5.3 网站保存配置

1. 进入「管理」→「推送设置」
2. 填入 WxPusher appToken
3. 选提醒方式（4 选 1）：

| 值 | 模式 | 接收人 | 需要的数据 |
|---|---|---|---|
| `off` | 关闭 | 无 | 无 |
| `topic` | 主题推送 | 订阅了该主题的所有人 | appToken + topicId |
| `uids` | UID 推送（仅值日生） | **仅当天值日生** | appToken + 成员 UID |
| `uids_all` | UID 推送（全员） | 所有填了 UID 的成员 | appToken + 成员 UID |

4. 设每天推送时间（如 `08:00`）
5. 点「保存设置」→「发送测试推送」验证

> 注意：手机收不到推送时，请检查：
> - 是否关注了公众号「WxPusher 消息服务」
> - UID 是不是当前要收消息的微信号扫出来的
> - 应用是否通过审核（WxPusher 后台 → 应用管理 → 看状态）

### 6. 配置定时推送

EdgeOne Pages 不支持 cron 定时任务，需用外部服务定时访问 `/cron/remind`：

1. 注册 [cron-job.org](https://cron-job.org)（免费）或 [UptimeRobot](https://uptimerobot.com)
2. 创建定时任务：
   - URL：`https://你的域名/cron/remind`
   - 频率：每 5 分钟
   - 方式：GET
3. 系统会在每天设定时间（北京时间）自动给当天值日生发提醒，已推送过当天不会重复推送

> 可选防护：在 EdgeOne Pages 项目设置 → 环境变量里加 `CRON_KEY`，则 `/cron/remind` 必须带 `?key=你的key` 才能访问，防止他人恶意触发。

## 配置自定义域名（Cloudflare 为例）

EdgeOne Pages 默认提供 `*.edgeone.cool` 永久域名，如果你有自己的域名且 DNS 托管在 Cloudflare：

1. **EdgeOne 控制台绑定域名**：
   - 进入 EdgeOne Pages 项目 → 「域名设置」→ 「添加域名」
   - 输入你的域名（如 `duty.example.com`）
   - EdgeOne 会给你一个 CNAME 目标（形如 `xxx.edgeone.cool`）
2. **Cloudflare 添加 CNAME 记录**：
   - 登录 [Cloudflare 控制台](https://dash.cloudflare.com)
   - 选择你的域名 → DNS → Records → Add record
   - Type: `CNAME`
   - Name: `duty`（或你想的子域名前缀）
   - Target: 上一步 EdgeOne 给的 CNAME 目标
   - Proxy status: **DNS only**（灰色云朵，EdgeOne 自己处理 SSL/CDN）— 如果开橙色云朵可能 SSL 双跳出问题
   - 保存
3. **回到 EdgeOne 控制台**点「验证域名」，等 1-5 分钟生效
4. DNS 生效后，用 `https://你的域名` 访问即可

> 如果根域名（apex domain）也要用，Cloudflare 支持 CNAME Flattening，把根域名直接 CNAME 到 EdgeOne 目标即可。

## 技术栈

- 前端：原生 HTML/CSS/JS（单文件，无框架）
- 后端：EdgeOne Pages Edge Functions（`functions/` 目录）
- 存储：EdgeOne KV（变量名 `DUTY_KV`）
- 推送：[WxPusher](https://wxpusher.zjiecode.com)

## 项目结构

```
├── index.html              # 前端页面
├── edgeone.json            # EdgeOne Pages 配置（rewrites）
├── functions/
│   ├── api/
│   │   ├── data.js         # 读取全部数据
│   │   ├── schedule.js     # 排班管理（固定/轮班/插入顺延/调班请求）
│   │   ├── members.js      # 成员管理
│   │   ├── settings.js     # 推送设置
│   │   └── remind.js       # 手动推送测试
│   └── cron/
│       └── remind.js       # 定时推送入口
```

## License

MIT
