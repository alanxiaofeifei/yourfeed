# Hosting modes / 托管模式

## Open self-service signup (issue #28)

The separate **[yourfeed-app.alanzhu.dev](https://yourfeed-app.alanzhu.dev/)** service is deployed ([PR #29](https://github.com/alanxiaofeifei/yourfeed/pull/29), verified release details in [STATUS](STATUS.md)) and uses `HOSTING_MODE=multi`: one Worker, one shared authentication D1 (`AUTH_DB`), and one SQLite Durable Object (`TENANT_FEEDS`, `new_sqlite_classes`) per verified Better Auth user ID. Existing `yourfeed`, member-001 and invitation control resources retain their independent architecture below; this release does not migrate them. New users start with an empty library. Email OTP via Resend is the initial sign-in method; Google is hidden unless explicitly enabled.

The shared D1 contains only authentication, atomic account capacity, approved emails, deletion requests and cron state. A SQLite trigger rejects a new account atomically when `MAX_ACCOUNTS` (default 10) is reached, including concurrent OTP/OAuth registrations. Existing accounts and approved mailboxes bypass capacity. Before generating or sending an OTP, the server also checks capacity and returns a localized application link addressed to `alan.xiaofei224@gmail.com`, with the entered email in the body. Availability is checked again at actual account creation, so an OTP is not a reservation. Account availability necessarily reveals registration/capacity information and is rate limited.

Every business API call authenticates in the Worker and invokes exactly one tenant DO RPC, carrying the verified identity independently of browser headers. Its D1-compatible SQLite adapter runs existing app migrations on first use and executes batches atomically with `transactionSync`; FTS5 trigram and JSON functions are covered by workerd tests. The encryption key is HKDF-SHA256 derived from the master key and immutable user ID, with a tenant-specific secret namespace. No operator AI/YouTube credential, including `FREE_AI_GROQ_API_KEY`, is passed into business code. The optional keyless free channel retains its per-tenant daily limit; this service does not use an operator Groq supplement. Hosting administrators can still access platform resources; this is not end-to-end encryption.

One production cron (`*/30 * * * *`) round-robins one account per run, with at most two queued account deletions. Background source fetching/AI remain separately opt-in, one source per tenant tick; the existing hosted daily, source, storage and retention limits also apply. The preview has no scheduled trigger and has a guarded cron fixture endpoint. Free-plan limits are shared with other projects: DO requests 100,000/day, SQLite 5 million rows read/day, 100,000 rows written/day and 5 GB total storage; five account-wide cron triggers. Reaching a quota fails operations; no automatic paid upgrade is performed. See [Cloudflare pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/).

### Multi-tenant deployment and operator commands

Configurations are `wrangler.multi.preview.jsonc` (only `yourfeed-app-preview`) and `wrangler.multi.jsonc` (only `yourfeed-app`, custom domain `yourfeed-app.alanzhu.dev`). Their D1 binding is `AUTH_DB`, never an existing instance DB. Create the named empty database, put its returned ID in the matching config, then run:

```sh
npx wrangler d1 migrations apply AUTH_DB --remote --config wrangler.multi.preview.jsonc
YOURFEED_WRANGLER_CONFIG=wrangler.multi.preview.jsonc npm run build
npx wrangler deploy --config dist/server/wrangler.json
# For production, substitute wrangler.multi.jsonc in the migration/build commands.
```

Use independent `AUTH_SECRET` and `APP_ENCRYPTION_KEY` Secrets for each target, piped from `openssl rand -hex 32` directly to `wrangler secret put NAME --config CONFIG`. Back up the encryption master key privately if ongoing recovery is required. Pipe the authorized Resend key from the local environment; `AUTH_EMAIL_FROM=YourFeed <login@mail.alanzhu.dev>` is a plain variable. No provider AI keys belong in these Workers. The preview-only `AUTH_TEST_FIXTURE_OTP` Secret applies solely to synthetic `@example.test` mailboxes when both deployment marker and exact preview origin match. It must be absent in production. Do not use real recipient addresses for acceptance.

```sh
node hosting/scripts/multi-account.mjs preview list
node hosting/scripts/multi-account.mjs preview approve c@example.test
node hosting/scripts/multi-account.mjs production approve person@example.com
node hosting/scripts/multi-account.mjs production cap 15
# Review, rebuild using wrangler.multi.jsonc, then deploy to apply the capacity var.
node hosting/scripts/multi-account.mjs production delete person@example.com
```

The helper validates exact Worker/D1 names and executes only against `AUTH_DB` in the selected config. Deletion queues the immutable user ID and removes its approval: protected requests immediately deny that account, then the next cron defers busy tenant operations to a later tick, calls `storage.deleteAll()`, and removes auth sessions/accounts/user. Pending deletions continue counting toward capacity until completed. At most two deletions finish per run. A retry is safe. Existing downloaded copies and platform recovery/log retention are outside deletion. Offer export before ordinary deletion. Raising capacity changes shared quota exposure; review account limits first.

### Enable Google later (Alan)

In Google Cloud Console → Google Auth Platform → Clients → existing YourFeed Web client, add the exact authorized redirect URI `https://yourfeed-app.alanzhu.dev/api/auth/callback/google`. Under Audience, publish the app **In production**; keep only `openid`, `email`, `profile`. Then save `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` as Secrets on `yourfeed-app`, set `GOOGLE_SIGNIN_ENABLED=true` in its config, rebuild/deploy, and verify a real sign-in. Without that flag, credentials alone cannot enable the button or backend provider. Existing identities must link providers explicitly; equal emails do not silently merge identities.

### Release and rollback

Local checks and preview evidence are recorded in [STATUS](STATUS.md); they do not establish real email delivery or Google consent. The initial release passed all task gates and green CI; production anonymous smoke passed with no accounts created or real emails sent. Actual inbox delivery and Google consent still require operator verification. Preserve the independent preview for review. Code rollback uses `wrangler rollback VERSION --name yourfeed-app --config wrangler.multi.jsonc`; it does not undo D1 migrations or DO SQLite data. The initial release has no earlier functional production version. Its closed bootstrap rollback is `42e434f9-d258-4848-aa19-525d723f6cc8`: rolling back to it disables configured sign-in while leaving new D1/DO data intact. This is an emergency closure, not a database restore. Never point this service at an old instance database.

## Independent invited instances / 独立实例受邀托管

YourFeed can be operated in single-owner self-hosted mode or as an invited collection of independent single-owner instances. Hosted code is open source under MIT; an operator may use it commercially, adjust capacity, and maintain their own policies. This repository does not implement billing or promise commercial SLA/free capacity.

## Architecture

Use one control Worker/DB plus one Worker/D1 per person. Default capacity is five **reserved + active** slots. Each tenant has its own `AUTH_SECRET`, `APP_ENCRYPTION_KEY`, DB binding, exact origin, host-only session cookie and background/AI budget state. The operator's personal Sites app is outside this control plane.

The control DB stores invitations, instance assignments and revocation policy, not content, reading history, user API keys or shared reading sessions. Each tenant uses existing local Google/email authentication for its assigned verified email. Binding another provider in that same account does not allocate another slot. Different email addresses are not silently assumed to be the same person.

A Cloudflare Worker is a request-driven isolate, not a dedicated container/server. Separate Workers still share the Cloudflare account's quota, billing and administrator access. The operator can access deployments and data; server-side key encryption is not end-to-end encryption against that operator.

## Configuration surfaces

The executable source and examples live in `hosting/`:

- Control: `hosting/control/worker.ts`, `migrations/0001_control.sql`, `wrangler.example.jsonc`.
- Control bindings: `CONTROL_DB`, `CONTROL_ADMIN_SECRET`; variable `MAX_TENANTS` defaults to five.
- Tenant: `AUTH_MODE=standalone`, `HOSTING_MODE=hosted`, unique `INSTANCE_ID`, unique `HOSTED_INSTANCE_TOKEN`, and the `HOSTED_CONTROL_SERVICE` service binding.
- The tenant DB must have its own matching `meta` marker `hosted:instance`; missing/mismatched policy or marker fails closed. This is not a migration that assigns an existing private DB to a new person.

Do not copy the operator's `OPENAI_API_KEY`, DeepSeek, GLM, Gemini, Groq, NVIDIA, Cerebras, YouTube credentials, `AUTH_SECRET` or encryption master key to tenant instances. Hosted users supply their own provider keys in private settings. The optional `FREE_AI_GROQ_API_KEY` described below is a separate, explicit free-channel supplement. Google OAuth and Resend may be shared **login/sending services**, but user sessions and content stay local to each instance. Notebook authorization is separate from Google sign-in.

## Provisioning and invitation sequence

1. Review account plan, shared resource usage and available D1 slots. Keep room for preview and recovery. Do not upgrade or purchase automatically.
2. Review a dry-run instance manifest using the operator helper. Allocate a new empty DB and fresh secrets for each slot. Keep Cloudflare management credentials only in the operator's protected release workflow, never in the tenant Worker or public browser.
3. Apply control migrations only to the separate control DB. Apply app migrations to each reviewed empty tenant DB; set its matching instance marker.
4. Register a locked instance with its actual `instanceId`, origin, `databaseId` and unique instance token. Operator requests are HMAC-authenticated with timestamp and replay-protected nonce; never expose the admin secret to a public page.
5. Reserve an invitation for an exact email with a stable request ID. The control DB atomically counts reserved and active capacity; retry the same request ID instead of creating another invitation. The default invitation expiry is seven days.
6. Share the assigned instance/invitation URL privately. Configure Google callbacks for that origin, and a verified Resend sending domain for email codes. `onboarding@resend.dev` is not suitable for arbitrary invitees.
7. The person's first verified local sign-in activates the reserved slot. Repeat OAuth callbacks or sign-in retries return to the same account. Missing personal API credentials prompt setup and do not use the operator's key.

The `/operator` page is a small operator dashboard for listing slots, reserving invites and revoking access. It keeps the supplied operator secret in page memory only; use it only on your trusted control origin and close the page afterwards. Inviting returns a private instance URL to share manually; it does not send invitation emails automatically.

The control `/admin` endpoint accepts operator operations including `register`, `invite`, `list`, `revoke`, `expire` and `renew`. Use the checked-in operator helper and inspect its usage; do not handcraft admin requests in a public browser. Example files contain placeholders, not an already provisioned service.

This workflow is source-level infrastructure, **not evidence that five live instances have been provisioned**, mail delivered, OAuth approved, or free-plan load tests passed. A deployment is not available for invitees until the operator completes those steps and acceptance tests.

### Operator console protection

On `https://yourfeed-control.alanzhu.dev`, `/operator` and `/admin` are behind Cloudflare Access: browser access is limited to Alan's email, with a 1-hour session. The local CLI uses an Access service token through `CF_ACCESS_CLIENT_ID` and `CF_ACCESS_CLIENT_SECRET`; keep these credentials only in the operator's private directory outside Git and load them into the CLI environment. Set both variables together; their values must never be logged.

`/health` and `/internal/*` (called by member Workers via service binding) are intentionally not covered by Access.

To remove this protection, delete the Access application and service token in **Zero Trust → Access → Applications / Service credentials**, respectively. The HMAC admin signature remains in place either way.

## Scheduled background refresh (hosted instances)

Member Workers disable workers.dev and preview URLs; only the custom domain origin (`AUTH_BASE_URL`) serves; rollback by redeploying with `workers_dev: true` (or the previous version) — no data change.

The hosted preparation helper configures each member Worker with one cron trigger (`*/15 * * * *`, every 15 minutes) and `BACKGROUND_SCHEDULE_CONFIGURED=true`. The cron only invokes the existing `scheduled` handler (`worker/index.ts` → `server/background.ts` `runBackground`): an admission check against the control service, bounded retention cleanup, and source sync (one source per tick) only if the member enabled background updates in **Settings → Storage** (default off; interval at least 6 hours). AI runs only if the member separately opted in with her own key; the cron does not enable it.

Workers Free allows five cron triggers per account. Production `yourfeed` currently has no cron; five member slots would use all five triggers, and adding a production cron would bring the total to six, exceeding Free. Use one cron per Worker and check the account plan and all account triggers before adding slot 5.

Rollback: remove the trigger (`wrangler triggers deploy` with empty crons or redeploy the previous version). This makes no data change.

## Full capacity, revocation and reassignment

When all slots are reserved/active, stop new allocations, keep existing members signing in, and show the self-hosting guide. A rejected sixth person must not replace another person's DB binding. Expired reservations must not make a data-bearing instance reusable.

Revocation blocks subsequent authenticated access and background tasks. The control policy is checked through a trusted service binding; failure must not silently open the instance. Offer export before an ordinary planned deletion. Emergency suspension may revoke sessions immediately. Downloaded local files cannot be remotely erased.

Never reassign a revoked person's existing DB or encryption key. Rebuild independent empty resources and review retention before registering a replacement. Deletion of live rows does not instantly remove platform logs or recovery history.

## Required acceptance before real users

- Concurrent fifth/sixth reservation, duplicate request ID, repeated OAuth callback and invite expiry.
- Wrong DB marker, wrong service token, control outage and revoked member all fail closed.
- A cannot access B's content, source list, history, exports, AI cache, credentials or tasks.
- Platform provider-key environment variables do not become a hosted user's fallback.
- New users begin empty and only subscribe to chosen sources.
- Two login providers linked to one local account do not consume two slots.
- Email and Google work at each exact origin; mail logs distinguish accepted from delivered, and the UI reminds users to check Spam/Junk.
- Free-plan request/CPU, D1 rows/storage and mail limits measured across the account, including other projects. Unproven capacity is a launch blocker, not an excuse to auto-upgrade.

## 中文操作要点

每位受邀者一个 Worker、一个 D1、独立会话与加密密钥，默认最多五个“已预约＋已启用”名额。先预建空锁定实例，再原子预约邀请，验证邮箱或 Google 后激活；同一账户绑定其他登录方式不重复占名额。

受邀用户自行填写 AI／YouTube API 和信息源。控制服务不保存阅读内容或用户 Key，用户实例不持有 Cloudflare 管理令牌。公开源码支持他人自建或商用，但运营者仍需处理域名、隐私、费用、容量与邮件服务。不能宣称管理员无法访问数据或五人必定免费。

正式邮箱验证码必须验证发信域名。撤销后停止访问和任务；已有本地下载无法远程收回。旧用户数据库和密钥不直接转交新人。实际生产资源、域名、名单、OAuth 与免费额度验收均需由运营者完成，示例配置不代表已经上线。

See [operations and capacity](next-stage-operations.md), [deployment](deployment.md), [backup and rollback](backup-and-rollback.md).


### Operator helper commands

```sh
# Local validation only; the example has placeholder IDs and must be completed.
node hosting/scripts/prepare-instance.mjs --manifest hosting/tenant.example.json
# With reviewed real IDs, write NEW secrets/config to a private directory outside Git.
node hosting/scripts/prepare-instance.mjs --manifest /private/tenant.json --output /private/new-instance
# Operator API planning without a network mutation.
node hosting/scripts/operator.mjs https://YOUR-CONTROL-ORIGIN /private/request.json --dry-run
```

`prepare-instance` creates fresh file permissions, independent secrets, bindings, registration data and an identity-marker SQL file; it does not create Cloudflare resources. Apply the marker only to the assigned empty DB after reviewing its target. `operator.mjs` reads `CONTROL_ADMIN_SECRET` from the environment, never from a committed request file. Only omit `--dry-run` after reviewing the request and target. Never paste secrets into chat or a browser URL.


Expired reservations can be renewed only for the same original mailbox/member/database, subject to capacity checks. The `renew` operation does not reactivate a revoked/active slot or transfer it to a different person. Revoked slots are not recycled by this MVP. The identity-marker helper requires all expected core/derived/auth tables to exist and be empty, apart from its explicitly permitted seed bookkeeping; never apply it to a data-bearing instance.

## Optional operator free-channel account

An operator may explicitly configure a separate Worker Secret `FREE_AI_GROQ_API_KEY` for an authorized instance via `npx wrangler secret put FREE_AI_GROQ_API_KEY`, supplying it through stdin. Never copy a user's `GROQ_API_KEY` or change instance isolation. Free tasks then try Groq gpt-oss-120b → gpt-oss-20b only on a rate limit → OVH → Pollinations; unset means unchanged OVH → Pollinations. Groq sees the same task data as other free endpoints. Requests are billed/limited on the operator's Groq account (free tier), whose quotas are shared across instances using that account; the existing 10/day per-instance cap still counts once per task. As verified by the operator on 2026-11-15, each Groq model has 30 RPM, 1,000 RPD, 8,000 TPM and 200,000 TPD; verify actual account limits before provisioning. This optional supplement does not configure a user's own connection or enable background AI. See [free-channel behavior and privacy](first-use-onboarding.md#default-free-public-ai-issue-d-local-candidate). Instance release/configuration still requires the existing operator approval.
