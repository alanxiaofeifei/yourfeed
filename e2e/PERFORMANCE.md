# Production tour interaction benchmark

The default `npm run test:e2e` still uses the lightweight Vite synthetic page. For production evidence, first build the Cloudflare target, then run:

```sh
YOURFEED_BUILD_PROFILE=cloudflare npm run build
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/google-chrome \
  PLAYWRIGHT_PRODUCTION=1 TOUR_PERF_OUTPUT=../perf-A-before.json TOUR_PERF_ASSERT=0 \
  npm run test:e2e -- e2e/tour-performance.spec.mjs --workers=1
# After implementation and a NEW build, run the identical test with:
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/google-chrome \
  PLAYWRIGHT_PRODUCTION=1 TOUR_PERF_OUTPUT=../perf-A-after.json TOUR_PERF_ASSERT=1 \
  npm run test:e2e -- e2e/tour-performance.spec.mjs --workers=1
```

Do not overwrite the before JSON or rebuild while its benchmark is running. Playwright owns the server lifecycle; stop other port-4175 servers before starting. Production mode starts `npm start -- --port 4175 --compatibility-date 2026-05-22 --var AUTH_MODE:sites`, hence the built `dist/server/wrangler.json` Worker via **local** Wrangler only. The date is a local runtime override for this checkout's installed workerd ceiling; no remote commands/config changes are performed. A writable `.wrangler/e2e-config` houses the local Wrangler registry/logs. The test-local `AUTH_MODE:sites` override allows the real Worker to render the home page without a standalone server-side session; browser session/API responses remain synthetic. This changes no app code or deployed authentication and must never be used to infer standalone auth acceptance. No credentials are required or read by the fixture. Browser APIs use the shared synthetic fixture; external browser requests are aborted. No real API/provider/network service is benchmarked.

The spec verifies real `/_next/static/` JavaScript resources, absence of Vite's dev client, and records the complete JS/CSS asset list and SHA256 identity. It takes 12 samples per action (override `TOUR_PERF_SAMPLES`), per scenario:

- desktop 1280×800, unthrottled CPU;
- mobile viewport 390×844, Chromium CDP 4× CPU slowdown (not real-device evidence);
- each with native local browser-route fulfillment and with a **SIMULATED** extra 250ms on onboarding PATCH responses. No latency is added to other APIs.

A capture listener records the actual trusted pointer-generated `click` event's `timeStamp` as a `performance.mark`. rAF observes the first visible changed `.tour-region[data-step]` or its removal. A following rAF records the end mark and measure, allowing a paint opportunity. This is a conservative rendered-frame proxy, not physical/compositor presentation telemetry or INP. Playwright click actionability, scrolling before the click, and assertion/polling time are excluded. All samples include the start/end clocks and API method/path/start/end (no payloads), marking whether requests initiated in the click-to-frame interval completed before render. This overlap is critical-path diagnostic evidence, not proof of causation by itself. The native/simulated latency comparison distinguishes persistence-gated presentation from optimistic presentation.

Next starts at language, Skip at profile interests, Back at profile save, Exit at profile interests. Each round reopens the tour at language. The harness waits for outstanding PATCHes **after** recording each frame so samples remain independent without adding persistence time to the measurement. The p50/p95 use nearest-rank percentiles; 12 samples are repeatable local diagnostic evidence, not a large population guarantee. Desktop p95 <100ms is enforced by default for all actions in both delay modes; the baseline explicitly opts out with `TOUR_PERF_ASSERT=0`. `TOUR_PERF_ASSERT=1` explicitly enables the normal implementation acceptance gate. Mobile percentiles are logged, not gated.

Required screenshot evidence can be regenerated with `PLAYWRIGHT_PRODUCTION=1 TOUR_SCREENSHOTS=1 PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/google-chrome npm run test:e2e -- e2e/tour-screenshots.spec.mjs --workers=1`; files go to `/workspace/yourfeed-onboarding-20261112/phaseA-shots/`. The normal production regression command is `PLAYWRIGHT_PRODUCTION=1 PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/google-chrome npm run test:e2e -- --workers=1` (performance/screenshot collection are opt-in, interaction assertions remain active).

The old Profiler benchmark remains development-only and is skipped in production mode. Production interactions are not compared against development React timings.
