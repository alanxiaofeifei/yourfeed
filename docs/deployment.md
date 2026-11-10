# Deploy and configure sign-in / 部署与登录

## Cloudflare Deploy Button

1. Open [Deploy to Cloudflare](https://deploy.workers.cloudflare.com/?url=https://github.com/alanxiaofeifei/yourfeed). Choose your account, repository and Worker name. The source repository must be public; your copied repository can be managed according to your needs.
2. Keep the detected build command `npm run build` and deploy command `npm run deploy`. Cloudflare provisions the `DB` D1 binding and updates its placeholder ID. The deploy script runs `wrangler d1 migrations apply DB --remote` before publishing the built Worker. Review the new database ID; the all-zero source ID is only a template placeholder.
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

For remote deployment set secret bindings using `npx wrangler secret put NAME`; place non-secret settings such as `AUTH_MODE=standalone` and the final `AUTH_BASE_URL` in your private config or dashboard. Then run `npm run build` followed by `npm run deploy`. Review which account and database the commands target. The `DB` binding must retain this name even if you rename the database.

## Optional ChatGPT Sites adapter

Keep a private `.openai/hosting.json` managed by Sites, with its actual project ID and logical `d1: "DB"` binding. Run `npm run build:sites`; it packages the manifest and migrations into `dist/.openai`. Set runtime `AUTH_MODE=sites` **only on native Sites hosting**, where the platform authenticates the request and supplies trusted identity headers. Do not set it on an ordinary public Worker. Do not commit a real Sites project ID to the generic public repository.

Sites owner access is managed in ChatGPT; this adapter does not convert it into Google/GitHub login. Shared Vite/build adapters support Sites; updates preserve consumer package scripts, private branding and deployment manifests.

## References

- [Cloudflare Deploy Buttons, automatic resources and migration commands](https://developers.cloudflare.com/workers/platform/deploy-buttons/)
- [D1 migrations](https://developers.cloudflare.com/d1/reference/migrations/)
- [Worker secrets](https://developers.cloudflare.com/workers/configuration/secrets/)
- [Sites management](https://learn.chatgpt.com/docs/sites/managing-a-site)
