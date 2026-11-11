import {beforeAll,afterAll,describe,it,expect} from 'vitest';
import {Miniflare} from 'miniflare';
import {readdirSync,readFileSync} from 'node:fs';
import {type Env,databaseStorage,upsertContent,getContentById,setState} from '../server/db';
import {queryLibrary} from '../server/library';
import {retentionStatus,cleanupRetention} from '../server/retention';

let mf:Miniflare,env:Env;
beforeAll(async()=>{
 mf=new Miniflare({modules:true,script:'export default {fetch(){return new Response("fixture")}}',d1Databases:{DB:'library-vnext-real'},compatibilityDate:'2026-05-15'});
 env={DB:await mf.getD1Database('DB') as unknown as Env['DB'],AUTH_MODE:'sites'};
 for(const file of readdirSync('drizzle').filter(file=>file.endsWith('.sql')).sort())for(const sql of readFileSync('drizzle/'+file,'utf8').split('--> statement-breakpoint').map(sql=>sql.trim()).filter(Boolean))await env.DB.exec(sql.replace(/\r?\n/g,' '));
},60000);
afterAll(async()=>{await mf?.dispose();});
const item=(id:string)=>({id,kind:'article' as const,platform:'RSS',sourceId:'publisher',sourceName:'Publisher',title:'Science '+id,url:'https://publisher.reader.net/'+id,summary:'Excerpt',body:'實際索引與閱讀內容',publishedAt:'2026-01-01T00:00:00Z',topics:['science' as const],retrievedAt:'2026-01-01T00:00:00Z'});
describe('D1 runtime behavior of library SQL',()=>{
 it('measures physical database pages and indexes/traverses stored articles',async()=>{expect((await databaseStorage(env)).databaseBytes).toBeGreaterThan(0);await upsertContent(env,[item('real-d1')]);expect((await queryLibrary(env,{userId:'owner',q:'索引與閱讀'})).items[0].id).toBe('real-d1');expect((await retentionStatus(env)).enabled).toBe(false);});
 it('atomically caps new hosted content and permits updates of existing IDs',async()=>{
  env.HOSTING_MODE=' hosted ';await setState(env,'hosted:new-content:'+new Date().toISOString().slice(0,10),'248');
  const results=await Promise.allSettled(['one','two','three'].map(id=>upsertContent(env,[item('quota-'+id)])));
  expect(results.filter(result=>result.status==='fulfilled')).toHaveLength(2);expect(results.filter(result=>result.status==='rejected')).toHaveLength(1);
  const stored=await env.DB.prepare("SELECT id FROM content WHERE id LIKE 'quota-%' LIMIT 1").first<{id:string}>();expect(stored).toBeTruthy();await upsertContent(env,[{...item(stored!.id),summary:'An updated excerpt'}]);expect((await getContentById(env,stored!.id))?.summary).toBe('An updated excerpt');
  expect(Number(await env.DB.prepare('SELECT value FROM meta WHERE key=?').bind('hosted:new-content:'+new Date().toISOString().slice(0,10)).first('value'))).toBe(250);
 });
 it('runs bounded cleanup without dropping metadata, IDs, or assigning a fresh sort time',async()=>{const before=await env.DB.prepare('SELECT updated_at FROM content WHERE id=?').bind('real-d1').first('updated_at');expect((await cleanupRetention(env,{limit:1,now:Date.parse('2026-11-11T00:00:00Z')})).cleared).toBe(1);const unchanged=await env.DB.prepare('SELECT updated_at FROM content WHERE id=?').bind('real-d1').first('updated_at');expect(unchanged).toBe(before);expect(await getContentById(env,'real-d1')).toBeTruthy();});
});
