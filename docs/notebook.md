# Google NotebookLM / Gemini Notebook sharing

[中文说明](#中文说明)

Every content card offers **Share → Copy source URL**. The URL belongs to the original publisher, not the private feed. **Copy URL & open Notebook** works without API credentials: paste the copied URL into an existing or new notebook using **Add sources → Website / YouTube**. A visible URL field is provided if clipboard permission is denied. You can also upload the downloaded `.md` file. Opening Notebook does **not** mean a source was automatically imported.

## Optional direct import

An optional integration uses Google's official [Gemini Notebook API](https://developers.google.com/notebook/docs), currently in early-access Public Preview. Google's [authentication guide](https://developers.google.com/notebook/docs/authentication) says it supports personal Google Accounts during preview; Workspace accounts are not supported. Sign in to [Google Notebook](https://notebook.google.com/) at least once before connecting.

The integration requires separate Notebook read/write consent. **Signing in to YourFeed with Google does not grant Notebook access**, and YouTube/OpenAI API keys cannot authorize it.

1. In your own Google Cloud project, enable **Gemini Notebook API** (`notebook.googleapis.com`). Follow the official authentication guide to configure the OAuth consent screen and add `https://www.googleapis.com/auth/notebook` under Data Access. If the OAuth application is in testing, add your own Google account as a test user. Google's app verification and consent-screen requirements apply to your deployment.
2. Use a **Web application** OAuth client. You may reuse your existing Google sign-in client, but add the new callback URL shown in the content's **Share → Notebook connection settings**. For a deployment at `https://feed.example.com`, it is `https://feed.example.com/api/notebook/callback`. Keep the existing sign-in callback unchanged. Each separately hosted instance needs its own exact callback URL.
3. To use an independent client, put `NOTEBOOK_GOOGLE_CLIENT_ID` and `NOTEBOOK_GOOGLE_CLIENT_SECRET` in the deployment's runtime secrets. Configure both together. If neither is present, the existing `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` pair is used; a partial Notebook-specific pair is deliberately disabled. Do not paste client secrets into content, chat, or GitHub.
4. The Google Cloud project ID field is optional for ordinary web OAuth: leave it blank to use the OAuth client's project. Set it only if a quota project is required for your setup. It is not an API key or an account email.
5. While signed in as the instance owner, choose **Connect Google Notebook** from a content item's Share menu. Reauthenticate with the feed first if requested. Google will explicitly ask for Notebook access. After returning, reopen Share, choose one of your notebooks, and select **Add source URL to Notebook**. The most recently successful notebook is selected next time.

Only the selected cached item's original public source URL and title are submitted. The request does not include your reading history, profile, AI summary, cached article body, or AI-provider credentials. Google fetches and processes the source under its own [supported-source rules](https://developers.google.com/notebook/docs/sources). The app distinguishes `PROCESSING`, `ACTIVE`, and `FAILED`; submission is not a guarantee that Google can ingest the page or video. For content Google cannot read directly, download the available source text or AI summary as Markdown and upload that file yourself.

Notebook tokens are encrypted in the instance database with the existing encryption master key and are separate from sign-in records. They never appear in client responses. OAuth uses owner-bound expiring one-time state and PKCE. Credentialed network requests go only to fixed official Google endpoints and reject redirects. Source creation is deduplicated per owner, notebook, and exact source URL. An uncertain write is not retried automatically; check Notebook before attempting to add it another way.

**Disconnect Notebook** removes the credentials stored by this instance. To revoke the Google grant completely, remove the app from your [Google Account third-party connections](https://myaccount.google.com/connections). Neither disconnecting nor sharing changes your feed login method or deletes your Google notebooks.

API access is subject to Google's current preview availability, quotas, account eligibility, and terms. This project does not promise unlimited or permanently free API usage. The copy/open and Markdown-upload paths remain available without this integration.

## 中文说明

每条内容都有 **分享 → 复制源链接**：复制原作者或平台的网址，不是私人内容库的网址。**复制链接并打开 Notebook** 不需要 API 凭据：在 Notebook 中打开或创建笔记本，选择 **添加来源 → 网站 / YouTube** 并粘贴。如果浏览器禁止自动复制，界面会显示可手动复制的链接输入框。也可以上传下载的 Markdown 文件。仅打开 Notebook 不代表已经自动导入。

### 可选：直接添加来源

此功能使用 Google 官方 [Gemini Notebook API](https://developers.google.com/notebook/docs)，目前为早期公开预览。根据[官方授权说明](https://developers.google.com/notebook/docs/authentication)，预览阶段仅支持个人 Google 账号，暂不支持 Workspace 账号。请先使用准备授权的账号至少登录一次 [Google Notebook](https://notebook.google.com/)。

**Google 登录网站与授权 Notebook 读写是两件事**；YouTube 或 OpenAI API Key 也不能代替 Notebook OAuth 授权。

1. 在自己的 Google Cloud 项目启用 **Gemini Notebook API**（`notebook.googleapis.com`）。按官方说明配置 OAuth 同意屏幕，在 Data Access 添加 `https://www.googleapis.com/auth/notebook`。处于测试状态的 OAuth 应用需把自己的 Google 账号加入测试用户；是否需要额外审核以 Google 当前要求为准。
2. 使用类型为 **Web application** 的 OAuth 客户端。可以复用现有 Google 登录客户端，但必须额外添加 **分享 → Notebook 连接设置** 中显示的回调地址。例如站点为 `https://feed.example.com`，回调地址就是 `https://feed.example.com/api/notebook/callback`。保留原有登录回调，每个独立部署的站点分别添加自己的完整地址。
3. 若使用独立客户端，在部署环境的秘密变量中配置 `NOTEBOOK_GOOGLE_CLIENT_ID` 与 `NOTEBOOK_GOOGLE_CLIENT_SECRET`，两个一起配置。两者都未设置时，使用现有 `GOOGLE_CLIENT_ID` 与 `GOOGLE_CLIENT_SECRET`；Notebook 专用变量只填写一半时，会安全停用。不要把客户端密钥写进内容、聊天或 GitHub。
4. Google Cloud 项目 ID 通常留空，使用 OAuth 客户端项目；只有需要指定配额项目时才填写。这里不是邮箱或 API Key。
5. 用实例所有者身份登录后，在内容分享菜单选择 **授权连接 Google Notebook**。如果网站要求重新验证身份，先重新登录。Google 会单独征求 Notebook 读写授权。返回后重新打开分享菜单，选择笔记本，再点 **一键添加源链接到 Notebook**。下次会优先选择最近成功使用的笔记本。

直接添加只提交该内容的公开原始链接和标题，不发送用户画像、阅读历史、AI 总结、缓存正文或 AI 服务商密钥。Google 根据自己的[来源支持规则](https://developers.google.com/notebook/docs/sources)读取内容；界面会区分处理中、可使用和读取失败。提交成功不等于内容已被成功解析。无法直接读取的页面或视频，可以下载本站可读取的文字或 AI 总结为 Markdown，再手动上传。

Notebook 授权令牌使用现有加密主密钥加密保存在实例数据库，与网站登录记录分开，不返回给浏览器。授权使用绑定当前所有者的短期一次性 state 与 PKCE。带凭据请求只访问固定的 Google 官方地址，并拒绝跟随重定向。同一用户、笔记本和源链接不会重复提交；外部写入结果不确定时，不会自动重试，请先去 Notebook 查看。

**断开 Notebook 连接** 会删除本站保存的令牌。如需彻底撤销 Google 授权，请在 [Google 账号的第三方连接](https://myaccount.google.com/connections)中移除应用。分享或断开连接均不会更改网站登录方式，也不会删除 Google 笔记本。

API 使用受 Google 当前预览开放范围、额度、账号资格与条款限制，本项目不承诺无限或永久免费的 API 调用。无需该授权的复制链接、打开 Notebook 和上传 Markdown 方式始终保留。
