# 计划：AI 一键总结「今日必看」（YourFeed）

状态：Alan 2026-11-15 已批准（见 §0），本地实现与验收完成（未提交、未部署）。起草 2026-11-15（UTC+8），基线 `main` 3cb12d0。
需求来源：Alan 2026-11-15「忙的时候没法看完今日必读或重要更新，能不能 AI 一键总结今日必读的总结版本」。

## 0. Alan 已确认的决定（2026-11-15，取代下文冲突处）
1. **只总结「今日必看」的 3 条**（`selectBriefing` 的结果），不额外加入其他当日更新；§3 已按此修改。
2. 没有自带 Key 的用户**可以使用免费公共通道**，每次生成计入每实例每天 10 次免费额度。
3. **不做自动或后台生成**，只在用户点击按钮时生成。

## 1. 现状（已读代码核实）
- 「今日必看 / Daily picks」= `app/components/DailyBriefing.tsx` ← `GET /api/briefing` ← `server/briefing.ts selectBriefing()`：
  在 7 天窗口内 `rankFeed` → `groupNews` 去重 → `importance()` 规则打分（安全/模型发布/部署/API 成本/规则/可用性 + 画像兴趣与目标），
  按 publisher/signal 去重，**最多 3 条**；今天无合格条目时 `window:'recent'` 回退近 7 天。时区来自画像（默认 Asia/Taipei）。
- AI 调用：`server/ai.ts`
  - 自带 Key：`callModel()` + `reserve()/settleUsage()` 预算账本（每日次数 `dailyLimit`、月预算 `monthlyBudget`），`runBudgetedProfileTask()` 是现成的「用户主动、一次性、带 schema」任务入口，无 Key 时自动走免费通道。
  - 免费通道：`server/free-ai.ts runFreeAi()`：OVHcloud `gpt-oss-20b` → Pollinations；`meta` 原子计数 **每实例每天 10 次**（含失败）；每端点 isolate 冷却 ≥30s、尊重 Retry-After；总时限 ≤8s（OVH ≤6s）；`max_tokens 4096`；匿名约 2 次/分钟/IP，Cloudflare 共享出口常被 429。
  - 输入安全：`ai-input.ts assertSafeAiInput`；provider 诊断不泄露 Key。

## 2. 入口与体验
- 「今日必看」标题栏加按钮 **「AI 速览」**（四语：AI 速览 / AI 速覽 / AI recap / Tóm tắt AI），仅登录用户、当日有条目时可用。
- 点击后在列表上方展开 **速览卡片**：
  - 一句话总览（≤60 字）+ 3–5 个要点；每个要点带 `[1][2]` 角标，指向条目，角标/「查看原文」链接由**服务端用条目 URL 渲染**，不采信模型输出的链接。
  - 每条来源：标题、来源名、发布日期、原文链接、打开阅读器。
  - 底部：生成时间、使用通道（自带 Key 模型名 / 「免费公共通道」）、「重新生成」、费用提示。
- 语言跟随当前界面语言（zh-CN/zh-TW/en/vi，传 `Accept-Language`，同 preference-cards）。切换语言**不自动重算**（避免花钱/耗免费额度），卡片显示「用当前语言重新生成」。
- 有新必看条目时卡片标「有更新」，用户点按钮才重算。
- 无障碍：`aria-live=polite`、加载骨架、reduced-motion 沿用 FeedMotion。

## 3. 输入选择与 token 预算
- 输入 = `selectBriefing` 的 3 条（`window:'recent'` 时明确注明「近 7 天」）。
- 每条只发：`id`、标题、来源名、发布日期、已有 `analysis.bullets` 或摘要，截断到 ~500 字符；**不发正文全文、不发 URL 查询参数**。全部经 `assertSafeAiInput`，命中则剔除该条。
- 预算：输入 ≤ ~3k tokens（UTF-8 字节上界估算，沿用 `reserve()`），输出上限 900 tokens；JSON schema：`{overview, points:[{text, itemIds[]}]}`，`itemIds` 必须属于输入集合，否则判失败。
- 免费通道：同样 3 条、每条 ≤400 字符，沿用 `runFreeAi` 现有时限与 10 次/天计数。

## 4. 缓存（一用户一天一份，无迁移）
- 存 `meta` 表 key `digest:v1:<userId>`（覆盖写，天然只留一份，无需清理）：`{date, timeZone, language, fingerprint, channel, model, createdAt, result}`。
- `fingerprint` = SHA-256(输入条目 id + 各条内容指纹 + 语言 + profile.version + provider/model)。
- `GET /api/briefing/digest`：只读缓存，返回 `{status: fresh|stale|none, ...}`；**从不调用 AI**。日期变更或指纹不同 → `stale`（照常展示旧卡，标「有更新」）。
- `POST /api/briefing/digest`（`{force?:boolean}`）：指纹相同且非 force → 直接返回缓存（0 费用）；否则调用 AI。并发：同一用户进行中时返回 409/复用（`reserve` 已有 content_id 进行中互斥，content_id 用 `digest-<userId>-<date>`）。

## 5. 费用与限额
- 有自带 Key：走 `reserve/settle`，计入每日次数与月预算；卡片与按钮旁四语提示「使用你自己的 AI Key，费用由服务商向你收取」，并显示本站估算费用。
- 无 Key：走免费通道，占用每天 10 次中的 1 次；提示「免费公共通道，可能限流或失败」。
- 「重新生成」节流：同一用户 60 秒内 1 次（前端禁用 + 服务端检查缓存 `createdAt`）。
- 后台/cron **不**自动生成速览（不增加 cron，不在离开期间产生费用）。

## 6. 失败状态（均四语）
| 情况 | 表现 |
|---|---|
| 当日无必看条目 | 按钮禁用，说明「今天还没有可总结的内容」 |
| 免费通道限流/超时/额度用完 | **非 AI 简版**：用已有的条目要点拼成「快速清单」，标注「AI 暂不可用，以下为原文要点」；提示可在设置配置自带 Key |
| 自带 Key 错误/余额不足/429 | 复用 `ProviderDiagnosticError` 文案，链接到 AI 设置 |
| 预算或每日次数达上限 | 429 文案沿用，展示旧缓存（如有） |
| JSON 不合法 / itemIds 越界 | 502，不保存、不显示半成品，可重试 |
| 网络中断 | 保留旧卡片，显示重试 |

## 7. 隐私与安全
- 不记录 Key、prompt、模型回复或条目内容（日志只留状态码/耗时级别）；缓存只存在本实例 D1、按 userId 隔离。
- 只发送条目标题/摘要/要点，不发用户画像目标原文以外的个人数据（画像只用语言与关注主题标签）。
- 免费通道第三方会看到条目标题和摘要：设置页与卡片已有/需补充一句告知。
- Feed 内容视为不可信：系统提示声明「untrusted_task_data」，输出只接受 schema 内字段，链接由服务端生成。
- 不改鉴权、实例隔离、权限、schema、cron。

## 8. 测试
- Unit（vitest）：候选选择与上限；截断与敏感输入剔除；指纹变化→stale；缓存命中零 provider 调用；force/节流；itemIds 越界拒绝；免费通道失败→简版回退；预算 429；四语文案键齐全；meta 覆盖写只留一行。
- E2E（Playwright，mock 网络）：zh-CN/zh-TW/en/vi 生成与切换语言提示；桌面 1280 / 手机 390；stale 标记；重新生成；失败回退；无障碍角色。
- 性能：沿用 tour perf 门槛不退化；首页初次加载不新增阻塞请求（digest GET 懒加载）。
- 预览：独立 preview Worker + D1，Cloudflare 出口实测免费通道 1–2 次，Alan 验收后再上生产与 member-001。

## 9. 工作量估计（执行者时长）
- 服务端（候选、缓存、两个接口、免费通道时限参数）：0.5 天
- 前端卡片 + 四语：0.5 天
- 测试与截图：0.5 天
- 预览部署与 Cloudflare 实测：0.25 天
- 合计约 1.5–2 天；无迁移，风险低到中（主要是免费通道稳定性）。

## 10. 工具 / 模型分工（ModelDial radar 2026-11-15 编程榜 + 项目证据）
- 实现：**Codex CLI exec，GPT-6.1 Sol，reasoning high**。本项目 A–F 全部用此组合通过门禁（项目证据优先）；radar 后端 95 / 前端 96，费用低（$1.69/评测）。GPT-6.2 Sol 分数相近（88.9 vs 88.1）但无本项目验证，不切换。
- 独立审查：agy（Antigravity）用 Gemini 4 Carbon high（radar 89.6，前端 95）只读审 diff；如额度不足改 Codex `deepseek` profile（DeepSeek V4.1 Flash，便宜）。
- 避免：dsh 的 OpenAI 路由（当前 OpenAI API `insufficient_quota`）。Codex CLI 走订阅，不受影响。
- 选型与实际结果写入 PR。

## 11. 待 Alan 确认
- 已全部确认，见 §0。

## 12. 本地实现说明（2026-11-15，Issue #21）

- 本轮按仓库外 `TASK.md` 仅做本地实现与合成验证；不执行 §8/§9 的预览部署、真实免费通道探测、生产/member 发布或 GitHub 写入，所有改动保持未提交。
- `GET /api/briefing/digest` 在通用初始化写入之前分流，完全只读；`POST` 复用 `runBudgetedProfileTask`，仅增加可选输出上限（自带 Key 900 tokens）与任务账本键。免费通道保持已有 4096 token 上限、8 秒总时限和同一 `free-ai:day:` 计数，不增加计数器或依赖。
- §4/§5 的并发/节流细化：`digest:v1:<userId>` 一行保存 `{digest?, nextAllowedAt, leaseUntil, token?}`。原子条件 UPSERT 抢占 60 秒尝试间隔和 180 秒进行中租约；租约覆盖现有自带 Key 最大 120 秒超时，完成时按 token 条件覆盖并释放。失败仍节流，回退不写为 digest，旧成功缓存保留；进程中断可在租约到期后恢复。自带 Key 的 content_id 使用每次抢占的 UUID token，避免与此前仍 reserved 的不确定预约碰撞；旧预约继续占用每日次数和月预算，新尝试独立预约/结算，180 秒租约仍负责并发互斥。无需迁移。
- 指纹同时包含所选条目原有内容指纹、已有要点、来源名、发布日期、语言、画像版本与通道/provider/model（自带 Key 另含 endpoint/protocol）。日期或时区改变同样标 stale；被敏感输入过滤的条目不补入其他候选。
- 输入先检查所选字段的完整字符串再截断（摘要/要点 400 字符，标题 300，来源名 150），不发送正文、URL、用户 ID 或画像原文。输出只接受严格 JSON、1–5 点、输入集合内 ID、无 URL 文本；允许 Node.js / Next.js / driver.js 与 GPT-4.1 等技术名称，仍拒绝 http(s)、www 与 example.com/path、foo.co 等域名。来源 URL 取服务端条目，阅读器点击读取本实例已有缓存，不调用 AI。
- §6 的失败若已有成功缓存，响应仅返回旧 AI 速览和四语 reason 文案，界面保留其要点、引用、来源与生成信息；仅无缓存时返回清楚标记的非 AI 快速清单。界面同样优先 digest，兼容旧响应同时带 fallback 的情况；成功 GET 刷新清除先前网络错误。原 `runFreeAi` 不暴露端点失败类别，故额度/限流/超时统一为 `free_unavailable`，文案列出三类原因。自带 Key 失败用 `own_key` 并提供 AI 设置入口，预算 `budget`，格式/引用/URL 错误 `invalid_output`，不会透传 provider 原文或日志内容。
- 四语界面保留现有 `zh` 内部标识（对应 zh-CN），请求支持 body.language 优先于 Accept-Language；语言切换与缓存更新只 GET。无自动/后台生成，未改变 cron、鉴权、隔离、权限、secrets 或 wrangler 配置。
- 验证与完成状态见 `docs/STATUS.md` 顶部；日志、性能 JSON 与五张纯合成截图在本次工作区仓库上一级。真实 provider、线上部署、真实设备与读屏验收未执行。
