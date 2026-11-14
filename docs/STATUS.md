# 当前项目状态

更新时间：2026-11-14T22:10:00+08:00

## 当前目标
- 完成 [Draft PR #8](https://github.com/alanxiaofeifei/yourfeed/pull/8) 的四语言（zh-CN / en / zh-TW / vi）可恢复首次使用引导，在独立非生产预览中供 Alan 审阅。计划原文在仓库外 `/workspace/yourfeed-onboarding-20261112/PLAN.md`；旧的待确认方案以此处确认决定和实际实现为准。
- 验收：新账号可开始、跳过、退出并恢复引导，旧账号可手动启动；覆盖语言、偏好、RSS 来源与阅读、可选 AI / YouTube，区分查看、保存和真实验证，失败保留草稿；桌面、手机及无障碍可用，不改变鉴权或实例隔离。RSS 不依赖 AI key。完整条件见计划和 PR；实际实现为内联引导，不持久化独立阅读／搜索操作证明。
- Alan 已确认：保留两个来源入口，引导走「发现与导入 → 精选推荐」；已有账号不自动弹窗，首页突出显示 Getting started；zh-TW、vi 与 zh-CN、en 一同完整翻译。优先推荐 Google AI Studio 和 Groq；NVIDIA 免费但有配额／限速且无需支付方式。Cerebras 需验证支付方式，一次性 $5 / 30 天试用，无永久免费层（2026-11-14 核实 [官方账单](https://inference-docs.cerebras.ai/console/account-billing.md)及[限额](https://inference-docs.cerebras.ai/support/rate-limits.md)）。`ONBOARDING_AUTO_OFFER_CUTOFF` 为生产上线当天，在部署时设置；预览值不能用于生产。

## 工作入口
- Issue：未核实；以 [Draft PR #8](https://github.com/alanxiaofeifei/yourfeed/pull/8) 为任务入口，合并与实时 CI 状态待核对。
- 分支：`feat/first-use-onboarding`。差距修复 `2a4c905`，以 `96902c4` 合并 main `ba996a5`，启动器修复 `d2b2d82`，文档提交 `da05210`；已推送。预览版本号不是 Git SHA。
- 当前状态：预览已准备好供 Alan 审阅；生产 `yourfeed` 和 `yourfeed-member-001` 未因本任务部署，均须 Alan 明确批准。

## 进展与证据
- 四语、可恢复引导、首页入口与账号级进度已完成；保留来源入口、隔离和费用警告，Cerebras 文案与翻译覆盖已补齐。介绍视频已完成；首次使用配置引导视频排在 onboarding 之后。
- `d2b2d82` 修复初始化竞态：session `userId` 尚未解析时禁用 Getting started 启动器，避免菜单关闭导致 Resume 元素 detached。
- 本地：696 项单元测试、typecheck、build 和本地 e2e 12/12 通过。此前 `/workspace/yourfeed-onboarding-20261112/GAP_DONE.md` 记录 Node 24.22.1 / npm 11.21.1 及旧基线；早期 `DEV_DONE.md` 也不覆盖最新结果。PR CI 尚待核对。
- 远程 smoke 第一轮 8/8 在启动器后的恢复步骤失败；第二轮 8/8 因预览 spec 的 HTML lang 断言错误失败：期望 `vi`，应用正确设置 `vi-VN`，预览套件（仓库外）已修正。第三轮约 22:05 +08:00 为 7/8：`vi-mobile` 一次在 `openTarget` 后等待精选列表对话框失败，单独重跑 2/2 通过；记录为 flaky 观察项，当前不阻塞预览审阅。
- 覆盖新账号弹窗、skip/back、退出和恢复、首页 Getting started 重新打开、实时语言切换及区域重叠检查；四语言 × 桌面 1280×800 / 手机模拟 390×844。70 张截图位于本机 `/workspace/yourfeed-onboarding-20261112/preview-shots/`，关键字段已遮盖，分享前仍须检查。
- 未验证：真实 AI provider / YouTube 调用、邮件投递、OAuth、真实设备、读屏器、200% 缩放及生产／成员线上验收；synthetic fixture 和模拟设备不替代这些检查。
- 模型与工具：开发／修复使用 dsh 0.2.2-rc.2 + OpenAI `gpt-6.1-sol`（high），复用项目已验证配置；ModelDial Coding 2026-11-14 快照：6.1 Sol 前端 96、综合 88.10、$1.69（评测费用，非本项目实际费用）；本轮未交叉核对 Arena。文档使用 `gpt-6.1-terra` medium；预览 spec 单行修复使用 `codex --profile deepseek`。

## 恢复信息
- 本次检查点文档改动未提交、未推送；已推送的代码和此前文档不代表本次修改已同步。勿据本地结果推断 PR 已合并或 CI 通过。
- 非生产 Worker `yourfeed-onboarding-preview`，https://yourfeed-onboarding-preview.alan-xiaofei224.workers.dev，版本 `24d7a8f4`；独立 D1 `yourfeed-onboarding-preview` 已迁移，standalone auth，合成 owner 使用 fixture OTP，cutoff `2026-11-01T00:00:00Z` **仅供预览**。登录／秘密材料仅在本机 `/workspace/yourfeed-onboarding-20261112/private/preview-login.env`（600）；勿读取、打印或提交。操作与 smoke 见仓库外 `/workspace/yourfeed-onboarding-20261112/preview/PREVIEW.md`。
- 生产 `yourfeed` 当前版本 `9c55d8b3`（回滚 `a316592e`），`yourfeed-member-001` 当前版本 `16a2d9db`（回滚 `20badd17`）；本任务未部署到两者。
- 下一步：Alan 审阅预览；明确同意后将 `ONBOARDING_AUTO_OFFER_CUTOFF` 设为实际上线日，按 [部署文档](deployment.md) 先迁移并部署生产、smoke，再部署 member-001。需要回滚时使用相应 ID 执行 `wrangler rollback <id>`；代码回滚不会撤销数据库迁移。之后不再需要预览时，从 preview 目录执行 `ALLOW_PREVIEW_REMOTE=yourfeed-onboarding-preview CONFIRM_PREVIEW_TEARDOWN=yourfeed-onboarding-preview bash RUNBOOK.sh teardown`，仅删除预览 Worker 和 D1。
- 必要条件：适当 GitHub / Cloudflare 权限及隔离预览凭据；不得使用生产或成员 D1、secrets、routes 或真实成员数据。生产及 member-001 发布均须 Alan 在预览审阅后明确同意。
