# Independent invited instances / 独立实例受邀托管

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

Do not copy the operator's `OPENAI_API_KEY`, DeepSeek, GLM, Gemini, Groq, NVIDIA, Cerebras, YouTube credentials, `AUTH_SECRET` or encryption master key to tenant instances. Hosted users supply their own provider keys in private settings. Google OAuth and Resend may be shared **login/sending services**, but user sessions and content stay local to each instance. Notebook authorization is separate from Google sign-in.

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
