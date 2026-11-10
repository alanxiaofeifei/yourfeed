# YourFeed

[中文说明](README.zh-CN.md)

A private home for videos, articles, news, saved posts and open-source projects. Choose a relaxed feed for a break or a focused feed for your next step. Your sources and feedback shape the ranking; updates happen when you open the site or request them.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/alanxiaofeifei/yourfeed)

The button creates your own repository, Worker and D1 database. **Finish owner sign-in configuration before using the feed.** An unconfigured instance shows setup instructions and keeps private APIs closed. Google and GitHub sign-in are supported; email codes are optional. See the [deployment guide](docs/deployment.md).

`OWNER_EMAIL` is **your own sign-in and code-recipient email**. `onboarding@resend.dev` is a test **sender**, never your owner address; it can send only to the email used to register your Resend account. Normal email use requires a verified sending domain. Store `RESEND_API_KEY` as a Cloudflare **Secret**, not Text. A successful send request means the provider accepted it, not that it reached your inbox; rejected requests are shown as errors.

- One feed for video, reading, news, posts and projects; filters, saved items, history and source feedback.
- English and Chinese UI, a personal onboarding profile, and three editable starting directions: IT & AI practice, developers & creators, and knowledge explorer.
- RSS, public GitHub stars, YouTube metadata with your API key, best-effort Bilibili updates, and link imports.
- Optional AI reading through OpenAI, DeepSeek, GLM or an HTTPS compatible provider. Provider/model selection is explicit; daily limits, budget reservations and analysis caching bound usage. Prices and upstream subscriptions are separate from hosting.
- Owner-only standalone sign-in, server-side encrypted API keys, and an optional ChatGPT Sites adapter.
- A domain guide checks public DNS, HTTPS and this instance. It never collects Cloudflare management tokens or changes your sign-in origin.

## Who is it for?

- **IT & AI practice:** people building practical skills in IT, networking, Linux and workplace automation, with hands-on and science content for breaks.
- **Developers & creators:** people following programming, open source, AI tools and creative workflows, with room for making and visual ideas.
- **Knowledge explorer:** people who enjoy science, history, culture and thoughtful reading, while learning tools that support their next goal.

These are editable starting points. Every profile includes both rest and focused learning; your feedback takes priority over its initial interests.

## Start locally

Use Node.js 22.13 or later and npm.

```sh
npm ci
cp .env.example .dev.vars
# Fill instance settings and one OAuth provider; see docs/deployment.md.
npm run db:migrate:local
npm run dev
```

The example contains no usable credentials. Generate independent encryption and authentication secrets using `openssl rand -hex 32`. AI is optional and starts disabled; no provider fallback silently spends money with another service.

## Deploy and maintain

Read [deployment and sign-in](docs/deployment.md), [custom domains](docs/domains.md), and [backup and rollback](docs/backup-and-rollback.md). The standalone target is Cloudflare Workers with D1. The build supports a separate `YOURFEED_BUILD_PROFILE=sites` adapter; real Sites IDs and access settings belong only in your private deployment.

```sh
npm run typecheck
npm test
npm run build
# After reviewing the target account, D1 ID and secrets:
npm run deploy
```

`deploy` applies database migrations before publishing. Database migrations are not undone by a code rollback. Configure Cloudflare billing and service budgets for your own account; do not assume every workload fits a free tier.

Consumers can receive a reviewed shared-code update PR every six hours or manually. The updater protects deployment configuration, seed/profile files and local edits; it never merges, deploys or applies database migrations. Enable it using [the shared-core guide](docs/shared-core.md). Source updates are proposals requiring review.

## Architecture and limits

TypeScript, React/Vinext, Cloudflare Workers, D1 and Drizzle. Content is stored in your own instance. Platform players retain original attribution. Some videos cannot embed; external links remain available. Bilibili public endpoints can rate-limit or change. X and APPSO support link imports rather than a guaranteed free live API. AI notes identify whether they use full text, excerpts or metadata.

This project is for one owner per deployment. It is not a multi-tenant hosting service. Imported content is untrusted material, never a system instruction. Keep personal archives, keys, cookies and database exports out of Git.

MIT licensed. Third-party media, content and provider services retain their own terms.
