import { test, expect } from 'playwright/test';
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fixture } from './fixture.mjs';

const enabled = process.env.PLAYWRIGHT_PRODUCTION === '1' && !!process.env.TOUR_PERF_OUTPUT;
const percentile = (values, p) => [...values].sort((a,b) => a-b)[Math.ceil(values.length*p)-1];

// Installed before the application: only timing/method/path, never API payloads.
async function instrument(page) {
  await page.addInitScript(() => {
    window.perfRequests = [];
    const original = window.fetch;
    window.fetch = async function(input, init) {
      const url = new URL(typeof input === 'string' ? input : input.url, location.href);
      const entry = { path: url.pathname, method: init?.method || input.method || 'GET', start: performance.now(), end: null };
      window.perfRequests.push(entry);
      try { return await original.apply(this, arguments); }
      finally { entry.end = performance.now(); }
    };
  });
}

async function measure(page, action) {
  const button = page.locator('.tour-region').getByRole('button', { name: action, exact: true });
  await expect(button).toBeEnabled();
  // Scroll/actionability happens BEFORE the captured trusted click and is excluded.
  await button.scrollIntoViewIfNeeded();
  await page.evaluate(() => {
    window.clickSample = null;
    const before = document.querySelector('.tour-region')?.getAttribute('data-step');
    document.addEventListener('click', function capture(event) {
      if (!event.isTrusted || !event.target.closest('.tour-region button')) return;
      document.removeEventListener('click', capture, true);
      const start = event.timeStamp;
      performance.mark('tour-click', { startTime: start });
      const watch = () => {
        const region = document.querySelector('.tour-region');
        const after = region?.getAttribute('data-step') ?? 'closed';
        if ((!region || after !== before) && (!region || region.getBoundingClientRect().height > 0)) {
          // Another rAF gives the changed DOM a paint opportunity; conservative
          // rendered-frame proxy, not compositor/presentation telemetry.
          requestAnimationFrame(() => {
            performance.mark('tour-rendered');
            const end = performance.now();
            performance.measure('tour-click-to-rendered', 'tour-click', 'tour-rendered');
            window.clickSample = { before, after, trusted: event.isTrusted, clickTime: start, renderedTime: end, latencyMs: end-start,
              criticalPathRequests: window.perfRequests.filter(r => r.start >= start && r.start <= end).map(r => ({...r, completedBeforeRender: r.end !== null && r.end <= end})) };
          });
        } else requestAnimationFrame(watch);
      };
      requestAnimationFrame(watch);
    }, true);
  });
  await button.click();
  await expect.poll(() => page.evaluate(() => window.clickSample), { timeout: 10_000 }).toBeTruthy();
  const sample = await page.evaluate(() => window.clickSample);
  expect(sample.trusted).toBe(true);
  // Prevent previous optimistic persistence from contaminating the next sample.
  await expect.poll(() => page.evaluate(() => window.perfRequests.filter(r => r.method === 'PATCH' && r.end === null).length)).toBe(0);
  return sample;
}

test('production trusted-click tour performance', async ({ browser }) => {
  test.skip(!enabled, 'Set PLAYWRIGHT_PRODUCTION=1 and TOUR_PERF_OUTPUT');
  test.setTimeout(240_000);
  const assets = (await readdir('dist/client', { recursive:true })).filter(p => /\.(js|css)$/.test(p)).sort();
  const fingerprint = createHash('sha256');
  for (const asset of assets) fingerprint.update(await readFile(`dist/client/${asset}`));
  const result = { createdAt: new Date().toISOString(), build: { profile: 'cloudflare', server: 'npm start -- --port 4175 --compatibility-date 2026-05-22 --var AUTH_MODE:sites (Wrangler --local; installed workerd date ceiling override; test-local page access with all browser APIs intercepted)', assetSha256: fingerprint.digest('hex'), assets },
    method: 'Trusted pointer click event.timeStamp → changed .tour-region data-step (or removed) → next requestAnimationFrame; performance.mark/measure. Excludes Playwright actionability/polling. Two-rAF conservative rendered-frame proxy, not physical presentation. APIs synthetic, assets real production build.', scenarios: [] };
  for (const mobile of [false, true]) for (const patchLatency of [0, 250]) {
    const viewport = mobile ? { width:390, height:844 } : { width:1280, height:800 };
    const context = await browser.newContext({ viewport, reducedMotion:'no-preference', isMobile: mobile, hasTouch: mobile });
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', {rate:mobile ? 4 : 1});
    await instrument(page);
    const f = await fixture(page, { populated:true, patchLatency });
    const servedAssets = await page.evaluate(() => performance.getEntriesByType('resource').map(e => new URL(e.name).pathname).filter(p => p.startsWith('/_next/static/')));
    expect(servedAssets.some(p => p.endsWith('.js'))).toBe(true);
    expect(await page.locator('script[src*="/@vite/client"]').count()).toBe(0);
    const samples = { Next:[], Skip:[], Back:[], Exit:[] };
    for (let round=0; round<Number(process.env.TOUR_PERF_SAMPLES || 12); round++) {
      f.state.currentStep = 'welcome.language';
      await page.locator('[data-tour="tour-launcher"]').click();
      await page.locator('.tour-region').getByRole('button', { name:'Resume', exact:true }).click();
      await expect(page.locator('.tour-region')).toHaveAttribute('data-step','welcome.language');
      await expect.poll(() => page.evaluate(() => window.perfRequests.filter(r => r.method === 'PATCH' && r.end === null).length)).toBe(0);
      samples.Next.push(await measure(page,'Next'));
      samples.Skip.push(await measure(page,'Skip this step'));
      samples.Back.push(await measure(page,'Back'));
      samples.Exit.push(await measure(page,'Exit tour'));
    }
    expect(f.errors).toEqual([]);
    const summary = Object.fromEntries(Object.entries(samples).map(([action, rows]) => [action, { n:rows.length, p50:percentile(rows.map(r=>r.latencyMs),.50), p95:percentile(rows.map(r=>r.latencyMs),.95), requests:rows.reduce((n,r)=>n+r.criticalPathRequests.length,0), completedBeforeRender:rows.reduce((n,r)=>n+r.criticalPathRequests.filter(q=>q.completedBeforeRender).length,0) }]));
    const scenario = { device:mobile?'mobile390x844-CDP4x':'desktop1280x800-unthrottled', viewport, cpuRate:mobile?4:1, latency:patchLatency?'SIMULATED 250ms onboarding PATCH delay':'native local route-fulfillment RTT; synthetic APIs, no injected delay', patchLatency, servedAssets, summary, samples };
    result.scenarios.push(scenario);
    console.log('TOUR_PRODUCTION_PERF',JSON.stringify({device:scenario.device,latency:scenario.latency,summary}));
    await context.close();
  }
  // Write evidence before enforcing the opt-in implementation acceptance gate.
  await writeFile(process.env.TOUR_PERF_OUTPUT,JSON.stringify(result,null,2)+'\n');
  if(process.env.TOUR_PERF_ASSERT !== '0') for(const scenario of result.scenarios.filter(s=>s.cpuRate===1)) {
    for(const metric of Object.values(scenario.summary)) expect(metric.p95).toBeLessThan(100);
  }
});
