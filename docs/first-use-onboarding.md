# First-use onboarding

The tour is optional. RSS reading requires no API key. The home page always offers **Getting started**; resuming or reviewing changes tour position only, never profile, sources or provider configuration. The existing single-source entry remains separate from **Discover & import → Curated**.

## Release configuration

Set `ONBOARDING_AUTO_OFFER_CUTOFF` to the actual approved enablement timestamp (ISO 8601 UTC, e.g. `YYYY-MM-DDTHH:mm:ss.sssZ`) **at release**, not to a historical date. Only a trusted local `auth_user.created_at` at or after this cutoff is eligible for an automatic invitation. Existing accounts, identity sources without a trusted creation time, invalid/missing cutoff, corrupt/unknown tour state and read failures fall back to the manual launcher. No member data should be inspected to make this decision. Deploying this PR or enabling the cutoff in production requires separate approval.

Progress is in the current reader instance's D1 `settings` namespace, scoped to authenticated auth mode + account ID + tour version. Neither client-supplied identity nor control/registry storage is used. PATCH requests use revision-based compare-and-swap; a conflict re-reads current state instead of overwriting another tab's dismissal or skips. Ordinary content archives do not copy account progress; the existing full instance backup includes settings and preserves it for same-instance recovery.

## Evidence and privacy

Tour position, viewed/skipped steps, saved configuration and verified reading are distinct. Server-derived evidence uses saved profile rows and source health plus actual content, not an empty default profile, pending sync count or an HTTP 200 alone. AI configuration is not proof of a successful test. This version binds the visible connection-test result to the current in-memory draft, but does **not** persist a server-side test receipt: after reload the tour deliberately reports AI verification as `not_recorded`, never as verified. This is a conservative deviation from the planned persisted receipt, not a completed verification feature. A connection test is a user-initiated potentially billable request, not a guarantee of all AI features or future quota. No automated provider tests, subscriptions, feedback writes, billing upgrades or provider switches are performed by the tour.

The tour uses nonblocking inline regions with anchor highlighting rather than desktop-positioned floating bubbles. Reading/search instructions can be viewed or skipped; this version does not persist independent proof that a user opened an article or completed a search. Source-readiness evidence is not presented as a personal read-history action.

Tour state does not contain keys or key suffixes, goals, article text, search terms, email addresses or upstream errors. The client does not persist tour progress or key drafts to localStorage. Do not enable session replay or input capture. All browser regression fixtures are synthetic and block non-local browser network requests.

## Providers and billing

Google AI Studio and Groq are the primary free-tier suggestions, subject to account/model/region quotas and terms. NVIDIA development access is supported free, quota/rate limited and does not require a payment method. Cerebras uses neutral wording: its [official limits FAQ](https://inference-docs.cerebras.ai/support/rate-limits.md) checked 2026-11-12 states the trial requires a verified payment method; it must not be advertised as a card-free free tier. Groq's [billing FAQ](https://console.groq.com/docs/billing-faqs) distinguishes the Free plan from a paid Developer upgrade.

**A zero estimated rate is not budget protection.** Site estimates, including NVIDIA/Cerebras preset zero rates and user-entered custom rates, cannot prevent an upstream bill. Check provider-side quotas, expiry, billing and available spending limits. This change corrects guidance; it does not change model rates, purchase credits or certify live provider compatibility.

## Local validation

```sh
npm ci
npm test
npm run typecheck
npm run build
npx playwright install chromium
npm run test:e2e
# Optional existing browser instead of a Playwright browser download:
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/google-chrome npm run test:e2e
```

The Playwright server renders real application components with a local Vite host and intercepts APIs with synthetic browser fixtures; it does not start a Worker, access real accounts, test live provider keys or establish deployment compatibility. Screenshots, traces and video are disabled to avoid capturing credentials. Unit/API tests cover state validation, account/instance isolation, CSRF, CAS conflicts and evidence separately.

Before production approval, manually check VoiceOver/NVDA, real mobile keyboards and 200% zoom, regional signup pages and actual provider/YouTube compatibility with separately authorized test credentials. No live-key test is implied by this PR.
