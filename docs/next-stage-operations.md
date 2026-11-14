# Reliable reading and isolated hosting / 可靠阅读与独立托管

This release develops the existing TypeScript/Worker/D1 core. It does not replace it with a different reader, claim that every upstream feed contains full text, or turn the private AlanFeed Site into a multi-user service.

## Product boundaries

- **Self-hosted:** one owner, one independent Worker and D1, own login and API credentials.
- **Invited hosting:** up to five reserved or active people in this operator's installation, each with an independent Worker, D1, session secret and encryption master key. The open-source operator can change the configured capacity after reviewing their own resource limits.
- **AlanFeed:** retains its existing Sites project, original trusted user identity, private database, access policy, secret namespace and encryption key. Common reading features can update; invitation and hosting control do not take over its authentication.

The hosting control plane is infrastructure for operators, including commercial operators under MIT. It is not a payment system, a public-registration service, a proven SaaS capacity guarantee, or a promise that five people fit in free quotas. Administrators of the Cloudflare account can access deployments and databases. Server-side encryption is not end-to-end encryption against that administrator.

中文：自建版是一人一个独立实例。受邀托管也是每人一个 Worker 和 D1，控制服务只管邀请、名额与撤销，不混合内容、会话和密钥。开源代码允许按 MIT 自建或商用；收费、隐私政策、邮件投递、容量与法律义务由运营者负责。AlanFeed 保留原 Sites 身份与个人资料，不加入公开注册或托管名额系统。

## What requires configuration and acceptance

The source code and automated tests are not evidence that an operator has created five production instances, delivered email to invitees, completed OAuth consent, or passed a free-plan load test. Before accepting a real invite:

1. Verify the target account's actual plan, all existing Worker/D1 usage, and database count.
2. Provision isolated empty instances with their own DB and secrets. No tenant instance receives a Cloudflare management token.
3. Configure exact Google callbacks for each independent origin. A shared Google OAuth application is a login service, not a shared user session.
4. For email OTP to arbitrary invitees, verify a sending domain in Resend. `onboarding@resend.dev` can only test delivery to the Resend account's own email; it is not a recipient mailbox or a production sending domain.
5. Check reservation concurrency, duplicate callbacks, revocation, wrong-DB failure, provider-key fallback rejection, and a new user's empty library.
6. Review privacy/retention notices and test export before any automatic cleanup.

No user AI request may fall back to the operator's AI or YouTube API key in hosted mode. Missing personal credentials must disable the corresponding capability with a setup prompt. Self-hosted and Sites compatibility is preserved.

## Free-plan operating budget

Official documentation checked on **2026-11-10**; check again before deployment:

| Resource | Published free allowance / constraint | Operating implication |
|---|---|---|
| Workers | 100,000 requests/day; tight per-invocation CPU limits | Benchmark SSR, authentication, parsing and search; do not assume low user count solves CPU limits. |
| D1 | 5 million rows read/day, 100,000 rows written/day, 10 databases, 500 MB/database, 5 GB/account | Include other account projects, control DB, preview DB and recovery DB. Rows scanned are not SQL request counts. |
| Resend | 3,000 emails/month, 100/day | Reserve capacity for sign-in, rate-limit retries, make digest mail optional. |
| D1 Time Travel | 7 days on Free | Not a permanent backup and not immediate erasure of historical records. |
| AI / YouTube | Per-user provider account and quota | Do not pool the operator's credentials. AI and background analysis are separately opt-in. |

Implemented hosted admission/ingestion limits include 30 active sources, 250 new source items/day and 20 manual content imports/day per instance. The current RSS adapter handles five entries per source page; the UI advances at most 35 refresh batches in one interaction, preserving durable checkpoints for the next visit or refresh. These bounds are deliberate, not a silent claim that every publisher history was loaded.

Suggested initial hosted policy: 30 active sources/person, one refresh job/person, two fetches/host at once, at least six hours between normal refreshes, 250 new items/person/day with visible backlog, and 20 manual content imports/person/day. On-demand extraction is part of that bounded import path, not an unlimited separate endpoint. These are application policies, not provider guarantees. Capacity tests must replace estimates before launch.

Alert on account quotas at 50%, 80% and 90%; suspend optional background tasks and body extraction before hard limits. Per-instance storage warnings start at 300 MB and new ingestion should stop by 400 MB to leave recovery/export space. The platform can still reject requests at its hard limit. Never automatically upgrade a plan or purchase more capacity.

Sources: [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/), [Workers limits](https://developers.cloudflare.com/workers/platform/limits/), [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/), [D1 limits](https://developers.cloudflare.com/d1/platform/limits/), [Resend pricing](https://resend.com/pricing/).

## Shared releases and preservation

A shared-core proposal creates a PR. It does not merge, migrate databases or publish either project. Cloudflare Builds may publish after a production branch push; keep these triggers distinct.

Pin common code to one complete upstream SHA. Test the public and private consumers separately. Keep personal data, brand configuration, `.openai/hosting.json`, actual Wrangler bindings, secret files and private migration data outside the shared allowlist.

For each release record privately: source SHA, Worker/Site identity, deployment version, actual DB ID/binding, applied migration list, backup/restore reference, prior code version and secret-backup identifier. Never record secret values.

For AlanFeed, compare stable source/content IDs, feedback ownership, settings keys and encrypted ciphertext before and after the update. Do not reseed, remap the trusted Sites user, regenerate the master key or change `SECRET_NAMESPACE`. If the platform's supported DB export/recovery path cannot be established, block schema-changing publication rather than assume code rollback can restore data.

中文：共享更新 PR、数据库迁移和生产发布是三个独立步骤。每个实例分别核对 Worker／Site、数据库、完整迁移和备份。代码回滚不会回滚数据库。AlanFeed 的身份、私人数据和加密密钥必须保留；无法验证数据库恢复通道时，暂停涉及其结构变化的发布。

See [backup and rollback](backup-and-rollback.md), [hosting](hosting.md), and [deployment](deployment.md).


## Cache housekeeping versus network schedules

The authenticated app performs a small maintenance batch on opening (at most five search-index backfill rows and five eligible expired bodies). When the 90-day policy is disabled, it does not clear bodies. Housekeeping is separate from source fetching, paid AI analysis and mail; disabling background network updates does not turn off an explicitly enabled retention policy. Liked or read-later items and permanent metadata/feedback remain protected.

The code includes a scheduled handler, but no production platform timer is created merely by saving the settings toggle. Operators must configure and verify an actual platform schedule and `BACKGROUND_SCHEDULE_CONFIGURED` separately. Existing Sites automation remains unchanged until its platform capabilities and quota have been checked. An on-open maintenance batch is not an unattended daily expiry guarantee. See [Scheduled background refresh (hosted instances)](hosting.md#scheduled-background-refresh-hosted-instances) for the hosted cron configuration, account limits and rollback.

中文：RSS 每源每页处理 5 条，前端每次最多推进 35 个更新批次，余下工作保留检查点，下次继续。托管版每日新增采集上限 250 条、手动内容导入上限 20 次。打开页面时最多清理 5 条符合到期条件的普通正文；这是保留策略的维护，与网络抓取和 AI 后台开关独立。保存开关不会自动创建云平台定时器。
