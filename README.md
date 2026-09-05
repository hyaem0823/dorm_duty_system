# 宿舍值日表

基于腾讯云 EdgeOne Pages + KV 存储 + WxPusher 微信推送的宿舍值日管理系统。

## 功能

- **今日值日**：一眼看到今天谁值日，以及未来 7 天排班
- **两种排班模式**：
  - 每周固定排班：按周一~周日分别配置值日人
  - 轮班制：从起始日起按顺序每天一人，自动循环（适合人数和天数不匹配的情况）
- **调班**：临时调整某天的值日人（请假、换班、设为无人）
- **微信提醒**：每天定时给当天值日生发微信推送，只打扰该提醒的人
- **成员管理**：添加/删除成员，绑定 WxPusher UID

## 部署指南

### 1. Fork 仓库

点击 GitHub 页面右上角 Fork，复制到自己账号下。

### 2. 部署到 EdgeOne Pages

1. 登录 [腾讯云 EdgeOne Pages 控制台](https://console.cloud.tencent.com/edgeone/pages)
2. 创建项目 → 选择 GitHub 导入 → 选你 Fork 的仓库
3. 构建命令留空，输出目录保持根目录
4. 部署完成后会分配一个 `*.edgeone.cool` 域名

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
3. **调班页** → 如需临时换人，选日期修改

### 5. 配置微信推送（可选）

1. 打开 [wxpusher.zjiecode.com](https://wxpusher.zjiecode.com) 注册
2. 创建应用，拿到 `appToken`（`AT_` 开头）
3. 全员关注应用（二选一）：
   - **主题模式**：创建主题 → 室友扫码关注 → 填主题 ID（全员收到推送）
   - **UID 模式**：每人关注应用 → 在后台查到 UID → 填到成员管理里（仅当天值日生收到推送）
4. 管理页 → 推送设置 → 填入 appToken、选提醒方式、设推送时间 → 保存
5. 点「发送测试推送」验证

### 6. 配置定时推送（可选）

EdgeOne Pages 不支持定时任务，需用外部服务触发：

1. 注册 [cron-job.org](https://cron-job.org)（免费）
2. 创建定时任务：
   - URL：`https://你的域名/cron/remind`
   - 频率：每 5 分钟
   - 方式：GET
3. 系统会在每天设定时间自动给当天值日生发微信提醒

## 技术栈

- 前端：原生 HTML/CSS/JS（单文件，无框架）
- 后端：EdgeOne Pages Edge Functions（`functions/` 目录）
- 存储：EdgeOne KV（变量名 `DUTY_KV`）
- 推送：[WxPusher](https://wxpusher.zjiecode.com)

## 项目结构

```
├── index.html              # 前端页面
├── edgeone.json            # EdgeOne Pages 配置
├── functions/
│   ├── api/
│   │   ├── data.js         # 读取全部数据
│   │   ├── schedule.js     # 排班管理（固定/轮班/调班）
│   │   ├── members.js     # 成员管理
│   │   ├── settings.js     # 推送设置
│   │   └── remind.js       # 手动推送测试
│   └── cron/
│       └── remind.js       # 定时推送入口
```

## License

MIT
