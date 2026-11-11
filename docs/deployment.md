# Deploy and configure sign-in / 部署与登录

## Cloudflare Deploy Button

1. Open [Deploy to Cloudflare](https://deploy.workers.cloudflare.com/?url=https://github.com/alanxiaofeifei/yourfeed). Choose your account, repository and Worker name. The source repository must be public; your copied repository can be managed according to your needs.
2. Keep the detected build command `npm run build` and deploy command `npm run deploy`. Cloudflare provisions the `DB` D1 binding and updates its placeholder ID. Set `YOURFEED_DEPLOY_MODE=initial`, your explicit `CLOUDFLARE_ACCOUNT_ID`, and the final `AUTH_BASE_URL`. The guarded deploy checks that the target DB is empty before applying migrations. Review the actual database ID; the all-zero source ID is only a template placeholder. An existing database requires the release workflow below, not initial mode.
3. Set `OWNER_EMAIL` to **your own verified sign-in email**. It is the recipient for email codes, not a sending address such as `onboarding@resend.dev`. Generate **two different** values with `openssl rand -hex 32`: `APP_ENCRYPTION_KEY` and `AUTH_SECRET`. Keep both in private backup. Set `AUTH_BASE_URL` to the final HTTPS origin, without a path. If you do not yet know the workers.dev origin, finish deployment, find it in the dashboard, correct the setting, then redeploy. The app stays closed until configuration works.
4. Choose Google or GitHub OAuth below. Email OTP is optional. Set credentials through Worker secrets, never in committed configuration. Redeploy after changing bindings.
5. Open the site and sign in as the owner. Another email is denied. Complete the interest onboarding, add sources, and optionally configure AI in the private settings page.

按钮会自动创建 D1，但不能替你取得 Google/GitHub 的 OAuth 凭据。请先完成登录方式；未完成配置时私人数据接口不会开放。不需要先配置 Resend 或购买邮件服务。

## Google or GitHub sign-in

Register an OAuth web application with your chosen provider. Set its home page to `AUTH_BASE_URL` and callback to:

| Provider | Callback | Worker secrets |
|---|---|---|
| Google | `https://YOUR-HOST/api/auth/callback/google` | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` |
| GitHub | `https://YOUR-HOST/api/auth/callback/github` | `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` |

Google: create OAuth credentials in [Google Cloud Console](https://console.cloud.google.com/apis/credentials), configure the consent screen, and add your owner account as a test user if the app is in testing. GitHub: [Developer settings → OAuth Apps](https://github.com/settings/developers). The owner account must supply a verified email matching `OWNER_EMAIL`; check provider email/privacy settings if it is rejected.

These OAuth applications are separate from YouTube Data API credentials. YourFeed does not need access to private subscriptions for owner sign-in. Register the exact callback for your chosen origin; add a new callback before a domain migration.

## Optional email codes

Set `RESEND_API_KEY` and `AUTH_EMAIL_FROM` only if you want email OTP. OTP is not needed when a configured OAuth provider works.

| Setting | Meaning |
|---|---|
| `OWNER_EMAIL` | Your own owner/sign-in email, which receives the code. Never set it to the Resend test sender. |
| `AUTH_EMAIL_FROM` | The sender shown on email. For testing, `YourFeed <onboarding@resend.dev>` is allowed only when the recipient is the email used to register the Resend account. For normal use, verify your own sending domain in Resend and use an address on that domain. |
| `RESEND_API_KEY` | The Resend credential. In Cloudflare **Settings → Variables and Secrets**, create it as **Secret**, not Text. With the CLI use `npx wrangler secret put RESEND_API_KEY`. Do not commit it to Wrangler `vars`. |

An HTTP 200 response from the send API means the provider **accepted** the message; it does not prove inbox delivery. YourFeed reports a rejected sending request as an error instead of claiming a code was sent. An accepted message can still be delayed, bounced or filtered: inspect Resend delivery events and your spam folder. Mail delivery has its own limits, verification and pricing; consult [Resend pricing](https://resend.com/pricing). Codes expire in five minutes and resend attempts are limited. Never log codes or put mail keys in a URL.

中文：`OWNER_EMAIL` 是你本人登录、接收验证码的邮箱。`onboarding@resend.dev` 只是测试发件地址，只能给注册 Resend 的邮箱发信，不能把它当作用户邮箱。正式使用需要验证自己的发件域名。Cloudflare 的 `RESEND_API_KEY` 必须选 **Secret（密钥）**，不要选 Text。发送成功只表示服务商受理，不保证邮件已到达收件箱；发送请求失败时网站会明确报错。

## Local and CLI setup

```sh
npm ci
npx wrangler login
npx wrangler d1 create yourfeed
# Put the returned database_id in your private wrangler.jsonc.
cp .env.example .dev.vars
# For local development only: AUTH_BASE_URL=http://localhost:5173
# Set AUTH_ALLOW_INSECURE_LOCAL=true in .dev.vars; never set it in production.
# Fill secrets, owner and one login provider.
npm run db:migrate:local
npm run dev
```

For remote deployment set secret bindings using `npx wrangler secret put NAME`; place non-secret settings such as `AUTH_MODE=standalone` and the final `AUTH_BASE_URL` in your private config or dashboard. Then run `npm run build`, `npm run deploy:dry-run`, and `npm run deploy`. `deploy:dry-run` validates local target settings without contacting Cloudflare; it does not prove the remote database is empty or recoverable. The live command first performs read-only remote checks. Review which account and database the commands target. The `DB` binding must retain this name even if you rename the database.

## Optional ChatGPT Sites adapter

Keep a private `.openai/hosting.json` managed by Sites, with its actual project ID and logical `d1: "DB"` binding. Run `npm run build:sites`; it packages the manifest and migrations into `dist/.openai`. Set runtime `AUTH_MODE=sites` **only on native Sites hosting**, where the platform authenticates the request and supplies trusted identity headers. Do not set it on an ordinary public Worker. Do not commit a real Sites project ID to the generic public repository.

Sites owner access is managed in ChatGPT; this adapter does not convert it into Google/GitHub login. Shared Vite/build adapters support Sites; updates preserve consumer package scripts, private branding and deployment manifests.

## References

- [Cloudflare Deploy Buttons, automatic resources and migration commands](https://developers.cloudflare.com/workers/platform/deploy-buttons/)
- [D1 migrations](https://developers.cloudflare.com/d1/reference/migrations/)
- [Worker secrets](https://developers.cloudflare.com/workers/configuration/secrets/)
- [Sites management](https://learn.chatgpt.com/docs/sites/managing-a-site)


## Reviewed updates and preview isolation

`npm run deploy` and `npm run db:migrate:remote` share the same target guard. The migration-only command does not publish code. Direct Wrangler commands can bypass this guard; operators are responsible for restricting credentials and workflow permissions.

For an existing production instance:

1. Commit the reviewed source. Build it and record its complete SHA.
2. Verify the actual account, Worker, D1 binding and applied migrations with a read-only query. Check the complete application schema/health as well; a migration name alone is not proof that all required structures exist.
3. Verify a private database backup and a supported recovery procedure. Keep the encryption master key separately. A checked box without a restore rehearsal is not recovery evidence.
4. Store a release manifest **outside the repository**, containing metadata only:

```json
{
  "version": 1,
  "accountId": "YOUR_32_HEX_ACCOUNT_ID",
  "worker": "your-worker",
  "databaseId": "YOUR-ACTUAL-D1-UUID",
  "origin": "https://your-worker.example.workers.dev",
  "sourceSha": "COMPLETE_40_CHARACTER_COMMIT_SHA",
  "appliedMigrations": ["0000_initial.sql", "0001_auth.sql"],
  "previousCodeVersion": "PREVIOUS_WORKER_VERSION_ID",
  "backupRef": "PRIVATE_BACKUP_OR_TIME_TRAVEL_REFERENCE",
  "recoveryVerified": true
}
```

Use the actual migration filenames from your database and checkout; the example is not a command to reset migration history. Do not put tokens, owner addresses, database contents or key values in this file. Set `YOURFEED_DEPLOY_MODE=release` and `YOURFEED_RELEASE_MANIFEST=/absolute/private/path/release.json`, then run the dry run. The live deployment checks the target's migration list has not changed, applies pending migrations, verifies the resulting list, then publishes the built Worker. If publishing fails, migrations may already have applied: inspect state before retrying.

Cloudflare Builds can deploy after a production-branch push. Configure a **separate Worker, DB, keys and origin** for preview builds. Never run the production deploy command with a preview branch or a production DB binding. `WORKERS_CI_BRANCH`/`CF_PAGES_BRANCH` and `YOURFEED_PREVIEW=true` block accidental use of the production script, but a branch check is not a substitute for separate credentials and databases. No automatic production migration runs in this repository's CI workflow.

中文：首次部署用 `initial`，只允许空数据库；已有实例用 `release`，必须先有备份、恢复验证、完整提交和目标清单。`deploy:dry-run` 只读本地配置，不联网，不等于生产检查通过。预览必须独立数据库和密钥。发布失败也可能已经迁移数据库，不能直接当作“没有变化”。

## Deployment destinations and honest buttons

| Platform | Current project status | Entry |
|---|---|---|
| Cloudflare | Native Worker/D1 target with official repository-copy button; requires sign-in/API configuration and a clean-account acceptance run | [Official Deploy Button](https://deploy.workers.cloudflare.com/?url=https://github.com/alanxiaofeifei/yourfeed) |
| ChatGPT Sites | Existing adapter; requires Sites access, new Site identity, private manifest, independent storage and secrets | [Sites guide](https://learn.chatgpt.com/docs/sites/creating-a-site); no verified generic GitHub deploy-button URL |
| Vercel | Runtime and DB port required; not a drop-in ordinary Next.js app | [Official Deploy Button docs](https://vercel.com/docs/deploy-button), for a future tested port only |
| Railway | Node/container and DB adapter/template required | [Template documentation](https://docs.railway.com/templates/publish-and-share), no current project template |
| Claude Artifacts | Interactive artifacts are not equivalent to an independent arbitrary Worker/D1 deployment | [Official product description](https://support.claude.com/en/articles/17153992-what-are-artifacts-and-how-do-i-use-them) |
| Kimi Build | Official full-stack website capabilities exist, but this project's OAuth/DB/runtime compatibility is not verified | [Official overview](https://www.kimi.com/help/websites/websites-overview) |
| QwenWork | Official dynamic Node/database hosting exists; this project's port, secrets, OAuth and background tasks are unverified | [Official website documentation](https://www.alibabacloud.com/help/zh/qwenwork/my-webpage) |

Do not add “available” buttons for unported platforms, copy the developer's Cloudflare account/data, or publish AlanFeed as a public template. A future Sites template must be built from sanitized public YourFeed source, create a new Site with a new DB/key/owner, and pass real deployment acceptance before advertising it.
