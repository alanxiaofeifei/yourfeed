# Owner sign-in / 本人登录配置

This guide describes configuration, not a completed setup. Creating an OAuth app, obtaining its credentials, saving them as Worker secrets and completing an actual owner sign-in are separate steps. A visible provider button is not proof that these steps succeeded.

本文是申请和配置指南，**不代表 Google、GitHub 或 Facebook 客户端已经创建或接入成功**。每个部署只允许一位主人。下文用 `https://yourfeed.example.com` 举例，请换成你自己的 `AUTH_BASE_URL`；不要直接复制示例域名。

## 费用与选择

| 方式 | 基础登录费用与要求 | YourFeed 用法 |
|---|---|---|
| Google | 基础 OAuth / Sign in with Google 不需要购买收费登录套餐；仍须遵守平台政策、配额和审核要求。这里没有使用收费的 Identity Platform 或短信验证服务。[官方配置流程](https://developers.google.com/identity/gsi/web/guides/get-google-api-clientid) | 配置 OAuth Web 客户端后使用；优先选择与 `OWNER_EMAIL` 相同的 Gmail 或 Google Workspace 邮箱。 |
| GitHub | 普通 OAuth App 创建和基础登录不需要付费 GitHub 套餐；API 仍有限流。[官方创建流程](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/creating-an-oauth-app) | 配置 OAuth App；所选邮箱必须已验证且匹配 `OWNER_EMAIL`。 |
| Facebook | 基础 Facebook Login 不要求购买按次登录套餐；应用角色、权限、应用模式和可能的审核/验证仍适用。[官方创建流程](https://developers.facebook.com/docs/development/create-an-app/)、[Facebook Login](https://developers.facebook.com/docs/facebook-login/overview/) | 仅采用先验证主人、再显式绑定 Facebook 账户的流程；不凭 Facebook 返回的邮箱首次创建主人。需要安装包含该绑定功能的版本。 |
| Apple | 不能承诺个人免费开通。Web 登录需要 Services ID、启用 Sign in with Apple 的主 App ID 等配置；Apple Developer Program 通常为 **99 美元/年**，地区价格与符合条件的减免另计。[官方 Web 配置](https://developer.apple.com/help/account/capabilities/configure-sign-in-with-apple-for-the-web/)、[会员费用](https://developer.apple.com/programs/enroll/) | 当前没有 Apple 登录接入。仅填写 Apple 账号不会启用；不要为尚未接入的功能先购买会员。 |

这里的费用仅指基础身份登录。Cloudflare 托管、邮件服务、其他 Google/Meta 产品和视频/AI API 各自计费，不能据此理解为全部无限免费。以上官方资料核实于 2026-11-10；开通时以平台当前页面为准。

## 配置前先确认

- `AUTH_MODE=standalone`；原生 ChatGPT Sites 使用自己的登录入口，不套用这些 OAuth 设置。
- `OWNER_EMAIL` 是**你本人用于登录、接收验证码的邮箱**，不是测试发件地址。
- `AUTH_BASE_URL` 是浏览器实际访问的唯一 HTTPS 根地址，例如 `https://yourfeed.example.com`，不包含 `/login` 等路径。修改域名后也要修改 OAuth 回调。
- D1 迁移已执行，`AUTH_SECRET` 与 `APP_ENCRYPTION_KEY` 已分别配置为两个不同的随机密钥。
- OAuth 的 `*_CLIENT_ID` 与 `*_CLIENT_SECRET` 都保存到 Cloudflare **Settings → Variables and Secrets → Add → Secret**。Client ID 本身不是保密凭据，但本项目仍建议统一按 Secret 管理；Client Secret 必须保密。不要写入 Wrangler `vars`、源码或 README。

## Google：创建 OAuth Web 客户端

1. 登录 [Google Cloud Console](https://console.cloud.google.com/)，选择用于此实例的项目；已有合适项目时可以复用，不必重复创建。
2. 打开 **Google Auth Platform**，完成 **Branding** 的应用名称、用户支持邮箱和开发者联系邮箱。个人 Google 账号通常选择 **Audience → External**；Internal 仅适用于相应 Workspace 组织。如果保持 Testing，按控制台要求加入自己的测试账号。
3. 在 **Data Access** 保留基础身份范围 `openid`、`email`、`profile`。YourFeed 的登录不需要 YouTube 私人订阅、Gmail 或 Drive 权限。
4. 打开 **Clients → Create client → Web application**（旧界面可能位于 APIs & Services → Credentials → Create credentials → OAuth client ID）。填写：

   | 字段 | 示例 |
   |---|---|
   | Name | `YourFeed Web` |
   | Authorized JavaScript origins | `https://yourfeed.example.com`，只有协议和主机，不加回调路径 |
   | Authorized redirect URIs | `https://yourfeed.example.com/api/auth/callback/google` |

5. 创建后取得 **Client ID** 和 **Client Secret**，分别保存为 Worker 的 `GOOGLE_CLIENT_ID`、`GOOGLE_CLIENT_SECRET` Secret。客户端密钥可能只在创建时展示一次，按控制台提示私密保存；丢失时在控制台重新生成，不在聊天中展示。
6. 保存并使新的运行时配置生效后，打开该域名的 `/login`，选择 Google，使用与 `OWNER_EMAIL` 对应的账号完成一次真实登录。

**YouTube API Key 不是 OAuth Client Secret。** YouTube Data API Key 用来读取公开视频元数据；Google 登录要的是 Web 应用的 OAuth Client ID + Client Secret。不能把 `AIza…` 形式的 API Key 填到 `GOOGLE_CLIENT_SECRET`。

当前登录采用服务端 OAuth 回调；JavaScript origin 不会替代 redirect URI。回调的协议、域名、端口和路径必须精确匹配。若已有通过 OTP 等方式建立的主人账号，先用已有方式登录，在账户菜单显式“绑定 Google 账户”，避免把相同邮箱自动合并为同一身份。

Google 的 `email_verified` 也有边界：官方指出 Google 对 Gmail，以及 `email_verified=true` 且带 `hd` 的 Workspace 邮箱具有权威性；使用第三方邮箱注册 Google 账号时，单有该标记不一定代表当前仍控制该邮箱。请优先使用本人 Gmail/Workspace；其他邮箱先通过已有可信方式验证本人，再显式绑定。[官方说明](https://developers.google.com/identity/gsi/web/guides/verify-google-id-token)

## GitHub：创建 OAuth App

1. 打开 GitHub **Settings → Developer settings → OAuth Apps → New OAuth App**，也可从 [OAuth Apps 页面](https://github.com/settings/developers)进入。
2. 填写 Application name，例如 `YourFeed`；Homepage URL 为 `https://yourfeed.example.com`。
3. Authorization callback URL 填 `https://yourfeed.example.com/api/auth/callback/github`。
4. 创建后取得 Client ID，并生成新的 Client Secret。将它们保存为 Worker Secret：`GITHUB_CLIENT_ID` 和 `GITHUB_CLIENT_SECRET`。
5. 在 GitHub **Settings → Emails** 验证你用于登录的邮箱，并确保其与 `OWNER_EMAIL` 一致。YourFeed 请求 `read:user` 与 `user:email`，用于读取本人基本资料及邮箱验证状态，不需要仓库写权限。
6. 让运行时配置生效，再从 `/login` 测试。已有主人账号时，先用已有方式登录，再在账户菜单显式“绑定 GitHub 账户”。

如果 GitHub 公开邮箱与主邮箱不同，库可能选中公开邮箱；请核对最终选中的已验证邮箱是否匹配主人配置。不要为了通过登录而取消邮箱验证要求或自动合并账户。

## Facebook：先验证主人，再绑定

这一方式必须由包含 Facebook 显式绑定功能的版本支持。没有配置客户端、没有可信主人会话或尚未绑定时，不能把它当作首次登录入口。

1. 在 [Meta for Developers](https://developers.facebook.com/apps/) 创建适用的应用，选择支持 **Facebook Login** 的用例。记录 App ID 与 App Secret，保存为 `FACEBOOK_CLIENT_ID`、`FACEBOOK_CLIENT_SECRET` Worker Secret。
2. 在 Facebook Login 的 Client OAuth Settings 设置精确的 **Valid OAuth Redirect URI**：`https://yourfeed.example.com/api/auth/callback/facebook`。保持 Web OAuth 登录所需配置；此服务端流程不需要因为使用 Meta 网页示例就额外启用 JavaScript SDK。
3. 按控制台要求配置域名、网站 URL 和应用基本信息。应用处于 Development 时，只向获准的开发者/测试者等应用角色开放；本人账号也必须满足角色要求。公开给其他人使用所需的上线、审核或验证由 Meta 决定，不能保证个人必定获批。
4. 先用已配置的 OTP、Google 或 GitHub 登录本人账号；在最近 10 分钟验证的会话中，通过账户菜单显式绑定 Facebook。首次绑定要求提供的邮箱与主人邮箱一致；没有邮箱或不匹配时会拒绝。邮箱相同本身不构成授权。
5. 绑定完成后才可用该 Facebook 账户登录，授权依赖保存的 **provider + Facebook subject → 本地主人** 对应关系，而非再次凭返回的邮箱猜测主人。

安全原因：当前 Better Auth 的 Facebook Graph 分支在缺少可靠 `email_verified` 时返回未验证；Limited Login 同样默认未验证。Meta 的 `verified`/`is_verified` 不是“本人当前控制此邮箱”的替代证明。YourFeed 不应把这些字段强制映射成 `emailVerified=true`，也不应开启按邮箱隐式合并。[Meta User 字段说明](https://developers.facebook.com/docs/graph-api/reference/user/)、[Better Auth Facebook 文档](https://www.better-auth.com/docs/authentication/facebook)

## 常见问题与验证码收件

- **没有登录按钮或提示未配置：**检查客户端 ID 和 Secret 是否成对设置、实例基本配置是否完整，以及当前部署是否已使用新配置。这里只提供指南，不能凭文件存在判断已配置。
- **Google `redirect_uri_mismatch`：**检查是否误填了网站首页、写成另一个域名，或漏了 `/api/auth/callback/google`。不要把 JavaScript origins 当回调。
- **Owner only / account not linked：**核对邮箱与验证状态；已有主人账号时先用已有方式登录，再显式绑定。不要为解决问题放宽到任意邮箱。
- **Resend 显示已受理但未收到：**检查垃圾邮件、Spam/Junk、促销分类和 Resend 邮件事件。HTTP 200 只表示邮件服务商接受发送请求，不证明已进收件箱；即使收件服务器接受，也可能被它放入垃圾箱。
- **测试发件限制：**`onboarding@resend.dev` 只是测试发件地址，只能发给注册 Resend 的邮箱。正式使用需验证自己的发件域名，按 Resend 提示配置 SPF/DKIM，并合理配置 DMARC。`OWNER_EMAIL` 始终是本人的收件邮箱。
- **发送失败：**检查 `RESEND_API_KEY` 是 Cloudflare Secret、发件域名验证和测试收件限制。等待至少 60 秒再重发；验证码 5 分钟有效。不要把验证码、邮箱密钥或 OAuth Client Secret 发到聊天或提交 Git。

邮件配置详见 [部署指南](deployment.md#optional-email-codes) 与 [Resend 域名文档](https://resend.com/docs/dashboard/domains/introduction)。

## English setup guide

**This document is a guide, not evidence that your credentials or provider apps have been created.** Replace `https://yourfeed.example.com` with the exact `AUTH_BASE_URL` of your own instance. The instance admits one verified owner. Native ChatGPT Sites keeps its own ChatGPT sign-in and does not use standalone OAuth settings.

### Cost and availability

Google and GitHub basic OAuth sign-in do not require buying a paid sign-in plan. Basic Facebook Login likewise does not require purchasing a per-login plan, but app roles, mode, permissions and possible review/verification still apply. This refers to the direct OAuth flows linked above, not paid identity platforms, SMS, hosting, mail, video or AI services. Provider policies and limits apply; it is not a promise of unlimited free usage.

Apple is not currently wired into YourFeed. Sign in with Apple for the web requires a Services ID associated with a primary App ID enabled for the service. The Apple Developer Program normally costs **US$99 per membership year**, with regional pricing and eligible fee waivers. Do not buy a membership merely to fill an unsupported setting. See [Apple web setup](https://developer.apple.com/help/account/capabilities/configure-sign-in-with-apple-for-the-web/) and [official enrollment pricing](https://developer.apple.com/programs/enroll/).

### Common settings

Use `AUTH_MODE=standalone`, your own verified email as `OWNER_EMAIL`, and the exact HTTPS origin as `AUTH_BASE_URL`. The database migrations and two separate random secrets, `AUTH_SECRET` and `APP_ENCRYPTION_KEY`, must already be configured. Store OAuth client IDs and client secrets under Cloudflare **Settings → Variables and Secrets → Secret**. A client ID is not confidential by itself, but a client secret must remain server-side. Do not commit credentials to Wrangler `vars` or source control.

### Google

1. Select or create a project in [Google Cloud Console](https://console.cloud.google.com/). Under Google Auth Platform, complete Branding and Audience. Personal accounts normally use External; add your owner account as a test user where required while the app is in Testing.
2. Request only `openid`, `email` and `profile`. Create a client of type **Web application** under Clients.
3. Set **Authorized JavaScript origins** to `https://yourfeed.example.com` and **Authorized redirect URIs** to `https://yourfeed.example.com/api/auth/callback/google`. The origin has no callback path; the redirect must include it exactly.
4. Save the client ID as `GOOGLE_CLIENT_ID` and client secret as `GOOGLE_CLIENT_SECRET` Worker secrets. A YouTube Data API key is a different credential and cannot replace either OAuth value.
5. Apply the runtime configuration and test actual owner sign-in. If an owner account already exists, sign in through the existing method and explicitly link Google from the account menu. Prefer a matching Gmail or Google Workspace account; for other Google account email domains, see [Google's authoritative-email guidance](https://developers.google.com/identity/gsi/web/guides/verify-google-id-token).

### GitHub

1. Open **Settings → Developer settings → OAuth Apps → New OAuth App**.
2. Set Homepage URL to `https://yourfeed.example.com` and Authorization callback URL to `https://yourfeed.example.com/api/auth/callback/github`.
3. Save the ID and newly generated secret as `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET` Worker secrets.
4. Verify the chosen GitHub email and match it to `OWNER_EMAIL`. The app requests `read:user` and `user:email`, not repository write access. Apply the configuration, then sign in or explicitly link to an existing owner account.

### Facebook

Use only a release that includes Facebook owner-account linking. Create a Meta app with Facebook Login, save App ID/Secret as `FACEBOOK_CLIENT_ID`/`FACEBOOK_CLIENT_SECRET`, and set its valid redirect URI to `https://yourfeed.example.com/api/auth/callback/facebook`. Configure required app/domain details and your app role in Development mode. Approval requirements for wider access are controlled by Meta.

First sign in through an already trusted OTP, Google or GitHub method. Within a recently authenticated owner session, explicitly link Facebook. Missing or mismatched email is refused, but email equality itself does not authorize the account. Subsequent sign-in uses the previously stored Facebook subject binding to the local verified owner. Never force `emailVerified=true` from Facebook `verified` or `is_verified`, or enable implicit email-based account merging.

### Email codes and troubleshooting

Check Spam/Junk, promotional folders and Resend delivery events when an accepted message is missing. HTTP 200 means accepted by the sending service, not delivered to your inbox. `onboarding@resend.dev` is a test sender and can send only to the email used to register Resend. For normal use, verify your own sending domain and configure its DNS authentication. Keep `RESEND_API_KEY` as a Cloudflare Secret. Wait at least 60 seconds before requesting another code; codes expire after five minutes.

For callback errors, compare scheme, host, port and the complete `/api/auth/callback/PROVIDER` path. For owner or linking errors, use the existing trusted sign-in method and link explicitly; do not relax the owner boundary. Never share login codes or client secrets in chat. See [deployment](deployment.md) for runtime setup.
