# Custom domains / 自定义域名

The in-app guide saves a hostname and reports DNS, HTTPS and whether the hostname reaches **this** instance. It does not bind a domain, request Cloudflare credentials, change access policy, or change the canonical login origin.

## Standalone Cloudflare

The domain must belong to an active Cloudflare zone in your account. You need permission to edit the Worker and domain routes. In the Cloudflare dashboard select **Workers → your Worker → Settings → Domains & Routes → Add → Custom Domain**. Enter `feed.example.com`; Cloudflare creates the DNS record and provisions a certificate. Remove a conflicting DNS record if the dashboard requires it, after reviewing its current use.

After DNS and TLS are ready, save the hostname under **Settings → Domain** and run the connection check. The probe accepts HTTPS public hostnames only, rejects IP/private/reserved destinations, sends no credentials, follows no redirects, and limits response time and body size. A signed challenge proves the responding instance shares this instance’s encryption key. Keep instance encryption keys unique.

Then migrate sign-in deliberately: update `AUTH_BASE_URL` and register the new Google/GitHub callback. Sign-in uses one configured origin; arbitrary additional origins are not trusted. Keep the original deployment available while testing the new origin. Verification alone does not make any of these changes.

## Sites

Use Sites management tools in ChatGPT for domain binding and owner access. The website cannot safely call the conversation’s management APIs. A private Sites login redirect may prevent a public probe from proving the instance, even if binding is correct; the guide reports this as unverified rather than bypassing access controls. External invitations may still require a ChatGPT account.

中文：先在托管平台绑定域名，再在网站里检查。独立部署迁移登录域名时，需要同步修改 `AUTH_BASE_URL` 和 OAuth 回调地址；检查按钮不会替你切换。私人 Sites 的登录跳转可能导致公开检查无法完成，这不代表需要把网站改为公开。

References: [Workers Custom Domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/), [Sites management](https://learn.chatgpt.com/docs/sites/managing-a-site).
