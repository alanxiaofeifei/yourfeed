# 当前项目状态

## Phase A / Issue #11（issues #11–#16 第一阶段，本地检查点）
- 目标：用轻量 popover + 单 spotlight + 箭头替换旧内联 tour；[ADR 0001](adr/0001-lightweight-onboarding-tour.md) 选独立实现的 driver.js-like MIT 方案，无新增依赖。分支 `feat/first-use-onboarding` / [PR #8](https://github.com/alanxiaofeifei/yourfeed/pull/8)。本节优先于下方旧反馈实现说明。
- 根因证据：真实 Cloudflare 构建经本地 Wrangler 提供资源，trusted click→两次 rAF 的可绘制帧代理（非物理呈现/INP）；旧 Next/Skip/Back 在 PATCH 完成后才变化。明确模拟 PATCH +250ms 时 36/36 导航请求先完成才呈现；Exit 独立受保留子树约180ms退出期拖慢。不是把开发 Profiler 数字当生产证据，也未声称测到了 Alan 线上真实 RTT。
- 实现：子控制器立即乐观切步，串行后台 CAS 保留每个 viewed/skipped 操作；确认响应只更新证据/基线，失败回滚并显示错误，409 重读且不覆盖其他标签页退出。删除 retained-exit 路径。浮层翻转/视口约束、手机紧凑 sheet、dialog 内 focus scope、目标透明高亮与 transform 箭头、四语短文+完整说明 disclosure、Esc/左右键/Tab/稍后继续；modal 为 sheet 保留独立滚动区域。无 API/schema/鉴权/隔离/权限改变。
- 测量文件：仓库外 `perf-A-before.json`、`perf-A-after.json`；可复测步骤见 [e2e/PERFORMANCE.md](../e2e/PERFORMANCE.md)。每设备/网络场景48次（Next/Skip/Back/Exit各12）；手机390×844/CDP4×，桌面1280×800。
- 运行边界：仅本地合成 API/数据、真实 dist 资源；本地 Wrangler 使用安装 workerd 支持的 compatibility-date 与仅测试的 AUTH_MODE:sites 页面渲染覆盖，不验证 standalone 登录。未读取私密目录、未 push/deploy/远程 Wrangler。
- 当前下一步：最终几何修正已 Cloudflare build exit0；正在复跑完整 e2e、同一性能 harness 与四张 synthetic 截图。完成前不将初轮 after 数字当最终验收。


更新时间：2026-11-14（Alan 预览反馈，本地检查点；未发布）

## PR #8 Cerebras 移除决定（2026-11-14，本地）
- Alan 决定：Cerebras 需要支付方式验证，从四语首次使用引导（含步骤、官方链接、说明与费用警告中的点名）及推荐／免费层亮点中移除，取代下方旧版 Cerebras 引导说明。Google AI Studio、Groq 和 NVIDIA 的现有说明保留。
- 最小兼容方案：完整预设选择器仍将 Cerebras 作为普通、非推荐选项显示；移除其 `freeTier` 元数据和旧试用宣传翻译，不隐藏或改写已有用户配置。保留 provider 类型、官方 endpoint/model、密钥解析、设置读写、费用估算／预算预留及连接测试，不做 schema、鉴权或隔离改动。零估算不保护上游预算的四语通用警告继续显示。
- 回归：四语引导和文档断言 Cerebras 完全缺席；设置渲染无免费层标签，保存的 Cerebras 配置／加密密钥、切换恢复、估算与用量限制、mock endpoint/probe 及浏览器连接测试继续覆盖；不调用真实服务商。
- 验证：`npm test -- --maxWorkers=1 --no-file-parallelism` **720/720（62 files）**、`npm run typecheck`、`YOURFEED_BUILD_PROFILE=cloudflare npm run build`、`PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/google-chrome npm run test:e2e -- --workers=1` **26/26** 均 exit 0。新增四语浏览器回归确认引导无 Cerebras，已保存预设仍可加载并触发 mock 连接测试；未调用真实 API。构建仍有已知 lucide / dynamic-import 提示及只读 HOME 的 Wrangler 日志 EROFS（不影响产物与退出码）。Node 24.22.1 / npm 11.21.1、现有 package-lock；最终 diff 已审阅。仓库外日志：`unit-cerebras-final.log`、`typecheck-cerebras-final.log`、`build-cerebras-final.log`、`e2e-cerebras-final.log`。
- 同步：沿用 `feat/first-use-onboarding` / [PR #8](https://github.com/alanxiaofeifei/yourfeed/pull/8)，保留此前未提交反馈改动；本轮不提交、不 push、不部署，不读取私密目录。PR 仍为 OPEN，线上与 CI 验证不在本次本地结果范围。

## PR #8 预览反馈检查点
- 范围：六项反馈已实现；分支仍为 `feat/first-use-onboarding`。没有鉴权服务、实例隔离、权限、schema 或新增设置功能改动；未读取私密目录，未 push/deploy/执行远程 Wrangler。
- 性能根因：`useTour` 在 Home 内持有进度、busy、目标缺失状态，步骤更新重渲染整页。改为子控制器持有状态，并 portal 到普通文档流的目标槽位（来源弹窗内仍在原 focus scope）。新 spotlight 用 rAF 合并 DOM/scroll/resize 通知、ResizeObserver 跟踪尺寸，几何样式不进 React state，无轮询。原有步骤 PATCH 已返回证据，未发现每步 GET 或自动 provider 请求；不将未观测到的 layout thrash 当根因。
- 相同本地 synthetic React 开发 harness，连续五次 Next（含 Playwright 点击/断言开销），前→后：Profiler 子树 commits **16→11**（每步 3.2→2.2），React 累计 render **155.8→8.0 ms**；平均步骤延迟 **73.0→65.3 ms**；long tasks **0→0**；onboarding **GET 0→0 / PATCH 5→5**。全页 getBoundingClientRect 计数 **2→6**，新增 spotlight 跟随目标是预期功能成本，不宣称减少；后测 30 次同步 resize 突发共 4 次全页几何读取（含现有站点 motion）。单轮方向性数据，不是生产设备保证。JSON：仓库外 `perf-before.json` / `perf-after.json`；复测命令见 first-use 文档。
- 入口根因：此分支启动器原本就不按完成/退出状态隐藏；但 Home 单独一次 session 请求失败会静默保留空 identity，而账户菜单可独立重试，导致菜单已登录、启动器仍禁用。现在复用账户菜单确认的 identity 与重试；永久、突出的普通流首页工具栏不受新旧账号、cutoff 或状态限制。无法仅凭源码证明 Alan 那次历史登录的具体网络状况。
- 视觉/无障碍：复用 YourFeed Editorial Motion v2 字体、颜色、hairlines、180/360ms easing；开/关和步骤揭示，目标轮廓/光晕与轻微 dim，dim `pointer-events:none`。手机不使用浮动提示盖住控件；目标平滑滚动，reduced-motion 无 transform/动画、即时滚动；标题聚焦、四语 aria-live、来源 dialog Tab 范围已回归。
- 账户决策：右上角「我的账户」为唯一账户入口，身份在下拉内；左下角改为非交互隐私说明和入口指引，去除容易混淆的 profile 名称/头像，不承诺额外权限/加密语义。zh-CN/en/zh-TW/vi 新文案均完整。`docs/settings-proposals.md` 仅有七个价值/工作量/风险提案，未构建新功能。
- 验证：`npm test -- --maxWorkers=1 --no-file-parallelism` **714/714**（62 files）、`npm run typecheck`、`YOURFEED_BUILD_PROFILE=cloudflare npm run build` 均 exit 0；构建产物完成，工具仍输出 lucide barrel / dynamic import 提示及只读 HOME 下 Wrangler 日志 EROFS 警告，不影响构建退出码。`PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/google-chrome npm run test:e2e -- --workers=1` **22/22**（含 1280×800 / 390×844、四状态退出后再次登录、session 失败重试、四语切换、spotlight 跟随/几何/可点击、reduced-motion、dialog Tab、手动来源表单的真实非零尺寸 spotlight 与账户整合）。初轮集成测试发现 portal 槽位交接被旧 ref 的 null 覆盖，已修复并全测；测试 retry 英文 selector 拼写也已修正。
- 截图：`/workspace/yourfeed-onboarding-20261112/feedback-shots/` 的 `desktop-spotlight-zh-CN.png`、`mobile-spotlight-zh-CN.png`、`desktop-home-button-en.png`、`mobile-account-menu-zh-CN.png`、`reduced-motion.png`；均本地合成数据、无密钥值，已目视检查。
- 未验证：真实账户第二次登录历史原因、真实设备/读屏/200% 缩放、邮件/OAuth/真实 provider 和 YouTube、PR CI/远程最新状态。运行 Node 24.22.1 / npm 11.21.1、现有 package-lock；工具沿用本项目已验证组合，实际可控模型/费用/上下文档位不可独立核实，未声称切换。
- 同步：本轮改动全部保留本地且 **未暂存**；尝试本地 checkpoint 提交在 git add 阶段因 linked-worktree 的只读 index.lock 被 sandbox 拒绝（exit 128），未重试绕过；已确认 cached diff 为空。没有本地新提交/推送/合并/发布。本次检查点优先于下方旧预览验收和发布下一步。
- **下一步：Grok 仅重新部署独立 preview，Alan 审阅；不部署生产或成员实例。**


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
