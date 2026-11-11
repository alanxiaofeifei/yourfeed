import {beforeAll,beforeEach,afterAll,describe,it,expect} from 'vitest';
import {Miniflare} from 'miniflare';
import type {D1Database} from '@cloudflare/workers-types';
// @ts-expect-error Standalone offline operator script deliberately has no application dependency.
import {prepareInstance} from '../scripts/prepare-instance.mjs';
const tables=['content','sources','settings','feedback','reservations','analysis_cache','content_sources','content_aliases','content_search','auth_user','auth_session','auth_account','auth_verification','auth_rate'];
const manifest={instanceId:'yf-marker-test',workerName:'yf-marker-test',databaseName:'yf-marker-test',databaseId:'11111111-1111-4111-8111-111111111111',origin:'https://marker.example',controlWorker:'yourfeed-control'};
let mf:Miniflare,db:D1Database;
beforeAll(async()=>{
 mf=new Miniflare({modules:true,script:'export default {fetch(){return new Response("fixture")}}',d1Databases:{DB:'instance-marker-test'},compatibilityDate:'2026-05-15'});db=await mf.getD1Database('DB') as unknown as D1Database;
 await db.exec('CREATE TABLE meta(key TEXT PRIMARY KEY NOT NULL,value TEXT NOT NULL)');for(const table of tables)await db.exec(`CREATE TABLE ${table}(id TEXT PRIMARY KEY NOT NULL)`);
},60_000);
beforeEach(async()=>{await db.batch([...tables,'meta'].map(t=>db.prepare('DELETE FROM '+t)));});
afterAll(async()=>{await mf?.dispose();});
const mark=async()=>db.prepare(prepareInstance(manifest).marker.replace(/^--.*$/gm,'').trim()).run();
describe('empty database-only instance identity claim',()=>{
 it('claims a fully migrated empty database once without overwriting its identity',async()=>{
  await db.prepare('INSERT INTO meta(key,value) VALUES (?,?)').bind('seeded-v1','fixture-only').run();
  await mark();expect(await db.prepare("SELECT value FROM meta WHERE key='hosted:instance'").first()).toEqual({value:manifest.instanceId});
  await mark();expect((await db.prepare('SELECT COUNT(*) n FROM meta').first<{n:number}>())?.n).toBe(2);
  const another=prepareInstance({...manifest,instanceId:'yf-other-tenant'}).marker.replace(/^--.*$/gm,'').trim();await db.prepare(another).run();expect(await db.prepare("SELECT value FROM meta WHERE key='hosted:instance'").first()).toEqual({value:manifest.instanceId});
 });
 it.each(tables)('does not claim a database containing existing %s data',async(table)=>{
  await db.prepare(`INSERT INTO ${table}(id) VALUES (?)`).bind('private-existing-row').run();await mark();
  expect(await db.prepare("SELECT value FROM meta WHERE key='hosted:instance'").first()).toBeNull();expect((await db.prepare(`SELECT COUNT(*) n FROM ${table}`).first<{n:number}>())?.n).toBe(1);
 });
 it('rejects any old state metadata and fails closed when a migration-owned table is missing',async()=>{
  await db.prepare('INSERT INTO meta(key,value) VALUES (?,?)').bind('private:old-state','preserve').run();await mark();expect(await db.prepare("SELECT value FROM meta WHERE key='hosted:instance'").first()).toBeNull();
  await db.prepare('DROP TABLE content_aliases').run();await expect(mark()).rejects.toThrow();
 });
});
