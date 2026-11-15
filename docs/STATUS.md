# 当前项目状态

## 未完成（2026-11-15 收尾登记）

首次使用引导（#11–#16 / PR #8）和 AI 速览（#21 / PR #22）已上线生产与 member-001，预览已拆除，不必重做。仍待执行：

- [Issue #26](https://github.com/alanxiaofeifei/yourfeed/issues/26) 五人独立受邀托管（目前仅有 member-001；邀请链接先交给 Alan，不要联系 linh）
- [Issue #27](https://github.com/alanxiaofeifei/yourfeed/issues/27) 首次使用配置引导视频（README 入口已有，成品视频未按上线后 UI 制作）

跨项目索引：[project-overview#5](https://github.com/alanxiaofeifei/project-overview/issues/5)

---


## 生产上线（2026-11-15 12:55 UTC+8）：免费通道 Groq 补充 / PR #24
- 合并 [PR #24](https://github.com/alanxiaofeifei/yourfeed/pull/24) → `main` `d4a293ad2ed93ae47bbc8bd053b3fa93ae0de748`。顺序：Groq `openai/gpt-oss-120b` →（仅限流）`openai/gpt-oss-20b` → OVHcloud → Pollinations；仍计入每实例每天 10 次。
- 运营者 secret `FREE_AI_GROQ_API_KEY`（Alan 提供的 Groq Key，经 stdin 写入，值不入仓库/日志）已设置于 `yourfeed` 与 `yourfeed-member-001`。无迁移；部署前书签：生产 `0000002a-00000000-00005124-14fa0f9b4bde8999c30c1fa664fd75c7`，member `0000004e-00000000-00005124-5833d50d23a7930aa0842128207b15a2`。
- 生产 `yourfeed` 当前版本 `e92c4384-e2bd-44d4-b748-f3c90b84a599`（代码 `d2a7bb53` + secret）；回滚 `wrangler rollback 0db23263-919a-4f73-b8cd-dbf85ef11f07 --name yourfeed`。无 cron。
- `yourfeed-member-001` 当前版本 `17e8a935-61e8-4639-94db-6c13c72a57d2`（代码 `109c8e0b` + secret）；回滚 `wrangler rollback ec6501ff-0341-4c6c-87f4-10731ce9e54b --name yourfeed-member-001`。cron `*/15`、`BACKGROUND_SCHEDULE_CONFIGURED=true`、workers.dev/preview 关闭、自定义域保持。
- 验证：两端匿名 smoke 通过（health ok/schemaReady、/login 200、API 401、/ → /login）。Cloudflare 出口（临时探针 Worker，CMH，已删除）：120b 200 / 510–765 ms、20b 200 / 280–356 ms，均为合法 JSON。登录后经应用真实调用未验证。

## 本地候选（2026-11-15）：免费公共通道运营者补充

- 任务入口：仓库上一级 `TASK.md`；分支 `feat/free-ai-groq`，基线 `e389059`。可选 `FREE_AI_GROQ_API_KEY`：120b → 仅限流时 20b → OVH → Pollinations；未设置时原请求不变。按模型冷却、剩余额度预冷却、单次最多 4 秒及总计 8 秒，沿用每实例每天 10 次且每任务只计一次。
- 运营者密钥只用于免费通道内部出站请求，不改变用户自带 Key 判断、自动分析、免费标签或公开 health；既有设置 API 的自带 Key 供应商目录本来含 Groq，完整保持不变。无迁移、新依赖、锁文件或权限/隔离变更。全部网络测试使用合成 mock。
- `FIX.md` 修复：Groq 使用独立进行中预约，成功后间隔 2 秒；响应头要求的更长冷却保留，OVH/Pollinations 仍维持 30 秒间隔。新增 4 例回归验证连续成功、2 秒边界、剩余请求为零及 OVH 间隔。
- `FIX2.md` 修复：预冷却只采用对应耗尽额度的 reset；429 保留 Retry-After，无法识别额度时取最长 reset。输入按 UTF-8 字节约每 3 字节一个 token 加 2048 输出估算，超过 8K TPM 的任务直接跳过两种 Groq，不修改冷却；无效的限额成功响应转 OVH，解析有效后才允许后续任务用 20b；duration 支持 us/µs/ns。新增 12 例 mock 回归并修正原 6 例冷却边界。
- 最终门禁（FIX2 后重跑并覆盖日志）：Node 24.22.1 / npm 11.21.1；单元 1001/1001（70 files，原新增 38 例、FIX 4 例及 FIX2 12 例）、typecheck、Cloudflare build、生产模式 E2E 115 passed / 29 既有跳过、`git diff --check` 全通过。记录与日志在仓库上一级 `DONE.md`、`FIX2_DONE`、`unit.log`、`typecheck.log`、`build.log`、`e2e.log`。仅本地未提交、未推送、未部署，无 GitHub 写入或远程 Wrangler；下一步审阅本地 diff，任何实例发布另行授权。

## 生产上线（2026-11-15 12:08 UTC+8）：AI 速览 #21 / PR #22
- Alan 批准的三项决定：只总结「今日必看」3 条；无 Key 可用免费公共通道并计入每天 10 次；只在点击时生成。PR [#22](https://github.com/alanxiaofeifei/yourfeed/pull/22) CI 全绿后 squash-merge 到 `main` `c24ccf558f87f9fbfdcb0f3c93981300bc5e8801`，关闭 [#21](https://github.com/alanxiaofeifei/yourfeed/issues/21)。
- 无 D1 迁移（缓存用既有 `meta` 表）；两端远程迁移列表仍为 0000–0002。部署前 time-travel 书签：生产 `00000029-00000000-00005124-e765ebaa2613d60f077550f51c890488`，member `0000004a-00000000-00005124-e8a6a3cbd102866eaf8b85baa2c5dd22`（未使用）。未改 secrets、隔离、权限。
- 生产 `yourfeed` 版本 `0db23263-919a-4f73-b8cd-dbf85ef11f07`；回滚 `wrangler rollback 879d3d42-ccdb-4bbd-ab87-c9b77e8bb419 --name yourfeed`。仍无 cron。
- `yourfeed-member-001` 版本 `ec6501ff-0341-4c6c-87f4-10731ce9e54b`；回滚 `wrangler rollback 121e8747-db1b-4310-b99c-c8a94193b7c6 --name yourfeed-member-001`。cron `*/15 * * * *`、`BACKGROUND_SCHEDULE_CONFIGURED=true`、workers.dev / preview 关闭、自定义域保持。
- 匿名 smoke（两端通过）：`/api/health` ok/schemaReady；`/login` 200；`/api/feed`、`/api/settings`、`/api/briefing`、`/api/briefing/digest`（GET/POST）401；`/` → `/login`；静态资源含四语「AI 速览 / AI 速覽 / AI recap / Tóm tắt AI」。登录后真实生成未线上验证。

## Issue #21 · AI 一键速览「今日必看」（2026-11-15，本地验收完成）

- [Issue #21](https://github.com/alanxiaofeifei/yourfeed/issues/21) / [已批准方案](plans/ai-daily-digest.md)，分支 `feat/ai-daily-digest`，基线 `3cb12d0`；执行仓库外 `TASK.md` 与 `FIX_TASK.md`。所有改动未暂存、未提交、未推送、未合并、未部署；无 GitHub 写入或远程 Wrangler，未读取真实密钥或其他工作区私密文件。
- 只总结 `selectBriefing` 的最多 3 条，敏感字段完整检查后剔除、不补候选；摘要/已有要点限 400 字符，输出严格校验 JSON、1–5 点、引用 ID 与无 URL 文本。GET 完全只读；POST 手动生成、鲜缓存零调用、60 秒原子尝试节流与进行中租约；`meta` 每用户一行，失败时优先展示旧成功 AI 速览及原因，仅无缓存时使用非 AI 清单，回退不缓存为速览。
- 沿用免费公共通道的每实例每日 10 次计数和自带 Key 的 reserve/settle 预算账本；每次尝试用唯一 content_id，旧不确定预约仍占每日次数/月预算，进行中租约保持 180 秒，无新增额度计数器。四语速览、来源角标/原文/本地阅读器、更新标记、语言重生成提示、费用/第三方说明、无障碍与 390px 布局已实现；切换语言及页面加载仅 GET，无自动或后台生成。无迁移或新增依赖，锁文件、鉴权、隔离、权限、secrets、cron 与 `wrangler.jsonc` 未改。
- 最终门禁：Node **24.22.1** / npm **11.21.1**；unit **947/947（70 files）**、typecheck、Cloudflare build、生产模式 E2E **115 passed / 29 opt-in 或开发专用 skipped**、tour 性能 **1/1（192 样本，TOUR_PERF_ASSERT=1）**、`git diff --check` 通过。桌面最高 p95 **34.4ms <100ms**，手机 390/CDP4×最高 **59.3ms**（仅记录）；为可绘制帧代理，非真实设备或 INP。性能 JSON 资源 SHA256 已与最终 dist 核对。
- Review 修复回归：速览单元 **62** 例（新增 19）、浏览器 **19** 例（新增 6）；覆盖五类失败保留缓存、预约重试与真实预算限制、技术名称/URL 区分，以及成功 GET 清除网络错误；移除重复敏感输入断言。实现细化已更新方案 §12。
- 证据在仓库上一级：`unit.log`、`typecheck.log`、`build.log`、`e2e.log`、`perf.log` / `perf.json`、`shots/` 五张纯合成截图（中文桌面/手机、英文桌面、更新状态、回退状态）均已目视检查。前端节流到期停止计时器，浏览器虚拟时钟验证按钮恢复且零自动生成；未削弱既有门槛。
- 仅本地合成网络与真实构建验证；免费通道的限流/超时/额度统一 reason 及租约实现细化见方案 §12。真实 provider、预览/生产部署、真实设备与读屏验收未执行；下一步是审阅本地 diff，后续同步和任何实例发布另行授权。


## 生产上线（2026-11-15 09:50 UTC+8）：PR #8 已发布

- Alan 在预览验收后明确同意上线（「等你完成后，我确认可以上线了」）。PR #8 已标为 ready，CI Verify YourFeed 全绿后 squash-merge 到 `main`：`d3a9903a3faff0397d060fa4547ef18120a21da2`（2026-11-15 09:45 UTC+8）。包含轻量引导、偏好卡片、不喜欢学习、免 Key 免费 AI 通道、设置 7 项、按用户刷新方式，以及四语（zh-CN / zh-TW / en / vi）随语言切换即时更新的引导与偏好卡片文案。
- 部署时将 `ONBOARDING_AUTO_OFFER_CUTOFF` 设为实际上线时刻 `2026-11-15T01:48:42Z`（09:48:42 UTC+8）。已有账号不自动弹窗，首页保留常驻「新手引导」按钮；截止时刻之后创建的新账号会自动提供引导。未把预览用的过去 cutoff（2026-11-01）写入生产。
- 远程只读核对：生产与 member D1 均已应用 `0000_boring_enchantress.sql`、`0001_auth.sql`、`0002_library.sql`，无待执行迁移，因此未做任何 D1 migration。部署前 time-travel 书签：生产 `00000027-00000000-00005124-dee6c350fae0c8c8995741a5a6c89a2f`，member `0000003e-00000000-00005124-7bd299dd92b50c89a2c36200f91993c2`。未改 secrets、数据隔离或访问权限；未动 Financial、AlanFeed、个人门户或 `yourfeed-control`。
- 生产 `yourfeed`（https://yourfeed.alanzhu.dev）当前版本 `879d3d42-ccdb-4bbd-ab87-c9b77e8bb419`；回滚：`wrangler rollback 9c55d8b3-1c64-4769-a0a1-b34a6556fa26 --name yourfeed`。无 cron（与上线前一致）。`workers_dev` 仍为开启。自定义域 `yourfeed.alanzhu.dev` 仍指向该 Worker。
- `yourfeed-member-001`（https://yourfeed-m1.alanzhu.dev）当前版本 `121e8747-db1b-4310-b99c-c8a94193b7c6`；回滚：`wrangler rollback 5bcde704-b5bd-4396-9d9f-d44a0c61ea87 --name yourfeed-member-001`。保留 cron `*/15 * * * *`、`BACKGROUND_SCHEDULE_CONFIGURED=true`、托管绑定与变量、`workers_dev=false` / `preview_urls=false`，自定义域 `yourfeed-m1.alanzhu.dev` 仍指向该 Worker。`AUTH_EMAIL_FROM` 仍为 secret，未改写入 vars。
- 匿名 smoke（生产与 member 均通过）：`/api/health` 200 且 `ok`/`schemaReady`；`/login` 200；引导相关静态资源（含 `page-Dw_vvx8U.js` / `page.ByGxXZv9.css`）200，脚本中含四语文案「前往此处 / 前往此處 / Go here / Đi tới đây」；`/api/feed`、`/api/settings`、`/api/profile` 仍 401；`/api/session` 为未登录；匿名访问 `/` 仍转到 `/login`。代码回滚不会撤销数据库迁移（本次也没有迁移）。
- 两端健康后，按 [PREVIEW 说明](../preview/PREVIEW.md) 执行 guarded teardown：`ALLOW_PREVIEW_REMOTE=yourfeed-onboarding-preview CONFIRM_PREVIEW_TEARDOWN=yourfeed-onboarding-preview bash RUNBOOK.sh teardown`。已删除预览 Worker `yourfeed-onboarding-preview` 及其 D1 `27708692-e1d9-4500-af4e-6dafa0e51143`（Alan 的预览账号随 D1 一并消失，符合预期）。本地预览 env / `.private` 文件未自动删除。生产与 member Worker、D1、自定义域在 teardown 后仍在，health 仍为 200。
- Issues [#11](https://github.com/alanxiaofeifei/yourfeed/issues/11)–[#16](https://github.com/alanxiaofeifei/yourfeed/issues/16) 的工作已随 PR #8 上线，将在本状态更新合并后关闭。

以下各节为上线前的检查点记录，其中预览 Worker 版本、未合并/未部署的表述及旧的生产/member 版本号已被本节取代。



## PR #8 就绪状态（2026-11-15 05:25 UTC+8）
- 预览 `yourfeed-onboarding-preview` 版本 `1250d034` 含 A（轻量引导+箭头）、B #12（偏好卡片）、C #13（不喜欢+学习排序）、D #14（免 Key 免费 AI 通道）、E #15（设置 7 项+账户去重）、F #16（刷新方式）。相对 main 无数据库迁移、未改 `wrangler.jsonc`；CI verify 通过；PR 仍为 Draft。
- F #16：提交 `04c8299`；手动 / 打开时（默认）/ 后台定时（1–24h），复用实例已有 cron 并按间隔判断到期，仅 `BACKGROUND_SCHEDULE_CONFIGURED=true` 时可选；无定时器则回退为打开时。账号 cron 槽位 1/5（仅 member-001 `*/15`）；未新增 cron。集中调度器方案见 [ADR 0002](adr/0002-refresh-scheduling.md)（未实现，需 Alan 批准）。门禁：unit 858/858、typecheck、build、e2e 90 passed / 25 skipped、性能 1/1（桌面 p95 ≤30.9ms，手机 ≤50.4ms，37→52ms 漂移原因未证实，未修剪）、截图 4/4。
- Alan 需在预览验收：引导与箭头、偏好卡片（含 AI 出题或回退）、不喜欢/撤销/不喜欢列表、免费 AI 通道提示与恢复默认、设置 7 项与搜索、刷新方式（预览无定时器，后台模式应显示不可用）。
- 生产发布（须 Alan 明确同意后）：`ONBOARDING_AUTO_OFFER_CUTOFF` 设为实际上线时间 → 部署生产 `yourfeed`（当前 9c55d8b3，回滚 a316592e）并 smoke → 部署 `yourfeed-member-001`（保持其 `*/15` cron 与 `BACKGROUND_SCHEDULE_CONFIGURED=true`，回滚见上文）并 smoke → 合并 PR → 按 [PREVIEW 说明] 执行 teardown 删除预览 Worker 与 D1。无迁移需要执行。
## Issue F / #16（2026-11-15，本地验收完成）
- [Issue #16](https://github.com/alanxiaofeifei/yourfeed/issues/16) / [PR #8](https://github.com/alanxiaofeifei/yourfeed/pull/8)，分支 `feat/first-use-onboarding`，基线 `31d4924`；执行仓库外 `TASK_F.md`。所有改动未暂存、未提交、未推送、未合并、未部署；无 GitHub 写入、远程 Wrangler、真实 provider 请求或私密目录读取。
- 存储页四语刷新方式（manual / on_open 默认 / scheduled）、1/2/4/6/12/24 小时选择（接口 1..168），复用 meta、兼容旧 enabled。首页先读策略，手动模式不自动 sync，失败暂停自动刷新；保存中保持选择、失败恢复。来源自身的六小时硬编码也已接入所选间隔；保留分批、退避、预算和现有权限/隔离，无迁移或依赖改动。
- 复用 `BACKGROUND_SCHEDULE_CONFIGURED`（默认 false）：无 cron 时禁用后台选项、明确提示并将已存 scheduled 的有效方式回退为 on_open。仅现有 tick 到期后抓取，每 tick 仍为 1 来源 / 5 新内容 / 最多 1 AI 分析；四语明确抓取免费、自带 Key 服务商计费及离开期间的后台 AI 费用。未新增或更改任何 cron；[ADR 0002](adr/0002-refresh-scheduling.md) 记录运营者提供的 1/5 槽位现状，中央单 cron dispatcher 仅提案，须 Alan 批准。
- 最终门禁：Node **24.22.1** / npm **11.21.1**、现有锁文件；unit **858/858（68 files）**、typecheck、Cloudflare build、生产模式 e2e **90 passed / 25 opt-in 或开发专用 skipped**、性能 **1/1（192 样本，TOUR_PERF_ASSERT=1）**、截图 **4/4**、`git diff --check` 全通过。首轮 e2e 发现后台 AI checkbox 等待保存时回跳，已修复并完整重跑；仅截图用合成状态/卡片裁切随后调整，截图已另行复验。
- 手机延迟短查：D→C→E 的 tour / Spotlight 代码未改；Next/Skip/Back 状态在 TourController 内，基准步骤未挂载设置页，Exit 会改变 Home 的 active 状态。未证实漂移根因，未改 tour 或放宽门槛。最高 p95：D **37.0** → C **47.1** → E **51.9** → F **50.4ms**（390/CDP4×，仅记录），F 桌面 **30.9ms < 100ms**；均为可绘制帧代理，非真实设备/INP，不将微小下降归因于修复。性能 JSON 的 SHA256 已与最终 dist 核对。
- 证据在仓库外：`unit-F.log`、`typecheck-F.log`、`build-F.log`、`e2e-F.log`、`perf-F.log` / `perf-F.json`、`screenshots-F.log`；`phaseF-shots/` 四张真实组件合成截图（中文桌面无 cron / 有 cron、中文手机、英文桌面）已目视检查。完成记录 `F_DONE.md`。未验证线上 cron、Free CPU/容量或真实手机；下一步仅审阅本地 diff，中央调度及任何实例发布仍待 Alan 明确批准。



## Issue E / #15 检查点（2026-11-15 05:05 UTC+8，已推送并部署 preview）
- 提交 `88a2245` 已推送 PR #8；preview `yourfeed-onboarding-preview` 版本 `63b98714`（上一版 `3d75e4de`）。无迁移，仅代码部署：未重传 secret、未重置 preview D1；生产 `yourfeed` 与 `yourfeed-member-001` 未动。
- 7 项全部实现（分类状态徽章、统一保存与离页提示、AI 基本/高级分层、费用与测试说明卡、来源⇄Key 互相引路、存储归档摘要、设置内查找），四语；侧栏只保留一句非交互隐私说明，账户身份/退出只在右上角「我的账户」。
- 门禁：unit 831/831、typecheck、Cloudflare build、生产 e2e 80 passed / 21 skipped、性能 1/1（桌面 p95 ≤31.0ms，手机 ≤51.9ms）、截图 6/6。工具：Codex CLI exec，gpt-6.1-sol，reasoning high。下一步：F（#16 刷新方式）。
## Issue E / #15（2026-11-15，本地验收完成）
- [Issue #15](https://github.com/alanxiaofeifei/yourfeed/issues/15) / [PR #8](https://github.com/alanxiaofeifei/yourfeed/pull/8)，分支 `feat/first-use-onboarding`、基线 `85d3a82`；执行仓库外 `TASK_E.md`，本轮全部改动未提交、未暂存、未推送、未合并、未部署；无 GitHub 写入或远程 Wrangler，未读取私密目录或真实密钥。
- 七项及[四语通俗说明](settings-proposals.md)完成：分类证据徽章；偏好/AI 共用保存状态、提交锁、离页与 beforeunload 守卫，草稿仅在本次页面内存保留；AI 基本/高级分层与错误展开聚焦；免费默认/自带 Key 费用和草稿测试说明；YouTube 编辑/精选与接口双向返回；设备/正文/归档安全摘要和下载重试；静态四语设置查找、展开与聚焦。侧栏改为一行非交互阅读隐私说明，身份/退出仅在账户菜单。
- 保留默认免费通道；仅保存 YouTube Key 不切换 AI 通道。更改模型/地址/密钥使旧测试失效；未配置/读失败不显示已保存。无 schema、鉴权、隔离、权限、自动清理或保留期改动；原有 tour 目标和来源弹窗 focus scope 保留。
- 最终门禁：Node **24.22.1** / npm **11.21.1**，现有 `package-lock.json` 未改；unit **831/831（67 files）**、typecheck、Cloudflare build、生产模式 e2e **80 passed / 21 opt-in或开发专用 skipped**、截图 **6/6**、性能 `TOUR_PERF_ASSERT=1` **1/1（192 样本）** 全通过。桌面最高 p95 **31.0ms < 100ms**，手机390/CDP4×最高 **51.9ms**；为可绘制帧代理，非物理呈现或 INP。性能资源 SHA256 已与最终 dist 核对。
- 证据：仓库外 `unit-E.log`、`typecheck-E.log`、`build-E.log`、`e2e-E.log`、`perf-E.log` / `perf-E.json`、`screenshots-E.log`；`phaseE-shots/` 六张均已目视检查（中文桌面搜索/AI基本/存储、中文手机、英文桌面、侧栏与账户）。覆盖四语、失败保留草稿、取消跳转、串行保存、旧测试失效、YouTube 往返、归档重试零新增 AI 请求及 CSS 200% 缩放无横向溢出。
- 边界：仅本地合成 API/数据与真实 dist；未调用真实 provider，未验证真实设备、读屏、邮件/OAuth或线上。构建仍有既有 lucide/chunk/dynamic-import 提示；工具沿用项目执行环境，费用/活跃上下文统计不可读取，未声称切换模型或压缩。修复了视觉验收发现的初始保存状态矛盾与短关键词误匹配；最终检查 `git diff --check` 通过。
- 完成记录：仓库外 `E_DONE.md`。下一步仅审阅本地 diff；TASK_E 完成后停止，不部署任何实例。

## Issue C / #13 检查点（2026-11-15 04:31 UTC+8，已推送并部署 preview）
- 提交 `3f7ea4e` 已推送 PR #8；preview `yourfeed-onboarding-preview` 版本 `3d75e4de`（上一版 `aa2786a0`）。无迁移（复用 `feedback` JSON），仅代码部署：未重传 secret、未重置 preview D1；生产 `yourfeed` 与 `yourfeed-member-001` 未动。
- 门禁：unit 806/806、typecheck、Cloudflare build、生产 e2e 72 passed / 15 skipped、性能 1/1（桌面 p95 ≤31.3ms，手机 ≤47.1ms）、截图 4/4。工具：Codex CLI exec，gpt-6.1-sol，reasoning high（中途环境重启一次，已续跑）。
## Issue C / #13（2026-11-15，本地验收完成）
- [Issue #13](https://github.com/alanxiaofeifei/yourfeed/issues/13) / [PR #8](https://github.com/alanxiaofeifei/yourfeed/pull/8)，分支 `feat/first-use-onboarding`、基线 `4bbb012`；执行仓库外 `TASK_C.md`，全部改动未提交、未推送、未合并、未部署，未写 GitHub、未运行远程 Wrangler、未读取私密目录或密钥。
- 四语卡片/阅读器「不喜欢」立即隐藏，6 秒无障碍 Undo（悬停/聚焦暂停）；侧栏历史可分页搜索并撤销旧 dismissed，跨刷新可恢复。逐条串行写入、失败回滚、Undo 原位恢复并保留已加载页面；手机使用有完整无障碍名称的图标按钮。四语理由与本地免费排序、自带 Key/有限免费通道费用说明已补齐。
- 复用本实例 D1 按用户存储的 feedback JSON，同步 disliked/dismissed、服务端 updatedAt、原子合并其他信号；权重 +1/+0.45/+0.15/-1.4，负向意图优先，30 天半衰期、旧记录按 14 天、主题/来源限幅 ±1.5。只隐藏条目，相关主题/来源降权；沿用原有 1,000 条候选窗口，历史/归档不受该窗口限制。无 schema/迁移、鉴权、实例绑定或权限改动，归档保留新信号和时间戳。
- 修复旧自动 AI 分析将用户标记写回内容缓存的路径：内容读写剥离反馈及理由，仅合并当前用户的 feedback，不迁移或删除反馈；晚到 AI 结果不重开已关闭阅读器，也不覆盖当前标记。单元覆盖衰减/撤销、并发、跨用户/实例、旧缓存污染及归档；浏览器覆盖四语、慢请求 Undo、历史恢复、多页和晚到 AI。
- 最终验证：Node 24.22.1 / npm 11.21.1、现有锁文件；unit **806/806（66 files）**、typecheck、Cloudflare build、生产模式 e2e **72 passed / 15 skipped**。中断恢复后代码未变，以 `npm ci` 恢复依赖并重建，仅复跑性能 **1/1（192 样本，TOUR_PERF_ASSERT=1）** 和截图 **4/4**；桌面 p95 最高 **31.3ms < 100ms**，手机390/CDP4×最高 **47.1ms**（绘制帧代理，非物理呈现）。性能 JSON 的资源 SHA256 已与最终 dist 核对，`git diff --check` 通过。
- 证据：仓库外 `unit-C.log`、`typecheck-C.log`、`build-C.log`、`e2e-C.log`、`perf-C.log`、`perf-C.json`、`screenshots-C.log`；`phaseC-shots/` 四张中文桌面卡片/Undo、手机卡片、英文桌面截图均目视检查。完成记录 `C_DONE.md`。测试均为合成/模拟网络；真实设备、读屏、线上未验证。下一步仅审阅本地 diff，本任务已停止。


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





## 运维检查点：控制台 Cloudflare Access（2026-11-15 00:30 +08:00，分支 `ops/operator-access`）
- 授权：Alan 2026-11-15 给 API token 加了 Access 权限并同意启用保护。
- Access 应用 `YourFeed hosting operator`（id `11d48d9b-f578-4d05-bc18-11f7da09ea88`，aud 前缀 `113f67e1`）：覆盖 `yourfeed-control.alanzhu.dev/operator` 与 `/admin`，会话 1h。策略：`Alan only`（Allow，仅 `alan.xiaofei224@gmail.com`）；`Operator CLI service token`（Service Auth，service token id `d7f92b57-73b8-4235-8011-cf56efcb6855`，有效期至 2027-11-15）。`/health`、`/internal/*` 不在保护范围（成员 Worker 通过 service binding 调用）。
- 本机脚本：`hosting/scripts/operator.mjs` 读取 `CF_ACCESS_CLIENT_ID` / `CF_ACCESS_CLIENT_SECRET`；凭据只存本机私有目录（600），不入仓库。HMAC 管理签名保持不变。
- 验证：匿名 `/operator`、`/admin` → 302 到 `alaninsights.cloudflareaccess.com`；`/health` 200；匿名 POST `/internal/policy` 由 Worker 自己处理（415，未被 Access 拦）；脚本无 token → 清楚报错，带 token 的 `list` 成功；`yourfeed-m1.alanzhu.dev/login` 200，`/` 302 → `/login`。
- 移除 / 回滚：Zero Trust → Access → Applications 删除该应用；Access → Service credentials 删除该 service token（或 API `DELETE /accounts/{id}/access/apps/{app_id}`、`DELETE .../access/service_tokens/{id}`）。不涉及 Worker 版本或数据。service token 到期前需轮换。

## 运维检查点：关闭成员 workers.dev 地址（2026-11-15 00:15 +08:00，分支 `ops/member-disable-workers-dev`）
- 授权：Alan 2026-11-15 同意关闭备用访问地址。`yourfeed-member-001` 部署版本 `5bcde704-b5bd-4396-9d9f-d44a0c61ea87`，`workers_dev=false`、`preview_urls=false`；运行代码、cron、变量、D1 均不变，无迁移。模板 `prepare-instance.mjs` 同步生成这两项。
- 验证：`yourfeed-member-001.alan-xiaofei224.workers.dev/login` → 404（error 1042）；subdomain API `enabled:false, previews_enabled:false`；`yourfeed-m1.alanzhu.dev/login` 200，`/` 302 → `/login`。
- 回滚：`wrangler rollback 2edcc040-d5ad-4ba7-ae8c-64a69eb2b1d4 --name yourfeed-member-001` 后，用 API `POST .../workers/scripts/yourfeed-member-001/subdomain {"enabled":true}` 重新打开 workers.dev（版本回滚不会自动恢复该开关）。部署前 D1 书签 `00000016-00000000-00005123-07494456451935448865f1a2535e70f7`（未使用）。
- 待办：Alan 给 API token 加上 Access 权限后，再创建 `/operator` 的 Access 应用（见上一检查点）。

## 运维检查点：托管安全与成员定时更新（2026-11-14 23:05 +08:00，分支 `ops/member-scheduled-refresh`）
- 授权：Alan 2026-11-14 同意执行 /operator 的 Cloudflare Access 保护和成员实例定时更新；不改变数据隔离与访问权限。
- 成员定时更新：`yourfeed-member-001` 已部署版本 `2edcc040-d5ad-4ba7-ae8c-64a69eb2b1d4`（2026-11-14 22:36 +08:00），新增 cron `*/15 * * * *` 与 `BACKGROUND_SCHEDULE_CONFIGURED=true`；运行代码与 `e2e92e3` 相同（其后只有文档提交），无迁移、无数据改动。回滚：`wrangler rollback 16a2d9db-5cae-4bc5-b1c8-6691623edc86 --name yourfeed-member-001`，并删除 cron（`wrangler triggers deploy` 空 crons 或 API `PUT .../schedules []`）。部署前 D1 time-travel 书签 `00000010-00000000-00005123-df8bf64a953e8e249d489fc39dc7f3a8`（未用于恢复）。
- 模板：`hosting/scripts/prepare-instance.mjs` 为以后的名额生成同样的 cron 和变量（PR 内单测通过）。
- 行为：cron 只调用已有的 `scheduled` → `runBackground`：控制服务准入检查、有限的缓存清理；只有成员在「设置 → 存储与归档」打开后台更新（默认关闭，间隔 ≥6 小时）才抓取来源（每次 1 个），AI 另需本人开启并使用本人 Key。
- 验证：`/login` 200、`/` 302 → `/login`；GraphQL 分析显示 2026-11-14 23:00 +08:00 起每 15 分钟 1 次调用、status success、1 个子请求（控制服务准入）。`wrangler tail` 在本机多次断开，Workers Observability 查询无 API 权限，未取得逐条 cron 日志。
- 生产 `yourfeed` 目前没有任何 cron（任务假设"复用生产 cron"不成立）；如需生产也定时更新，需单独批准。Workers Free 每账号最多 5 个 cron，生产 + 5 个名额会超出。
- /operator Cloudflare Access：**未完成，阻塞**。当前 API token 创建 Access 应用返回 `1010 auth.forbidden`（organizations / groups 读取也返回 Authentication error）。需要 Alan 给 token 增加账户权限 `Access: Apps and Policies — Edit`（若同时保护 `/admin` 供本机脚本调用，还需 `Access: Service Tokens — Edit`），或在 Zero Trust 控制台手动创建。建议配置：Self-hosted 应用 `yourfeed-control.alanzhu.dev/operator`，Allow 仅 `alan.xiaofei224@gmail.com`，会话 1h；不要覆盖 `/internal/*`（成员实例调用）和 `/health`。`/operator` 目前仍公开返回页面，但 `/admin` 操作需 HMAC 签名 + nonce。
- 下一步：Alan 补权限后按上面配置创建 Access 应用并验证匿名 `/operator` 302 到 `alaninsights.cloudflareaccess.com`，成员实例路径不受影响。

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
