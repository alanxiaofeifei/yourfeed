import { expect } from 'playwright/test';

export const steps = ['welcome.language','profile.interests','profile.save','sources.entry','sources.curated','feed.update','feed.read','feed.search','feed.shuffle','ai.purpose','ai.provider','ai.credentials','ai.test','ai.save','youtube.intro','youtube.cloud','youtube.save','youtube.channel','finish'];
export async function fixture(page, { newAccount = false, populated = false, progressFailure = false, sessionDelay = 0, initialStatus = 'not_started', sessionFailures = 0, language = 'en', savedCerebras = false, patchLatency = 0 } = {}) {
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
        // Deliberate diagnostic simulation, not a claim about real network RTT.
        if (patchLatency) await new Promise(resolve => setTimeout(resolve, patchLatency));
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
