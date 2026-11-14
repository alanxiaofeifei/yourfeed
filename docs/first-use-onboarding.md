# First-use onboarding

The tour is optional. RSS reading requires no API key. The home page always offers **Getting started**; resuming or reviewing changes tour position only, never profile, sources or provider configuration. The existing single-source entry remains separate from **Discover & import → Curated**.

## Preview

The non-production preview and its current validation status are recorded in [the project checkpoint](STATUS.md).

## Release configuration

Set `ONBOARDING_AUTO_OFFER_CUTOFF` to the **production launch day**, using the actual approved launch timestamp (ISO 8601 UTC, e.g. `YYYY-MM-DDTHH:mm:ss.sssZ`) **at deploy time**, not a hardcoded or historical date. A disposable non-production preview may deliberately use a past cutoff to exercise new-account invitations; never copy that value into production. Only a trusted local `auth_user.created_at` at or after this cutoff is eligible for an automatic invitation. Existing accounts, identity sources without a trusted creation time, invalid/missing cutoff, corrupt/unknown tour state and read failures fall back to the manual launcher. No member data should be inspected to make this decision. Deploying this PR or enabling the cutoff in production requires separate approval.

Progress is in the current reader instance's D1 `settings` namespace, scoped to authenticated auth mode + account ID + tour version. Neither client-supplied identity nor control/registry storage is used. PATCH requests use revision-based compare-and-swap; a conflict re-reads current state instead of overwriting another tab's dismissal or skips. Ordinary content archives do not copy account progress; the existing full instance backup includes settings and preserves it for same-instance recovery.

## Evidence and privacy

Tour position, viewed/skipped steps, saved configuration and verified reading are distinct. Server-derived evidence uses saved profile rows and source health plus actual content, not an empty default profile, pending sync count or an HTTP 200 alone. AI configuration is not proof of a successful test. A successful connection test can issue an opaque, ten-minute receipt bound to the authenticated account, the physical reader database, its origin, and the exact tested configuration and credential. The receipt stays in the mounted form only and is invalidated on edits. Explicit saving verifies it and atomically stores only its nonce/times and random configuration/credential revisions, not the token, key, key hash or suffix. The tour reports a recently tested connection only while those revisions still match and the absolute receipt expiry has not passed. Changed configuration/credentials, missing/invalid/expired proof, and environment-only credentials remain `not_recorded`; this does not mean a previously working connection has failed. A connection test is a user-initiated potentially billable request, not a guarantee of all AI features or future quota. No automated provider tests, subscriptions, feedback writes, billing upgrades or provider switches are performed by the tour.

The tour uses nonblocking, editorial inline regions rather than floating bubbles. Panels remain in normal document flow on mobile, including inside source dialogs, so they never cover the main controls. A pointer-transparent observed spotlight follows the current available target with a high-contrast outline and subtle surrounding dim. Geometry is read/written once per animation frame on scroll/resize/DOM changes, with ResizeObserver for target size changes; there is no polling. Target scroll is smooth unless reduced motion is requested. Headings receive non-scrolling focus on step changes, the translated step/title is announced politely, and source-dialog focus containment remains intact. Open, close and step reveals reuse FeedMotion v2 timing/easing; reduced motion disables transforms/animation and uses instant scrolling.

Tour progress and busy state live in a child controller, not in the whole feed page; the region is portalled to its inline slot (inside a source dialog when applicable). Step PATCH responses already contain evidence, so switching steps does not issue additional GETs. Explicit business saves, refresh and window refocus can reread progress. The home launcher is unconditional, outside empty-feed/profile/completion gates. AccountMenu is the single session-resolution source for the page, so its retry also repairs launcher readiness after a transient session failure; no authentication semantics changed. The top-right **My account** menu is the sole account control, with identity/session actions inside. The bottom-left is a non-interactive privacy/context note directing users there, not a duplicate identity button or an absolute security guarantee. Reading/search instructions can be viewed or skipped; this version does not persist independent proof that a user opened an article or completed a search. Source-readiness evidence is not presented as a personal read-history action.

Tour state does not contain keys or key suffixes, goals, article text, search terms, email addresses or upstream errors. The client does not persist tour progress or key drafts to localStorage. Do not enable session replay or input capture. All browser regression fixtures are synthetic and block non-local browser network requests.

## Providers and billing

Google AI Studio and Groq are the primary free-tier suggestions, subject to account/model/region quotas and terms. NVIDIA development access is supported free, quota/rate limited and does not require a payment method. Groq's [billing FAQ](https://console.groq.com/docs/billing-faqs) distinguishes the Free plan from a paid Developer upgrade.

**A zero estimated rate is not budget protection.** Site estimates, including NVIDIA preset zero rates and user-entered custom rates, cannot prevent an upstream bill. Check provider-side quotas, expiry, billing and available spending limits. This change corrects guidance; it does not change model rates, purchase credits or certify live provider compatibility.

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

The Playwright server renders real application components with a local Vite host and intercepts APIs with synthetic browser fixtures; it does not start a Worker, access real accounts, test live provider keys or establish deployment compatibility. Automatic failure screenshots, traces and video are disabled to avoid capturing credentials. The feedback regression explicitly captures only synthetic, key-free screens to `/workspace/yourfeed-onboarding-20261112/feedback-shots/`. The synthetic harness also exposes numeric React Profiler commit/duration counters; `tour performance benchmark` records five identical step changes, onboarding request counts, long tasks and a 30-resize burst. Set `TOUR_PERF_OUTPUT` to save the numeric JSON; no payloads or inputs are captured. These development-harness timings are directional comparisons, not production/device latency guarantees. Unit/API tests cover state validation, account/instance isolation, CSRF, CAS conflicts and evidence separately.

Before production approval, manually check VoiceOver/NVDA, real mobile keyboards and 200% zoom, regional signup pages and actual provider/YouTube compatibility with separately authorized test credentials. No live-key test is implied by this PR.
