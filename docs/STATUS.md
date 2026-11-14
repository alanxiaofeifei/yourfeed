# 当前项目状态

更新时间：2026-11-14T21:35:00+08:00

## 当前目标
- 目标与范围：完成 [Draft PR #8](https://github.com/alanxiaofeifei/yourfeed/pull/8) 的四语言（zh-CN / en / zh-TW / vi）可恢复首次使用引导，并先在独立非生产预览中供 Alan 审阅。计划原文在仓库外 `/workspace/yourfeed-onboarding-20261112/PLAN.md`；其中旧的待确认方案以此处确认决定和实际实现为准。
- 验收条件：新账号可开始、跳过、退出并恢复引导，旧账号可手动启动；覆盖语言、偏好、RSS 来源与阅读、可选 AI / YouTube，区分查看、保存和真实验证，失败保留草稿；桌面、手机及无障碍可用，不改变鉴权或实例隔离。RSS 不依赖 AI key。完整条件见计划和 PR；实际实现为内联引导，不持久化独立阅读／搜索操作证明。
- 已确认的重要决定：保留两个来源入口，引导走「发现与导入 → 精选推荐」；已有账号不自动弹窗，首页突出显示 Getting started；zh-TW、vi 与 zh-CN、en 一同完整翻译。优先推荐 Google AI Studio 和 Groq；NVIDIA 免费但有配额／限速且无需支付方式。Cerebras 需验证支付方式，一次性 $5 / 30 天试用，无永久免费层（2026-11-14 核实 [官方账单](https://inference-docs.cerebras.ai/console/account-billing.md)及[限额](https://inference-docs.cerebras.ai/support/rate-limits.md)）。`ONBOARDING_AUTO_OFFER_CUTOFF` 为生产上线当天，在部署时设置；预览值不能用于生产。

## 工作入口
- Issue：未核实；以 PR 为任务入口。
- PR：[Draft #8](https://github.com/alanxiaofeifei/yourfeed/pull/8)，尚待预览审阅；合并与实时状态需核对。
- 分支：`feat/first-use-onboarding`。
- 代码 / 验证基线：差距修复 `2a4c905`，再以 `96902c4` 合并 main `ba996a5`；本地验证见下，后续并行修复需重新验证。预览版本号不是 Git SHA。
- 当前负责人或整合者：并行 Agent 正在修复远程 smoke；最终整合者需核对实际改动。

## 进展与证据
- 已完成：四语、可恢复引导、首页入口与账号级进度；保留来源入口、隔离和费用警告，Cerebras 文案与翻译覆盖已补齐。介绍视频已完成；首次使用配置引导视频排在 onboarding 之后。
- 已执行检查、结果、证据：`/workspace/yourfeed-onboarding-20261112/GAP_DONE.md` 记录 Node 24.22.1 / npm 11.21.1：单元测试 61 文件 / 696 项通过，typecheck、build 通过，本地合成数据 e2e 10/10 通过。较早 `/workspace/yourfeed-onboarding-20261112/DEV_DONE.md` 为旧基线，不覆盖该结果。PR CI 在推送后检查，目前待确认。
- 尚未执行的必要检查：修复后重跑远程 smoke；真实 AI provider / YouTube live calls、读屏器、真实设备及邮件投递未验证，本地 mock 不代表线上兼容性。
- 未完成 / 已知问题：远程 smoke **进行中**；2026-11-14 21:26 +08:00 第一轮 8/8 在 Getting started 启动后恢复步骤失败（element detached），弹窗、欢迎及返回步骤通过并有截图。修复进行中，重跑待完成；不应视为预览验收通过。
- 有后续价值的失败尝试：上述 8 个语言／设备项目均卡在相同恢复步骤；本地 e2e 通过不能替代远程验证。此前单测发现过期的 Cerebras 文案预期，修正后全套重跑通过（详见 GAP_DONE）。
- 模型与工具：开发／修复使用 dsh + OpenAI `gpt-6.1-sol`（high），复用项目已验证配置；ModelDial Coding 2026-11-14 记录 6.1 Sol 前端 96、评测费用 $1.69，非本项目实际费用。本次文档使用 `gpt-6.1-terra` medium。

## 恢复信息
- 未提交或未推送改动：本检查点文档及并行 app／test 修复可能尚未提交或推送；交接时以 Git 实况核对，勿覆盖并行工作。
- 远程同步状态与阻塞：本次文档修改未提交、未推送；推送后检查 PR CI。预览审阅和生产发布仍待 Alan 明确批准；不得据本地结果推断合并或线上验收。
- 正在运行的任务 / 已执行外部操作：远程 smoke 修复进行中；此前已创建和部署隔离预览，已执行第一轮远程 smoke。除预览外未触碰生产和成员实例。
- 部署环境、版本及验证状态：非生产 Worker `yourfeed-onboarding-preview`，地址 https://yourfeed-onboarding-preview.alan-xiaofei224.workers.dev，版本 `aca872cb`；全新独立 D1 `yourfeed-onboarding-preview` 已迁移，standalone auth，合成 owner 通过 fixture OTP 登录，cutoff `2026-11-01T00:00:00Z` **仅供预览**。登录／秘密材料仅在本机 `/workspace/yourfeed-onboarding-20261112/private/preview-login.env`（600）；勿读取、打印或提交。预览操作与 smoke 见仓库外 `/workspace/yourfeed-onboarding-20261112/preview/PREVIEW.md`。生产 `yourfeed` 仍为 `9c55d8b3`（回滚 `a316592e`），`yourfeed-member-001` 为 `16a2d9db`（回滚 `20badd17`）；未因本任务部署。
- 下一步可直接执行的动作：协调并行修复完成后，在独占预览窗口按 `preview/PREVIEW.md` 重跑远程 smoke、核对截图与 CI，展示 Alan；获明确批准后设置实际上线日 cutoff，按 [部署文档](deployment.md) 先迁移再部署生产、smoke，再部署 member-001。需要回滚时使用 `wrangler rollback <id>`；代码回滚不会撤销数据库迁移。预览不再需要时，从 preview 目录执行 `ALLOW_PREVIEW_REMOTE=yourfeed-onboarding-preview CONFIRM_PREVIEW_TEARDOWN=yourfeed-onboarding-preview bash RUNBOOK.sh teardown`，仅删除预览 Worker 和 D1。
- 必要的访问条件：适当 GitHub / Cloudflare 权限及隔离的预览凭据；不得使用生产或成员 D1、secrets、routes 或真实成员数据。生产及 member-001 发布均须 Alan 在预览审阅后明确同意。
