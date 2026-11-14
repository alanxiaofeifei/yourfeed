# ADR 0002：实例所有者选择刷新方式与定时调度

日期：2026-11-15。状态：本地实现；中央调度仅为提案，须 Alan 批准。
入口：[Issue #16](https://github.com/alanxiaofeifei/yourfeed/issues/16)、[PR #8](https://github.com/alanxiaofeifei/yourfeed/pull/8)。

## 现状与平台限制

运营者于 2026-11-15 经 Cloudflare API 核实：账号 **1/5** 个 Free Cron 槽位已使用，只有 `yourfeed-member-001` 配有 `*/15 * * * *`。`yourfeed`、`yourfeed-control`、preview 及其他 Worker 均没有 cron。这是任务提供的运营证据，本轮没有访问远程配置。

Cloudflare 官方 [Workers Limits](https://developers.cloudflare.com/workers/platform/limits/)（本轮读取核对）规定 Free 每账号 5 个 Cron Triggers、每次 10ms CPU、50 次子请求。网络等待不计 CPU，但解析仍计 CPU。[Cron Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/) 通过 scheduled handler 执行。槽位限制的是计时规则数量，不是用户刷新次数；每成员一个 cron 会在五个实例后用尽账号槽位，不能扩展到更多成员。

## 本轮决定

- 每个独立单所有者实例复用本实例 `meta/background:policy`：`refreshMode` 为 `manual | on_open | scheduled`，`intervalHours` 允许整数 1..168（界面提供 1/2/4/6/12/24），默认 6。没有 schema 或权限变更。
- 旧 `enabled:true` 映射 scheduled，其他映射 on_open；保留旧字段/客户端兼容。显式 refreshMode 优先。
- 复用普通环境变量 `BACKGROUND_SCHEDULE_CONFIGURED`，仅严格字符串 `true` 表示运营者已核实定时器；缺省 false。此 flag 不会创建 cron。未配置时保留已存 scheduled 选择，但有效方式为 on_open，界面明确说明并禁用 scheduled 选项。核实 cron 前不能设 true；本任务不修改任何 Wrangler cron 或部署配置。
- 首页先读取策略再决定自动工作，读取失败暂停自动刷新、保留手动按钮。manual 不自动抓取；on_open 仅本次打开首页检查一次，达到间隔后渐进更新；scheduled 不额外在打开时抓取。按钮可随时手动更新。
- 已有 scheduled handler 保留：维护批次最多 5 条；仅 scheduled + flag 为 true 且到期时抓取。参考最近的 `background:last-run` / 完成的 `last-sync`，未到期间隔不调用来源或 AI；保留锁、每 tick 1 个来源、5 条新内容、最多 1 条 AI 分析。未完成来源轮次下个 tick 继续，完成后开始新间隔。来源自身的到期判断也使用所选间隔；保留既有 5 分钟启动保护、重试退避和存储/预算限制。间隔是最早刷新时间，实际完成取决于 tick、批次数和上游。
- 抓取免费；AI 使用自己的 Key 及服务商计费。显式阅读可尝试有限免费公共通道，自动/后台 AI 仍须自己的连接并受现有预算保护；后台 AI 单独 opt-in，离开期间也可能计费。四语提醒紧邻选择。
- 本地合成测试能验证到期和批次行为，不能证明线上 10ms CPU 或免费容量合格；沿用上线前运营验收门槛。

## 后续建议（未实现）

在中央 dispatcher（例如 `yourfeed-control`）使用**一个**固定 cron，分批向成员 Worker 的 service binding 或经过认证的内部入口分发 tick。各成员继续持有自己的 D1、Key、会话、策略、到期检查及锁；调度服务不集中读取成员内容或凭证。需设计身份验证/授权、撤销、幂等、并发/重试、失败观测与扇出配额，并实测 Free CPU、子请求及 D1 限额后再决定批次与容量。

**须 Alan 明确批准**后才能新增中央 cron、service bindings 或内部调用入口；本轮没有实现 dispatcher、改变鉴权/访问权限或改动实例隔离。
