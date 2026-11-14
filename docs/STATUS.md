# 当前项目状态


## Issue D / #14 检查点（2026-11-15 03:44 UTC+8，已推送并部署 preview）
- 提交 `8df845e`（免 Key 免费公共通道）+ `0a5b9bc`（Cloudflare 出口实测后调参）已推送 PR #8；preview `yourfeed-onboarding-preview` 版本 `aa2786a0`（上一版 `26c055d7`）。仅代码部署：未重传 secret、未迁移、未重置 preview D1。生产 `yourfeed` 与 `yourfeed-member-001` 未动。
- Cloudflare 出口实测（临时探针 Worker，复用 `buildFreeAiRequest`，colo CMH，用后已删除）：OVH 默认请求 25s 超时；加 `reasoning_effort:"low"` 后 200/3.3s、合法 JSON（复测 200/3.26s）；Pollinations 200/12.7s（复测 0.33s，疑为缓存命中）；约 2 分钟内第 4–5 次 OVH 请求返回 429（匿名额度 2 次/分钟/IP/模型）。结论：可用但会限流，降级到精选题库是常态之一。
- 门禁（D3）：unit 793/793、typecheck、Cloudflare build、生产 e2e 63 passed / 11 skipped；性能门禁在 D2 通过（tour 未改）。
- 未验证：通过 preview 应用本身（需 Alan 登录）走一遍真实出题。工具：Codex CLI exec，gpt-6.1-sol，reasoning high。
## D3 / Issue #14（2026-11-15，仅本地）
- 分支 `feat/first-use-onboarding`，基线 `8df845e`；按仓库外 `TASK_D3.md` 执行，不 commit/push、GitHub 写入或远程 Wrangler，不读取私密目录或密钥，不调用真实服务。
- OVH 固定请求新增 `reasoning_effort:"low"`，保留 JSON / token 限制；Pollinations 请求不变。偏好出题服务端总计 8 秒，前端 9 秒回退；普通免费任务仍总计 8 秒，OVH 最多 6 秒，备用通道使用剩余预算。
- 原有 Retry-After 已覆盖秒数 / HTTP 日期；补充 reset 头冷却（最少 30 秒）及边界测试。依据任务提供的 CMH 探测：OVH low 3.3 秒成功、默认 25 秒超时、备用 12.7 秒成功且 OVH 随后限流；非本轮实测或线上验收。
- 最终门禁（Node 24.22.1 / npm 11.21.1，现有 package-lock）：unit **793/793（65 files）**、typecheck、Cloudflare build、生产模式本地 e2e **63 passed / 11 skipped** 与 `git diff --check` 全通过。网络均 mock；覆盖 6/8 秒边界、3.3 秒 OVH 成功、7.5 秒浏览器成功、9 秒中止回退及 429 冷却边界，保留校验 / 预算断言。日志在仓库外 `unit-D3.log`、`typecheck-D3.log`、`build-D3.log`、`e2e-D3.log`；完成记录 `D3_DONE.md`。本节覆盖下方旧时间预算，D3 已完成；下一步仅审阅本地 diff。未提交、推送、合并、部署或线上验证。

## Issue D / #14（2026-11-15，仅本地，未提交或部署）
- 入口：[Issue #14](https://github.com/alanxiaofeifei/yourfeed/issues/14) / [PR #8](https://github.com/alanxiaofeifei/yourfeed/pull/8)，分支 `feat/first-use-onboarding`，基线 `bebe8dc`（含 `354b244`）。任务 `TASK_D2.md` 禁止 commit/push、GitHub 写入与远程 Wrangler；本轮无迁移、鉴权、隔离或权限改动，未读取私密目录。
- 默认免 key 服务端通道 OVHcloud → Pollinations → 精选题库/普通阅读，覆盖显式偏好出题、来源辅助、画像及单篇阅读；不用于自动/后台分析或连接测试。固定请求构造导出在 `server/free-ai.ts`，过滤 reasoning、校验 JSON、限制响应大小；每端点 isolate 冷却 30 秒并尊重 Retry-After，既有 meta 原子限制每独立单所有者实例每天 10 次。偏好出题保持服务端总计 5 秒 / 前端 6 秒回退，其他显式免费请求总计 8 秒。
- 四语免费/失败/自带 key 费用告知、不可复制的掩码字段、恢复默认（保留加密密钥），主动保存可重新选择自带连接。实现与限制见 [first-use-onboarding.md](first-use-onboarding.md)。工具沿用本项目已验证执行环境，实际费用/上下文占用不可读取，未声称切换模型。
- Box 有意实测各 1 次：OVH 200 / 18.326s、Pollinations 200 / 4.483s，均有效 JSON 且剥离 reasoning。首轮旧来源 API 测试遗漏 mock 另产生 2 次合成请求尝试，已补 mock，累计 4 次后停止；不代表 Cloudflare 出口或线上可用性。仓库外 `live-D.json` 保存实测元数据。
- 最终门禁（Node 24.22.1 / npm 11.21.1，现有 package-lock）：unit **778/778（65 files）**、typecheck、Cloudflare build、生产 e2e **61 passed / 11 skipped**、性能 `TOUR_PERF_ASSERT=1` **1/1（192 样本）**、截图 **2/2** 与 `git diff --check` 全通过。桌面四动作两种网络场景 p95 最高 31.5ms（门槛 100ms），手机 390/CDP4× 最高 37.0ms；这是可绘制帧代理，不是物理呈现。仓库外 `unit-D.log`、`typecheck-D.log`、`build-D.log`、`e2e-D.log`、`perf-D.log`、`screenshots-D.log`、`perf-D.json` 和 `phaseD-shots/`（中文桌面/手机设置，已目视检查）。所有最终单元网络与浏览器 API 均 mock；Cloudflare 出口、真实移动设备及生产尚未验证。任务完成记录见仓库外 `D_DONE.md`；下一步审阅本地 diff，运营者可复用导出模块做另行授权的 Cloudflare 出口探测。本轮不提交、不推送、不部署。

## Arrow 修复 + Issue B / #12（2026-11-15，已推送并部署 preview）
- 检查点（2026-11-15 03:18 UTC+8）：提交 `354b244` 已推送到 PR #8，并部署到 preview `yourfeed-onboarding-preview` 版本 `26c055d7`（上一版 `be703246`），仅代码部署：未重传 secret、未迁移、未重置 preview D1；线上 `/api/health` 200、新卡片资源已确认。生产 `yourfeed` 与 `yourfeed-member-001` 未动。工具：Codex CLI exec，gpt-6.1-sol，reasoning high。下一步：Alan 审阅预览后做 C（不喜欢按钮）/ D / E / F。
- 分支 `feat/first-use-onboarding` / [PR #8](https://github.com/alanxiaofeifei/yourfeed/pull/8) / [Issue #12](https://github.com/alanxiaofeifei/yourfeed/issues/12)，基线 `6d15de1`；未改生产或成员配置。
- 箭头贴 popover 面向目标的边缘，偏移限位、尖端指向目标中心；随翻转、resize、scroll、切步重算；手机 detached sheet 隐藏箭头。中英 1280/390 几何断言覆盖四向、RTL 与尺寸变化，保留 reduced motion 与原性能门槛。
- 四语十题卡片、进度、单题/全程跳过、手动输入兴趣/选主题、首页/偏好设置/精选来源重入；既有 settings 保存 CAS 进度与题目，确认后才保存 profile、按批导入勾选来源；可撤销本次实际新增，重复来源不删。复用既有表和接口，无 schema、鉴权、隔离或权限改变。实现说明见 [first-use-onboarding.md](first-use-onboarding.md)。
- AI 为显式定制：复用当前用户 provider 与预算账本，5s provider 超时、6s 前端回退；十题、唯一 ID/维度、文本长度、主题及目录 ID 严格校验，失败回精选题库；Issue D 未实现。19 源实测 18 个有效 RSS/Atom，Solidot 403，以橘鸦/BBC 替代；证据仓库外 `feed-B-verification.json`。
- 最终门禁（Node 24.22.1 / npm 11.21.1，现有 package-lock）：unit **751/751（64 files）**、typecheck、Cloudflare build 全通过；生产 e2e **52 passed / 9 opt-in或开发专用 skipped**，截图另跑 **7/7**，性能 `TOUR_PERF_ASSERT=1` **1/1**（两轮各 192 样本）通过；`git diff --check` 通过。日志在仓库外 `unit-B.log`、`typecheck-B.log`、`build-B.log`、`e2e-B.log`、`screenshots-B.log`、`perf-B.log`。
- 点击→可绘制帧代理最终 p50/p95（ms，Next/Skip/Back/Exit，每动作12次）：桌面原生 **30.0/31.1 · 29.7/30.7 · 29.5/30.7 · 29.4/31.3**；桌面模拟 PATCH+250ms **29.9/31.6 · 29.5/31.3 · 30.1/31.3 · 29.6/31.2**；手机390 CPU4×原生 **28.5/30.2 · 28.1/30.3 · 28.3/30.6 · 27.4/30.4**，+250ms **28.2/30.2 · 28.9/30.4 · 28.4/31.3 · 28.2/33.5**。与 Phase A 典型水平一致；首轮手机+250ms Next 单次120.3ms尖峰，同构建复测未复现，保留 `perf-B-first.json`，不推定其原因。
- 截图：仓库外 `phaseA-shots/` 四张已重生成；`phaseB-shots/desktop-cards-zh-CN.png`、`mobile-cards-zh-CN.png`、`desktop-cards-en.png` 已生成并目视检查。所有浏览器 API/数据为合成，构建经本地 Wrangler 提供；未调用真实 provider，未验证真实移动设备/屏幕阅读器。profile 与 sources 分步保存，Undo 在本次结果页仅移除实际新增来源。

## Phase A / Issue #11（issues #11–#16 第一阶段，本地检查点）
- 目标：用轻量 popover + 单 spotlight + 箭头替换旧内联 tour；[ADR 0001](adr/0001-lightweight-onboarding-tour.md) 选独立实现的 driver.js-like MIT 方案，无新增依赖。分支 `feat/first-use-onboarding` / [PR #8](https://github.com/alanxiaofeifei/yourfeed/pull/8)。本节优先于下方旧反馈实现说明。
- 根因证据：真实 Cloudflare 构建经本地 Wrangler 提供资源，trusted click→两次 rAF 的可绘制帧代理（非物理呈现/INP）；旧 Next/Skip/Back 在 PATCH 完成后才变化。明确模拟 PATCH +250ms 时 36/36 导航请求先完成才呈现；Exit 独立受保留子树约180ms退出期拖慢。不是把开发 Profiler 数字当生产证据，也未声称测到了 Alan 线上真实 RTT。
- 实现：子控制器立即乐观切步，串行后台 CAS 保留每个 viewed/skipped 操作；确认响应只更新证据/基线，失败回滚并显示错误，409 重读且不覆盖其他标签页退出。删除 retained-exit 路径。浮层翻转/视口约束、手机紧凑 sheet、dialog 内 focus scope、目标透明高亮与 transform 箭头、四语短文+完整说明 disclosure、Esc/左右键/Tab/稍后继续；modal 为 sheet 保留独立滚动区域。无 API/schema/鉴权/隔离/权限改变。
- 测量文件：仓库外 `perf-A-before.json`、`perf-A-after.json`；可复测步骤见 [e2e/PERFORMANCE.md](../e2e/PERFORMANCE.md)。每设备/网络场景48次（Next/Skip/Back/Exit各12）；手机390×844/CDP4×，桌面1280×800。
- 运行边界：仅本地合成 API/数据、真实 dist 资源；本地 Wrangler 使用安装 workerd 支持的 compatibility-date 与仅测试的 AUTH_MODE:sites 页面渲染覆盖，不验证 standalone 登录。未读取私密目录、未 push/deploy/远程 Wrangler。
- 最终门禁（2026-11-15 02:09 UTC+8）：unit 731/731、typecheck、Cloudflare build、生产模式 e2e 36 passed/6 opt-in skipped、性能 harness `TOUR_PERF_ASSERT=1` 通过、4 张截图（仓库外 `phaseA-shots/`）。
- 点击→可见反馈 p50/p95（ms，12 次/动作，最终 `perf-A-final.json`）：桌面 Next 30/31、Skip 30/31、Back 30/32、Exit 30/32；模拟 PATCH+250ms 时桌面 Next 30/43、其余 30/31；手机 390×844 CPU4× 全部 27–29/29–31。改前：桌面 Next/Skip/Back 46/47、Exit 213/216；+250ms 时 279–280；手机 +250ms 时 Next 295/444。
- 检查点（2026-11-15 02:15 UTC+8）：Phase A 提交 9c3a1d6 已推送并部署到 preview `yourfeed-onboarding-preview` 版本 be703246（上一版 de0fff18）；线上已确认新 tour CSS 资源，未重置 preview D1，生产 `yourfeed` 与 `yourfeed-member-001` 未动。之后按 #12–#16 顺序做 B–F。


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
