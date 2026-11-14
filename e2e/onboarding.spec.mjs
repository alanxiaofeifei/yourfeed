import { test, expect } from 'playwright/test';
import { writeFile, mkdir } from 'node:fs/promises';

const steps = ['welcome.language','profile.interests','profile.save','sources.entry','sources.curated','feed.update','feed.read','feed.search','feed.shuffle','ai.purpose','ai.provider','ai.credentials','ai.test','ai.save','youtube.intro','youtube.cloud','youtube.save','youtube.channel','finish'];
async function fixture(page, { newAccount = false, populated = false, progressFailure = false, sessionDelay = 0, initialStatus = 'not_started', sessionFailures = 0, language = 'en', savedCerebras = false } = {}) {
  const state = { schemaVersion: 1, tourVersion: 1, revision: 0, status: initialStatus, currentStep: steps[0], skippedSteps: [], viewedSteps: [], updatedAt: new Date().toISOString() };
  const source = { id: 'synthetic-rss', name: 'Synthetic RSS', platform: 'rss', locator: 'https://example.com/feed.xml', topics: ['science'], enabled: true, status: 'ok', lastSuccess: new Date().toISOString() };
  const item = { id: 'synthetic-item', kind: 'article', platform: 'rss', sourceId: source.id, sourceName: source.name, title: 'Synthetic first article', url: 'https://example.com/article', summary: 'Synthetic excerpt', body: 'A synthetic reading fixture.', publishedAt: new Date().toISOString(), topics: ['science'] };
  const profile = { version: 1, preset: 'explorer', language: 'en', summaryLanguage: 'en', timezone: 'UTC', goals: ['Read science'], topicWeights: { science: 1 } };
  const evidence = { hasSavedProfile: false, profileReady: false, hasRssSource: populated, hasRssContent: populated, rssReady: populated, aiConfigured: false, aiEnabled: false, aiTested: false, aiVerification: 'not_recorded', youtubeConfigured: false, hasYoutubeSource: false, hasYoutubeContent: false, youtubeReady: false, sources: [] };
  const requests = [];
  const settingsReceipts = [];
  const providerTests = [];
  const session = { authenticated: true };
  const errors = [];
  page.on('pageerror', () => errors.push('pageerror'));
  await page.addInitScript(locale => localStorage.setItem('yourfeed-language', locale), language);
  await page.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.hostname !== '127.0.0.1') return route.abort();
    if (!url.pathname.startsWith('/api/')) return route.continue();
    const p = url.pathname;
    if (p === '/api/onboarding') {
      const body = request.method() === 'PATCH' ? request.postDataJSON() : null;
      requests.push(body);
      if (progressFailure) return route.fulfill({ status: 503, json: { error: 'Unavailable' } });
      if (body) {
        if (body.expectedRevision !== state.revision) return route.fulfill({ status: 409, json: { error: 'Conflict' } });
        const index = steps.indexOf(state.currentStep);
        if (body.action === 'skip') state.skippedSteps = [...new Set([...state.skippedSteps, state.currentStep])];
        if (body.action === 'next') state.viewedSteps = [...new Set([...state.viewedSteps, state.currentStep])];
        if (body.action === 'skip' || body.action === 'next') state.currentStep = steps[Math.min(index + 1, steps.length - 1)];
        if (body.action === 'back') state.currentStep = steps[Math.max(0, index - 1)];
        if (body.action === 'restart') state.currentStep = steps[0];
        if (body.action === 'resume' && body.step) state.currentStep = body.step;
        state.status = body.action === 'dismiss' ? 'dismissed' : body.action === 'finish' ? 'completed' : 'in_progress';
        state.firstOfferedAt ||= new Date().toISOString(); state.revision++;
      }
      return route.fulfill({ json: { state, evidence, autoOffer: newAccount && !state.firstOfferedAt, storage: state.revision ? 'saved' : 'new' } });
    }
    let data = {};
    if (p === '/api/session') {
      if(sessionFailures-->0)return route.fulfill({status:503,json:{error:'Synthetic temporary failure'}});
      // Model a remote session read finishing after the launcher first renders.
      if (sessionDelay) await new Promise(resolve => setTimeout(resolve, sessionDelay));
      data = { authenticated: session.authenticated, user: { id: 'synthetic-reader', name: 'Synthetic reader' }, authMode: 'standalone', recentAuth: true };
    }
    else if (p === '/api/profile') {
      if (request.method() === 'PUT') return route.fulfill({ status: 500, json: { error: 'Synthetic save failure' } });
      data = profile;
    } else if (p === '/api/test-provider') {
      providerTests.push(request.postDataJSON().provider);
      data = { message: 'Synthetic connection succeeded', testReceipt: 'synthetic-opaque-receipt' };
    }
    else if (p === '/api/settings' && request.method() === 'PUT') {
      settingsReceipts.push(request.postDataJSON().testReceipt ?? null);
      return route.fulfill({ status: 500, json: { error: 'Synthetic save failure' } });
    }
    else if (p === '/api/settings') data = { provider: 'openai', model: 'gpt-6.1-sol', enabled: false, monthlyBudget: 20, dailyLimit: 20, configured: false, youtubeConfigured: false, providers: [], ...(savedCerebras ? { provider: 'cerebras', model: 'gpt-oss-120b', baseUrl: 'https://api.cerebras.ai/v1', configured: true, providers: [{ provider: 'cerebras', configured: true, keyLast4: 'DEMO' }] } : {}) };
    else if (p === '/api/usage') data = { month: '2026-11', cost: 0, inputTokens: 0, outputTokens: 0, analyzedToday: 0 };
    else if (p === '/api/sources') data = { sources: populated ? [source] : [] };
    else if (p === '/api/sources/recommendations') data = { recommendations: [{ ...source, starter: true, language: 'en', contentType: 'article', description: { en: 'Synthetic catalog feed', zh: '合成目录来源' }, verification: { status: 'unverified', coverage: 'unknown' } }] };
    else if (p === '/api/briefing') data = { date: '2026-11-12', timeZone: 'UTC', window: 'empty', items: [] };
    else if (p === '/api/storage') data = { enabled: false, expiringCount: 0, expiredCount: 0 };
    else if (p === '/api/sync') data = { processed: 0, pending: 0, results: [] };
    else if (['/api/feed', '/api/feed/batch', '/api/library'].includes(p)) data = { items: populated ? [item] : [], total: populated ? 1 : 0, sources: populated ? 1 : 0, nextCursor: null, lastUpdated: new Date().toISOString() };
    else if (p === '/api/maintenance') data = { ok: true };
    else if (p === '/api/auth/config') data = {};
    else return route.fulfill({ status: 501, json: { error: 'Unsupported synthetic endpoint' } });
    return route.fulfill({ json: data });
  });
  await page.goto('/');
  await expect(page.locator('[data-tour="tour-launcher"]')).toBeVisible();
  return { state, evidence, requests, settingsReceipts, providerTests, errors, session };
}

for (const width of [320, 360, 390, 430, 1440]) {
  test(`existing populated account has manual, non-obstructive tour at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const f = await fixture(page, { populated: true });
    await expect(page.locator('.tour-region')).toHaveCount(0);
    await page.locator('[data-tour="tour-launcher"]').click();
    await page.locator('.tour-region').getByRole('button', { name: 'Resume', exact: true }).click();
    await expect(page.locator('.tour-progress')).toContainText('1');
    await expect(page.locator('.tour-region').getByRole('button', { name: 'Back', exact: true })).toBeDisabled();
    for (const lang of ['zh', 'zh-TW', 'vi', 'en']) {
      await page.locator('[data-tour="language"] select').selectOption(lang);
      await expect(page.locator('.tour-region h2')).not.toBeEmpty();
      expect(f.state.currentStep).toBe('welcome.language');
    }
    const chapters = page.locator('.tour-chapters select');
    await chapters.selectOption('sources');
    await page.locator('.tour-region').getByRole('button', { name: 'Next', exact: true }).click();
    await page.locator('.tour-region').getByRole('button', { name: 'Go to this control', exact: true }).click();
    await expect(page.locator('[data-tour="curated-list"]')).toBeVisible();
    await expect(page.locator('[role="dialog"] .tour-region')).toHaveCount(1);
    for(let tab=0;tab<4;tab++) {
      await page.keyboard.press('Tab');
      expect(await page.evaluate(()=>!!document.activeElement?.closest('[role="dialog"]'))).toBe(true);
    }
    const overlap = await page.evaluate(() => {
      const a = document.querySelector('.tour-region')?.getBoundingClientRect();
      const b = document.querySelector('[data-tour="source-confirm"]')?.getBoundingClientRect();
      return a && b && a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
    });
    expect(overlap).toBeFalsy();
    await page.keyboard.press('Escape');
    await expect(page.locator('.tour-progress')).toHaveCount(0);
    expect(f.errors).toEqual([]);
    expect(f.requests.filter(Boolean).every(body => Object.keys(body).every(key => ['action', 'step', 'expectedRevision'].includes(key)))).toBe(true);
  });
}

test('new-account invitation is dismissible and does not return after reload', async ({ page }) => {
  const f = await fixture(page, { newAccount: true });
  await expect(page.locator('.tour-region')).toBeVisible();
  await page.locator('.tour-region').getByRole('button', { name: 'Explore first', exact: true }).click();
  await expect(page.locator('.tour-region')).toHaveCount(0);
  await page.reload();
  await expect(page.locator('[data-tour="tour-launcher"]')).toBeVisible();
  await expect(page.locator('.tour-region')).toHaveCount(0);
  expect(f.state.status).toBe('dismissed');
});

for (const width of [390, 1440]) {
  test(`dismissed tour resumes at the saved step from home at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const f = await fixture(page, { newAccount: true, sessionDelay: 500 });
    const tour = page.locator('.tour-region');
    const action = name => tour.getByRole('button', { name, exact: true });
    await action('Start setup').click();
    await action('Next').click();
    await expect.poll(() => f.state.currentStep).toBe('profile.interests');
    await action('Exit tour').click();
    await expect(tour).toHaveCount(0);
    await expect.poll(() => f.state.status).toBe('dismissed');
    await page.reload();
    await expect(page.locator('[data-tour="tour-launcher"]')).toBeVisible();
    await expect(tour).toHaveCount(0);
    await page.locator('[data-tour="tour-launcher"]').click();
    await action('Resume').click();
    await expect(tour.locator('h2')).toHaveText('Tell YourFeed what you want to read');
    expect(f.state.currentStep).toBe('profile.interests');
    expect(f.state.status).toBe('in_progress');
    expect(f.errors).toEqual([]);
  });
}

test('progress API failure leaves ordinary cached reading available', async ({ page }) => {
  await fixture(page, { populated: true, progressFailure: true });
  await page.locator('[data-tour="tour-launcher"]').click();
  await expect(page.locator('.tour-region [role="status"]').first()).toBeVisible();
  await page.getByText('Synthetic first article', { exact: true }).last().click();
  await expect(page.locator('[role="dialog"]')).toBeVisible();
});

test('skipping every step completes without configuring optional services; restart preserves skips', async ({ page }) => {
  const f = await fixture(page);
  await page.locator('[data-tour="tour-launcher"]').click();
  await page.locator('.tour-region').getByRole('button', { name: 'Resume', exact: true }).click();
  for (let i = 0; i < steps.length - 1; i++) {
    await page.locator('.tour-region').getByRole('button', { name: 'Skip this step', exact: true }).click();
    await expect.poll(() => f.state.currentStep).toBe(steps[i + 1]);
  }
  await page.locator('.tour-region').getByRole('button', { name: 'Finish tour', exact: true }).click();
  expect(f.state.status).toBe('completed');
  expect(f.evidence.aiConfigured).toBe(false); expect(f.evidence.youtubeConfigured).toBe(false);
  await page.locator('[data-tour="tour-launcher"]').click();
  await page.locator('.tour-region').getByRole('button', { name: 'Review from the start', exact: true }).click();
  expect(f.state.currentStep).toBe(steps[0]); expect(f.state.skippedSteps).toHaveLength(18);
  expect(f.errors).toEqual([]);
});


test('AI draft survives tour navigation cancellation and failed save; test invalidates on edits', async ({ page }) => {
  const f = await fixture(page);
  await page.locator('[data-tour="tour-launcher"]').click();
  await page.locator('.tour-region').getByRole('button', { name: 'Resume', exact: true }).click();
  await page.locator('.tour-chapters select').selectOption('ai');
  await page.locator('.tour-region').getByRole('button', { name: 'Go to this control', exact: true }).click();
  const key = page.locator('#ai-key');
  await key.fill('SYNTHETIC_SENTINEL_NOT_A_KEY');
  await page.locator('[data-tour="ai-test"] button').click();
  await expect(page.locator('.test-result')).toContainText('Connection successful');
  await page.locator('#ai-model').fill('synthetic-model');
  await expect(page.locator('.test-result')).toHaveCount(0);
  await page.locator('[data-tour="ai-save"] button').click();
  await expect.poll(() => f.settingsReceipts.at(-1)).toBe(null);
  await expect(key).toHaveValue('SYNTHETIC_SENTINEL_NOT_A_KEY');
  await page.locator('[data-tour="ai-test"] button').click();
  await expect(page.locator('.test-result')).toContainText('Connection successful');
  await page.locator('[data-tour="ai-save"] button').click();
  await expect.poll(() => f.settingsReceipts.at(-1)).toBe('synthetic-opaque-receipt');
  await expect(key).toHaveValue('SYNTHETIC_SENTINEL_NOT_A_KEY');
  await page.locator('.tour-chapters select').selectOption('profile');
  page.once('dialog', dialog => dialog.dismiss());
  await page.locator('.tour-region').getByRole('button', { name: 'Go to this control', exact: true }).click();
  await expect(key).toHaveValue('SYNTHETIC_SENTINEL_NOT_A_KEY');
  expect(JSON.stringify(f.requests)).not.toContain('SYNTHETIC_SENTINEL');
  const stored = await page.evaluate(() => JSON.stringify({ ...localStorage }));
  expect(stored).not.toContain('SYNTHETIC_SENTINEL');
  expect(f.errors).toEqual([]);
});


test('a cross-tab dismissal clears an already visible welcome on focus', async ({ page }) => {
  const f = await fixture(page, { newAccount: true });
  await expect(page.locator('.tour-region').getByRole('button', { name: 'Start setup', exact: true })).toBeVisible();
  // Simulate another tab's already committed account-scoped state.
  f.state.status = 'dismissed'; f.state.revision++; f.state.firstOfferedAt = new Date().toISOString();
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.locator('.tour-region')).toHaveCount(0);
  expect(f.errors).toEqual([]);
});

// Run identically before/after; counts are synthetic development React commits, not production timings.
test('tour performance benchmark', async ({ page }) => {
  await fixture(page, { populated: true });
  await page.locator('[data-tour="tour-launcher"]').click();
  await page.locator('.tour-region').getByRole('button', { name: 'Resume', exact: true }).click();
  await page.locator('.tour-progress').waitFor();
  await page.evaluate(() => {
    window.tourMetrics.commits = 0; window.tourMetrics.renderMs = 0;
    window.geometryReads = 0; window.longTasks = 0;
    const original = Element.prototype.getBoundingClientRect;
    Element.prototype.getBoundingClientRect = function() { window.geometryReads++; return original.call(this); };
    new PerformanceObserver(list => { window.longTasks += list.getEntries().length; }).observe({type:'longtask', buffered:false});
  });
  let gets = 0, patches = 0;
  page.on('request', request => { if(new URL(request.url()).pathname === '/api/onboarding') request.method()==='GET' ? gets++ : patches++; });
  const latencies=[];
  for(let i=1;i<=5;i++) {
    const start=await page.evaluate(()=>performance.now());
    await page.locator('.tour-region').getByRole('button', { name:'Next', exact:true }).click();
    await expect(page.locator('.tour-progress')).toContainText(`${i+1} of`);
    latencies.push(await page.evaluate(()=>performance.now())-start);
  }
  // A single event-loop turn with a burst of layout events exposes unbatched handlers.
  const beforeBurst=await page.evaluate(()=>window.geometryReads);
  await page.evaluate(()=>{for(let i=0;i<30;i++)window.dispatchEvent(new Event('resize'));});
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  const result=await page.evaluate(()=>({...window.tourMetrics,geometryReads:window.geometryReads,longTasks:window.longTasks}));
  Object.assign(result,{burstGeometryReads:result.geometryReads-beforeBurst,gets,patches,latencies,meanLatencyMs:latencies.reduce((a,b)=>a+b)/latencies.length});
  console.log('TOUR_BENCHMARK',JSON.stringify(result));
  if(process.env.TOUR_PERF_OUTPUT) await writeFile(process.env.TOUR_PERF_OUTPUT,JSON.stringify(result,null,2));
  expect(gets).toBe(0); expect(patches).toBe(5);
});

for (const width of [1280,390]) {
 test(`permanent launcher across account states and second login ${width}`,async({page})=>{
  await page.setViewportSize({width,height:width===390?844:800});
  const f=await fixture(page,{populated:true});
  for(const status of ['not_started','in_progress','dismissed','completed']) {
   f.state.status=status;
   // Simulate a signed-out document, then a second successful synthetic sign-in.
   f.session.authenticated=false;await page.reload();
   await expect(page.locator('.account-signin')).toBeVisible();
   f.session.authenticated=true;await page.goto('/');
   const launch=page.locator('[data-tour="tour-launcher"]');
   await expect(launch).toBeVisible();await expect(launch).toBeEnabled();
   await launch.click();
   await expect(page.locator('.tour-region')).toBeVisible();
  }
 });
 for(const reduced of [false,true]) {
  test(`spotlight editorial motion and mobile controls ${width} reduced=${reduced}`,async({page})=>{
   await page.setViewportSize({width,height:width===390?844:800});
   await page.emulateMedia({reducedMotion:reduced?'reduce':'no-preference'});
   await fixture(page,{populated:true});
   const shots='/workspace/yourfeed-onboarding-20261112/feedback-shots';
   await mkdir(shots,{recursive:true});
   if(width===1280&&!reduced){
    await page.evaluate(()=>Promise.allSettled(document.getAnimations().filter(animation=>animation.effect?.getComputedTiming().iterations!==Infinity).map(animation=>animation.finished)));
    await page.screenshot({path:`${shots}/desktop-home-button-en.png`});
   }
   await page.locator('[data-tour="tour-launcher"]').click();
   await page.locator('.tour-region').getByRole('button',{name:'Resume',exact:true}).click();
   const ring=page.locator('.tour-spotlight');
   await expect(ring).toBeVisible();await expect(ring).toHaveAttribute('data-spotlight','language');
   for(const locale of ['zh-TW','vi','en','zh']) {
    await page.locator('[data-tour="language"] select').selectOption(locale);
    await expect(page.locator('.tour-region h2')).not.toBeEmpty();
    await expect(page.locator('.tour-progress')).not.toBeEmpty();
   }
   await expect(page.locator('.tour-region h2')).toHaveText('先选你熟悉的语言');
   expect(await ring.evaluate(el=>getComputedStyle(el).pointerEvents)).toBe('none');
   if(reduced){
    expect(await ring.evaluate(el=>getComputedStyle(el).animationName)).toBe('none');
    expect(await ring.evaluate(el=>getComputedStyle(el).transform)).toBe('none');
   }
   await page.screenshot({path:`${shots}/${reduced?'reduced-motion':width===390?'mobile-spotlight-zh-CN':'desktop-spotlight-zh-CN'}.png`});
   await page.locator('.tour-chapters select').selectOption('feed');
   await expect(ring).toHaveAttribute('data-spotlight','feed-update');
   await expect(ring).toBeVisible();
   await expect.poll(()=>page.evaluate(()=>{
    const a=document.querySelector('.tour-spotlight').getBoundingClientRect();
    const b=document.querySelector('[data-tour="feed-update"]').getBoundingClientRect();
    return Math.abs(a.top-(b.top-5))<2&&Math.abs(a.left-(b.left-5))<2;
   })).toBe(true);
   await page.locator('[data-tour="feed-update"]').click({trial:true});
   const overlap=await page.evaluate(()=>{
    const a=document.querySelector('.tour-region').getBoundingClientRect();
    const b=document.querySelector('[data-tour="feed-update"]').getBoundingClientRect();
    return a.left<b.right&&a.right>b.left&&a.top<b.bottom&&a.bottom>b.top;
   });
   expect(overlap).toBe(false);
   // Pointer-transparent dimming must leave the highlighted business control enabled.
   await expect(page.locator('[data-tour="feed-update"]')).toBeEnabled();
   await page.keyboard.press('Escape');
   await expect(page.locator('.tour-region')).toHaveCount(0);
   await expect(page.locator('[data-tour="tour-launcher"]')).toBeFocused();
  });
 }
}

test('one account entry and translated noninteractive privacy note',async({page})=>{
 await page.setViewportSize({width:390,height:844});
 await fixture(page,{populated:true});
 const shots='/workspace/yourfeed-onboarding-20261112/feedback-shots';await mkdir(shots,{recursive:true});
 for(const language of ['en','zh-TW','vi','zh']) {
  await page.locator('[data-tour="language"] select').selectOption(language);
  await expect(page.locator('.account-trigger')).toHaveCount(1);
  const note=page.getByTestId('sidebar-privacy-note');
  await expect(note.locator('button,a,[tabindex]')).toHaveCount(0);
  expect(await note.innerText()).not.toContain(language==='en'?'账户与登录管理':'Manage your account');
  await page.locator('.account-trigger').click();
  await expect(page.locator('[role="menu"]')).toBeVisible();
  if(language==='zh')await page.screenshot({path:`${shots}/mobile-account-menu-zh-CN.png`});
  await page.keyboard.press('Escape');
  await expect(page.locator('.account-trigger')).toBeFocused();
 }
});

test('account retry repairs launcher after a transient second-login session failure',async({page})=>{
 await fixture(page,{populated:true,sessionFailures:1});
 const launch=page.locator('[data-tour="tour-launcher"]');
 await expect(launch).toBeVisible();await expect(launch).toBeDisabled();
 await page.locator('.account-trigger').click();
 await page.getByRole('menuitem',{name:'Check session again',exact:true}).click();
 await expect(launch).toBeEnabled();await launch.click();
 await expect(page.locator('.tour-region')).toBeVisible();
});

test('manual source spotlight outlines the real form inside its focus scope',async({page})=>{
 await page.setViewportSize({width:390,height:844});
 await fixture(page,{populated:true});
 await page.locator('[data-tour="tour-launcher"]').click();
 const region=page.locator('.tour-region');
 await region.getByRole('button',{name:'Resume',exact:true}).click();
 await page.locator('.tour-chapters select').selectOption('youtube');
 for(let i=0;i<3;i++)await region.getByRole('button',{name:'Next',exact:true}).click();
 await region.getByRole('button',{name:'Go to this control',exact:true}).click();
 await expect(page.locator('[role="dialog"] .tour-region')).toBeVisible();
 await expect(page.locator('.tour-spotlight[data-spotlight="source-add"]')).toBeVisible();
 await expect(page.locator('[role="dialog"] form[data-tour="source-add"]')).toBeVisible();
 expect(await page.evaluate(()=>{
  const a=document.querySelector('.tour-region').getBoundingClientRect();
  const b=document.querySelector('[role="dialog"] [data-tour="source-add"]').getBoundingClientRect();
  return a.top<b.bottom&&a.bottom>b.top;
 })).toBe(false);
});


for (const language of ['zh', 'en', 'zh-TW', 'vi']) {
  test(`onboarding omits Cerebras while saved preset remains usable in ${language}`, async ({ page }) => {
    const f = await fixture(page, { language, savedCerebras: true });
    await page.locator('[data-tour="tour-launcher"]').click();
    // Start at the AI chapter without relying on translated action labels.
    await page.locator('.tour-chapters select').selectOption('ai');
    await page.locator('.tour-help summary').click();
    await expect(page.locator('.tour-help section')).toHaveCount(7);
    await expect(page.locator('.tour-region')).not.toContainText(/cerebras/i);
    await expect(page.locator('.tour-help a[href*="cerebras"]')).toHaveCount(0);
    await expect(page.locator('.tour-help')).toContainText('Google AI Studio');
    await expect(page.locator('.tour-help')).toContainText('Groq');
    await expect(page.locator('.tour-help')).toContainText('NVIDIA');
    // ai.purpose -> ai.provider, then open the real settings panel.
    await page.locator('.tour-actions button').nth(4).click();
    await page.locator('.tour-actions button').first().click();
    await expect(page.locator('.ai-provider-tabs button.selected')).toHaveText('Cerebras');
    await expect(page.locator('#ai-model')).toHaveValue('gpt-oss-120b');
    await expect(page.locator('.fixed-endpoint')).toContainText('https://api.cerebras.ai/v1');
    await expect(page.locator('.provider-free-tier-note')).toHaveCount(0);
    await expect(page.locator('#ai-key')).toHaveValue('');
    await page.locator('[data-tour="ai-test"] button').click();
    await expect(page.locator('.test-result')).toBeVisible();
    expect(f.providerTests).toEqual(['cerebras']);
    expect(f.errors).toEqual([]);
  });
}
