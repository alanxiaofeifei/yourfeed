import { test, expect } from 'playwright/test';

const steps = ['welcome.language','profile.interests','profile.save','sources.entry','sources.curated','feed.update','feed.read','feed.search','feed.shuffle','ai.purpose','ai.provider','ai.credentials','ai.test','ai.save','youtube.intro','youtube.cloud','youtube.save','youtube.channel','finish'];
async function fixture(page, { newAccount = false, populated = false, progressFailure = false } = {}) {
  const state = { schemaVersion: 1, tourVersion: 1, revision: 0, status: 'not_started', currentStep: steps[0], skippedSteps: [], viewedSteps: [], updatedAt: new Date().toISOString() };
  const source = { id: 'synthetic-rss', name: 'Synthetic RSS', platform: 'rss', locator: 'https://example.com/feed.xml', topics: ['science'], enabled: true, status: 'ok', lastSuccess: new Date().toISOString() };
  const item = { id: 'synthetic-item', kind: 'article', platform: 'rss', sourceId: source.id, sourceName: source.name, title: 'Synthetic first article', url: 'https://example.com/article', summary: 'Synthetic excerpt', body: 'A synthetic reading fixture.', publishedAt: new Date().toISOString(), topics: ['science'] };
  const profile = { version: 1, preset: 'explorer', language: 'en', summaryLanguage: 'en', timezone: 'UTC', goals: ['Read science'], topicWeights: { science: 1 } };
  const evidence = { hasSavedProfile: false, profileReady: false, hasRssSource: populated, hasRssContent: populated, rssReady: populated, aiConfigured: false, aiEnabled: false, aiTested: false, aiVerification: 'not_recorded', youtubeConfigured: false, hasYoutubeSource: false, hasYoutubeContent: false, youtubeReady: false, sources: [] };
  const requests = [];
  const errors = [];
  page.on('pageerror', () => errors.push('pageerror'));
  await page.addInitScript(() => localStorage.setItem('yourfeed-language', 'en'));
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
    if (p === '/api/session') data = { authenticated: true, user: { id: 'synthetic-reader', name: 'Synthetic reader' }, authMode: 'standalone', recentAuth: true };
    else if (p === '/api/profile') {
      if (request.method() === 'PUT') return route.fulfill({ status: 500, json: { error: 'Synthetic save failure' } });
      data = profile;
    } else if (p === '/api/test-provider') data = { message: 'Synthetic connection succeeded' };
    else if (p === '/api/settings' && request.method() === 'PUT') return route.fulfill({ status: 500, json: { error: 'Synthetic save failure' } });
    else if (p === '/api/settings') data = { provider: 'openai', model: 'gpt-6.1-sol', enabled: false, monthlyBudget: 20, dailyLimit: 20, configured: false, youtubeConfigured: false, providers: [] };
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
  return { state, evidence, requests, errors };
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
  await page.locator('[data-tour="ai-save"]').last().click();
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
