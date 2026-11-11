import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Miniflare } from 'miniflare';
import { readFileSync, readdirSync } from 'node:fs';
import { handleApi } from '../server/api';
import { getProviderKey, getUsage, reserveUsage, usagePeriod, upsertContent, updateSource, type Env } from '../server/db';
import { sourceGroup } from '../server/ranking';

let mf: Miniflare;
let env: Env;
const tables = ['analysis_cache', 'content', 'feedback', 'meta', 'reservations', 'settings', 'sources'];
function request(path: string, method = 'GET', body?: unknown, user = 'integration-owner', origin = 'https://yourfeed.test') {
  const headers: Record<string, string> = {};
  if (user) headers['oai-authenticated-user-id'] = user;
  if (body !== undefined) { headers['content-type'] = 'application/json'; headers.origin = origin; }
  return new Request(`https://yourfeed.test${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
}
async function api(path: string, method = 'GET', body?: unknown, user = 'integration-owner') {
  const response = await handleApi(request(path, method, body, user), env);
  return { status: response.status, value: await response.json() as any };
}

beforeAll(async () => {
  mf = new Miniflare({ modules: true, script: 'export default {fetch(){return new Response("test runtime")}}', d1Databases: { DB: 'yourfeed-integration-db' }, compatibilityDate: '2026-05-15' });
  const db = await mf.getD1Database('DB');
  env = { AUTH_MODE:'sites', DB: db as unknown as Env['DB'], APP_ENCRYPTION_KEY: 'a'.repeat(64) };
  for (const filename of readdirSync('drizzle').filter(x => x.endsWith('.sql')).sort()) {
    const migration = readFileSync(`drizzle/${filename}`, 'utf8');
    for (const statement of migration.split('--> statement-breakpoint').map(x => x.trim()).filter(Boolean)) await db.exec(statement.replace(/\r?\n/g, ' '));
  }
}, 60_000);
beforeEach(async () => {
 await env.DB.batch(tables.map(name => env.DB.prepare(`DELETE FROM ${name}`)));
 // Explicit generic fixtures; new installations themselves start empty.
 for(let i=0;i<30;i++)await updateSource(env,{id:i===0?'github-stars':'source-'+i,name:'Example source '+i,platform:i===0?'github':'rss',locator:i===0?'sampleuser':'https://example.org/feed/'+i,topics:['tools','making'],enabled:true});
 await upsertContent(env,Array.from({length:60},(_,i)=>({id:'example-'+i,kind:i<2?'project' as const:'video' as const,platform:i<2?'GitHub':'YouTube',sourceId:i<2?'github-stars':'source-'+Math.floor(i/2),sourceName:'Example source',title:'Example content '+i,url:'https://example.org/content/'+i,summary:'Generic test fixture',topics:['tools','making'],publishedAt:'2026-11-01T12:00:00Z'})));
});
afterAll(async () => { await mf?.dispose(); });

describe('migrated D1 API integration', () => {
  it('keeps storage changes explicit, remembers the background owner, and exports no credentials',async()=>{
    expect((await api('/api/storage','PUT',{})).status).toBe(400);
    expect((await api('/api/background')).value).toMatchObject({enabled:false,aiEnabled:false,schedulerConfigured:false});
    expect((await api('/api/background','PUT',{enabled:false,aiEnabled:true})).status).toBe(200);
    expect(await env.DB.prepare('SELECT value FROM meta WHERE key=?').bind('background:owner').first('value')).toBe('integration-owner');
    await api('/api/feedback','POST',{id:'example-0',patch:{liked:true,saved:true}});
    await api('/api/settings','PUT',{provider:'openai',model:'gpt-6.1-sol',key:'not-real-secret-for-archive',enabled:false});
    const archive=await api('/api/export?filter=liked');expect(archive.status).toBe(200);expect(archive.value.items).toHaveLength(1);expect(archive.value.feedback).toMatchObject({'example-0':{liked:true,saved:true}});expect(JSON.stringify(archive.value)).not.toContain('not-real-secret-for-archive');
    for(const path of ['/api/library','/api/export','/api/storage','/api/background'])expect((await api(path,'GET',undefined,'')).status).toBe(401);
  });
  it('reports the actual migrated schema and missing storage correctly', async () => {
    const healthy = await api('/api/health');
    expect(healthy.status).toBe(200);
    expect(healthy.value).toMatchObject({ ok: true, storage: true, schemaReady: true });
    const absent = await handleApi(request('/api/health'), {} as Env);
    expect(absent.status).toBe(503);
    expect(await absent.json()).toMatchObject({ storage: false, schemaReady: false });
  });

  it('rejects unauthenticated data reads and cross-origin writes', async () => {
    expect((await api('/api/feed', 'GET', undefined, '')).status).toBe(401);
    const forbidden = await handleApi(request('/api/settings', 'PUT', { enabled: true }, 'integration-owner', 'https://untrusted.test'), env);
    expect(forbidden.status).toBe(403);
    expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM settings').first('n')).toBe(0);
  });

  it('initializes without importing personal content and paginates without duplicates or source flooding', async () => {
    const first = await api('/api/feed?mode=rest');
    expect(first.status).toBe(200);
    expect(first.value.items.length).toBe(20);
    expect(first.value.total).toBeGreaterThan(20);
    const groups = new Map<string, number>();
    for (const item of first.value.items) groups.set(sourceGroup(item), (groups.get(sourceGroup(item)) || 0) + 1);
    expect(Math.max(...groups.values())).toBeLessThanOrEqual(2);
    const count = await env.DB.prepare('SELECT COUNT(*) AS n FROM content').first('n');
    const next = await api(`/api/feed?mode=rest&cursor=${first.value.nextCursor}`);
    expect(next.status).toBe(200);
    const ids = new Set(first.value.items.map((x: any) => x.id));
    expect(next.value.items.every((x: any) => !ids.has(x.id))).toBe(true);
    expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM content').first('n')).toBe(count);
  });

  it('starts a fresh deployment with an empty content library',async()=>{await env.DB.batch(tables.map(name=>env.DB.prepare(`DELETE FROM ${name}`)));const first=await api('/api/feed');expect(first.status).toBe(200);expect(first.value.items).toEqual([]);expect(first.value.total).toBe(0);});

  it('persists feedback across API calls and isolates it by authenticated user', async () => {
    const first = await api('/api/feed');
    const id = first.value.items[0].id;
    expect((await api('/api/feedback', 'POST', { id, patch: { saved: true, liked: true } })).status).toBe(200);
    const saved = await api('/api/feed?filter=saved');
    expect(saved.value.items.find((x: any) => x.id === id)).toMatchObject({ saved: true, liked: true });
    const other = await api('/api/feed?filter=saved', 'GET', undefined, 'another-user');
    expect(other.value.items).toEqual([]);
    await api('/api/feedback', 'POST', { id, patch: { read: true } });
    expect((await api('/api/feed')).value.items.some((x: any) => x.id === id)).toBe(false);
    expect((await api('/api/feed?filter=read')).value.items.some((x: any) => x.id === id)).toBe(true);
  });

  it('stores credential ciphertext and exposes only safe configuration metadata', async () => {
    const fakeSecret = 'integration-test-credential-ABC12345';
    const put = await api('/api/settings', 'PUT', { provider: 'openai', model: 'gpt-6.1-sol', key: fakeSecret, enabled: false });
    expect(put.status).toBe(200);
    expect(put.value).toMatchObject({ configured: true, keyLast4: '2345' });
    expect(JSON.stringify(put.value)).not.toContain(fakeSecret);
    const stored = await env.DB.prepare('SELECT json FROM settings WHERE id=?').bind('key:openai').first<string>('json');
    expect(stored).toContain('cipher');
    expect(stored).not.toContain(fakeSecret);
    expect(await getProviderKey(env, 'openai')).toBe(fakeSecret);
    const fetched = await api('/api/settings');
    expect(JSON.stringify(fetched.value)).not.toContain(fakeSecret);
    expect(JSON.stringify(fetched.value)).not.toContain('cipher');
    await api('/api/settings', 'PUT', { provider: 'deepseek' });
    expect((await api('/api/settings')).value).toMatchObject({ provider: 'deepseek', model: 'deepseek-flash', configured: false });
  });

  it('disables the GitHub source for existing content as well as future sync', async () => {
    const original = await api('/api/feed?type=project');
    expect(original.value.total).toBeGreaterThan(0);
    const changed = await api('/api/sources', 'PATCH', { id: 'github-stars', enabled: false });
    expect(changed.status).toBe(200);
    expect((await api('/api/feed?type=project')).value.items).toEqual([]);
    await api('/api/sources', 'PATCH', { id: 'github-stars', enabled: true });
    expect((await api('/api/feed?type=project')).value.total).toBe(original.value.total);
  });

  it('atomically reserves monthly budget under concurrent requests', async () => {
    const { day, month } = usagePeriod();
    const attempts = await Promise.all([0, 1, 2, 3].map(i => reserveUsage(env, { reservationId: `monthly-${i}`, day, month, contentId: `monthly-item-${i}`, maxCost: 2, dailyLimit: 20, monthlyBudget: 5 })));
    expect(attempts.filter(Boolean)).toHaveLength(2);
    const usage = await getUsage(env);
    expect(usage.reserved).toBe(4);
    expect(usage.analyzedToday).toBe(2);
    expect(usage.cost).toBe(0);
  });

  it('atomically enforces the daily analysis limit separately from money limits', async () => {
    const { day, month } = usagePeriod();
    const attempts = await Promise.all([0, 1, 2].map(i => reserveUsage(env, { reservationId: `daily-${i}`, day, month, contentId: `daily-item-${i}`, maxCost: 0.01, dailyLimit: 1, monthlyBudget: 20 })));
    expect(attempts.filter(Boolean)).toHaveLength(1);
    expect((await getUsage(env)).analyzedToday).toBe(1);
  });
});
