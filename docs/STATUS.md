# 当前项目状态

更新时间：2026-11-14T20:40:00+08:00



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
- 目标与范围：推进 [Draft PR #8](https://github.com/alanxiaofeifei/yourfeed/pull/8) 的四语言、可恢复首次使用引导；本检查点另记录开发偏好文档的采纳。
- 验收条件：补齐 Alan 已确认的决定，验证非生产预览；功能发布到生产或成员实例前取得 Alan 明确批准。完整 PR 验收条件未核实。
- 已确认的重要决定：`ONBOARDING_AUTO_OFFER_CUTOFF` 为生产启动当天（2026-11-14 批准）；未获明确批准不得改变实例数据隔离或访问权限。上述项目状态与决定由任务提供，远程实时状态未核实。

## 工作入口
- Issue：未核实。
- PR：[Draft #8](https://github.com/alanxiaofeifei/yourfeed/pull/8)，据任务信息尚未合并、未部署；实时状态未核实。
- 分支：引导工作 `feat/first-use-onboarding`；本次文档工作 `docs/alan-dev-prefs`。
- 代码 / 验证基线：本地 HEAD `37acfc4a19ece25f8785afb077e3597ec35905a0`；本地记录的 `origin/feat/first-use-onboarding` 为 `8d3e093`，远程最新状态和该版本的验证结果未核实。
- 当前负责人或整合者：未核实。

## 进展与证据
- 已完成：`git log -5` 显示 `37acfc4`（#7 紧凑视频卡片）、`f50d762`（#6 中文介绍视频）、`e2e92e3`（#5 Gemini / Groq / NVIDIA / Cerebras）、`1905d8a`（#4 动效 v2）、`d32cf8e`（合并 #3 首页动效）。
- 已执行检查、结果、证据：本地 Git 历史和分支记录见上述基线；引导功能测试及线上验收结果未核实。
- 尚未执行的必要检查：#8 差距核对、非生产预览及其验收；线上验证状态未核实。
- 未完成 / 已知问题：引导尚待补齐并获发布批准。仓库 README 将每个部署定义为单所有者，并描述由独立实例组成的受邀托管，而非共享多租户服务；任务中“多用户”应按此理解。仓库文档将五人生产实例、邮件、OAuth 和容量验收标为待确认，不能从代码推断已完成。
- 有后续价值的失败尝试：未核实。

## 恢复信息
- 未提交或未推送改动：文档采纳工作在 `docs/alan-dev-prefs`；提交和推送状态应以 Git 实况核对。本任务不推送。
- 远程同步状态与阻塞：本地 `origin/main` 记录为 `37acfc4`；远程最新状态、其他阻塞未核实。
- 正在运行的任务 / 已执行外部操作：未核实；本次未进行部署。
- 部署环境、版本及验证状态：以下部署信息由任务提供，未独立核实线上：生产 Worker `yourfeed`（`yourfeed.alanzhu.dev`，`AUTH_MODE=standalone`）版本 `9c55d8b3`，2026-11-12 16:19 +08:00，回滚版本 `a316592e`；成员 Worker `yourfeed-member-001` 版本 `16a2d9db`，回滚版本 `20badd17`。控制 Worker `yourfeed-control` 有独立 D1，最多五个名额；成员有独立 D1、密钥和会话。线上验证结果未核实。
- 下一步可直接执行的动作：读取 PR #8 的当前差距与 Alan 的决定，在独立非生产 Worker、D1、密钥和 origin 上验证预览，再申请生产发布批准；预览不触碰其他实例的 D1、secrets 或 routes。
- 必要的访问条件：GitHub 和目标 Cloudflare 环境的适当权限；真实密钥仅存 Cloudflare secrets / 本地环境，不入仓库；`AUTH_EMAIL_FROM` 是普通变量。部署前按 `docs/deployment.md` 核对目标、备份与恢复；数据库迁移不会随代码回滚。
