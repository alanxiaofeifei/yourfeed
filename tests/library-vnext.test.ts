import {describe,it,expect} from 'vitest';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {type Env,upsertContent,getContentById,getSecret,saveFeedback} from '../server/db';
import {queryLibrary,exportLibraryPage,rebuildSearchIndex} from '../server/library';
import {cleanupRetention,retentionStatus,saveRetentionPolicy} from '../server/retention';
import {schemaHealth} from '../server/health';
import {getProfile} from '../server/profile';
import {deduplicateFeed} from '../server/dedup';
import {restoreLibrary,readLibraryArchiveBody} from '../server/library-restore';
import type {ContentItem} from '../shared/types';

function fixture(){
 const db=new DatabaseSync(':memory:');for(const file of readdirSync('drizzle').filter(file=>file.endsWith('.sql')).sort())db.exec(readFileSync('drizzle/'+file,'utf8'));
 const calls={value:0}; const prepare=(sql:string)=>{const statement=db.prepare(sql);const bound=(args:any[])=>({run:async()=>{calls.value++;return {meta:{changes:Number(statement.run(...args).changes),size_after:Number(db.prepare('PRAGMA page_count').get()?.page_count)*Number(db.prepare('PRAGMA page_size').get()?.page_size)}};},first:async(name?:string)=>{calls.value++;const row=statement.get(...args);return row?(name?row[name]:row):null;},all:async()=>{calls.value++;return {results:statement.all(...args)};}});return {...bound([]),bind:(...args:any[])=>bound(args)};};
 return {db,calls,env:{DB:{prepare,batch:async(statements:any[])=>Promise.all(statements.map(s=>s.run()))},AUTH_MODE:'sites'} as unknown as Env};
}
const article=(id:string,patch:Partial<ContentItem>={}):ContentItem=>({id,kind:'article',platform:'RSS',sourceId:'first',sourceName:'First publisher',title:'An article '+id,url:'https://publisher.example/story/'+id,summary:'Publisher excerpt',body:'Available text',publishedAt:'2026-01-01T00:00:00Z',topics:['science'],...patch});

describe('preserving the complete library with bounded SQL pages',()=>{
 it('finds an old saved item beyond 5,000 newer rows, searches body/AI, and reads by stable aliases',async()=>{
  const {db,env}=fixture(),insert=db.prepare('INSERT INTO content(id,source_id,kind,url,json,updated_at) VALUES (?,?,?,?,?,?)');
  db.exec('BEGIN');for(let i=0;i<5005;i++){const item=article('item-'+i,{body:i===0?'唯一的天文线索':'Other text',analysis:i===0?{bullets:['A unique inference'],relevance:'Older research',topics:['science'],coverage:'excerpt',references:[],model:'fixture'}:undefined});insert.run(item.id,item.sourceId,item.kind,item.url,JSON.stringify(item),new Date(Date.UTC(2026,0,1,0,i)).toISOString());}db.exec('COMMIT');
  await saveFeedback(env,'owner','item-0',{saved:true});
  expect((await queryLibrary(env,{userId:'owner',filter:'saved'})).items.map(item=>item.id)).toEqual(['item-0']);
  expect((await queryLibrary(env,{userId:'other',filter:'saved'})).items).toHaveLength(0);
  expect((await queryLibrary(env,{userId:'owner',q:'天文线索'})).items[0].id).toBe('item-0');
  expect((await queryLibrary(env,{userId:'owner',q:'unique inference'})).items[0].id).toBe('item-0');
  db.prepare('INSERT INTO content_aliases(alias,content_id) VALUES (?,?)').run('legacy-item-0','item-0');expect((await getContentById(env,'legacy-item-0'))?.id).toBe('item-0');
  const first=await queryLibrary(env,{userId:'owner',limit:100});const second=await queryLibrary(env,{userId:'owner',limit:100,cursor:first.nextCursor!});
  expect(first.total).toBe(5005);expect(new Set([...first.items,...second.items].map(item=>item.id)).size).toBe(200);
  await expect(queryLibrary(env,{userId:'owner',q:'changed',cursor:first.nextCursor!})).rejects.toMatchObject({status:400});
 });
 it('indexes four-language content, keeps prior AI notes on refresh and retains every source',async()=>{
  const {env}=fixture();const item=article('stable',{body:'Tiếng Việt quan sát thiên văn 繁體中文網域',analysis:{bullets:['Cached evidence'],relevance:'Relevant',topics:['science'],coverage:'excerpt',references:[],model:'fixture'}});
  await upsertContent(env,[item]);await upsertContent(env,[{...item,sourceId:'second',sourceName:'Second publisher',analysis:undefined}]);
  expect((await getContentById(env,'stable'))?.sourceId).toBe('first');
  const page=await queryLibrary(env,{userId:'owner',q:'Cached evidence'});expect(page.items).toHaveLength(1);expect(page.items[0].relatedSources?.map(source=>source.name)).toEqual(['First publisher','Second publisher']);
  for(const q of ['Tiếng Việt','繁體中文'])expect((await queryLibrary(env,{userId:'owner',q})).items[0].id).toBe('stable');
  expect(await rebuildSearchIndex(env,1)).toEqual({indexed:0,hasMore:false});
 });
 it('preserves genuine dates and cache ordering when later feed dates are missing',async()=>{
  const {db,env}=fixture();await upsertContent(env,[article('stable')]);const before=db.prepare('SELECT updated_at FROM content').get()?.updated_at;
  await upsertContent(env,[article('stable',{publishedAt:'1970-01-01T00:00:00.000Z',dateSource:'missing'})]);
  expect((await getContentById(env,'stable'))?.publishedAt).toBe('2026-01-01T00:00:00Z');expect(db.prepare('SELECT updated_at FROM content').get()?.updated_at).toBe(before);
 });
 it('exports actual data/feedback with paging and excludes settings, sessions, keys and reservations',async()=>{
  const {env,db}=fixture();await upsertContent(env,[article('first'),article('second')]);await saveFeedback(env,'owner','first',{liked:true});db.prepare('INSERT INTO settings(id,json) VALUES (?,?)').run('key:openai',JSON.stringify({cipher:'never-export-secret'}));
  const first=await exportLibraryPage(env,'owner',{limit:1});expect(first.nextCursor).toBeTruthy();const second=await exportLibraryPage(env,'owner',{limit:1,cursor:first.nextCursor!});
  expect(first.sources).toEqual([]);expect(second).not.toHaveProperty('profile');expect([...first.items,...second.items].map(item=>item.id).sort()).toEqual(['first','second']);expect(JSON.stringify([first,second])).not.toContain('never-export-secret');expect({...first.feedback,...second.feedback}).toMatchObject({first:{liked:true}});
 });
 it('disables environment API-key fallback only in hosted mode',async()=>{
  const {env}=fixture();env.OPENAI_API_KEY='owner-key-never-for-guests';env.YOUTUBE_API_KEY='owner-video-key';
  expect(await getSecret(env,'openai')).toBe(env.OPENAI_API_KEY);env.HOSTING_MODE='hosted';expect(await getSecret(env,'openai')).toBeUndefined();expect(await getSecret(env,'youtube')).toBeUndefined();
 });
 it('checks the complete additive schema rather than content-table existence',async()=>{
  const {env,db}=fixture();expect(await schemaHealth(env)).toMatchObject({schemaReady:true,schemaVersion:2});db.exec('DROP TABLE content_aliases');expect(await schemaHealth(env)).toMatchObject({schemaReady:false,missing:expect.arrayContaining(['content_aliases'])});
 });
 it('deduplicates recommendation copies while preserving release versions and source evidence',()=>{
  const a=article('a',{title:'Product 1.2 release'}),b=article('b',{title:'Product 1.2 release',url:a.url,sourceName:'Other'}),c=article('c',{title:'Product 1.3 release',url:a.url});const result=deduplicateFeed([a,b,c]);expect(result).toHaveLength(2);expect(result[0].relatedSources).toHaveLength(2);
 });
});

describe('opt-in or hosted-only retention of ordinary cached bodies',()=>{
 it('defaults off for Sites and only removes old ordinary bodies, preserving IDs, summaries, saved/read/liked feedback',async()=>{
  const {env}=fixture(),now=Date.parse('2026-11-11T00:00:00Z'),old=new Date(now-100*86400000).toISOString(),warning=new Date(now-85*86400000).toISOString();
  await upsertContent(env,[article('ordinary',{retrievedAt:old}),article('liked',{retrievedAt:old}),article('saved',{retrievedAt:old}),article('warning',{retrievedAt:warning})]);await saveFeedback(env,'owner','liked',{liked:true,read:true});await saveFeedback(env,'owner','saved',{saved:true});
  expect((await retentionStatus(env,now)).enabled).toBe(false);expect(await cleanupRetention(env,{now})).toMatchObject({cleared:0,disabled:true});
  await saveRetentionPolicy(env,{enabled:true});expect(await retentionStatus(env,now)).toMatchObject({expiredCount:1,expiringCount:1});expect(await cleanupRetention(env,{now})).toMatchObject({cleared:1,hasMore:false});
  expect(await getContentById(env,'ordinary')).toMatchObject({id:'ordinary',summary:'Publisher excerpt',contentCoverage:'excerpt',truncated:true});expect((await getContentById(env,'ordinary'))?.body).toBeUndefined();expect((await getContentById(env,'liked'))?.body).toBeTruthy();expect((await getContentById(env,'saved'))?.body).toBeTruthy();expect((await queryLibrary(env,{userId:'owner',filter:'liked'})).items[0]).toMatchObject({id:'liked',read:true});
 });
 it('new hosted instances default to ninety days without changing self-hosted policy',async()=>{const {env}=fixture();expect((await retentionStatus({...env,HOSTING_MODE:'hosted'})).enabled).toBe(true);expect((await retentionStatus(env)).enabled).toBe(false);});
});

describe('secret-free archive restore with explicit preview and opt-ins',()=>{
 it('round trips content and owner feedback, skips existing IDs and never imports server credentials',async()=>{
  const first=fixture();await upsertContent(first.env,[article('portable',{url:'https://publisher.reader.net/portable'})]);await saveFeedback(first.env,'old-owner','portable',{liked:true,read:true});const archive=await exportLibraryPage(first.env,'old-owner');
  const second=fixture(),input={archive:{...archive,settings:{'key:openai':'must-not-import'},auth_user:[{id:'attacker'}]}};const existingSettings=second.db.prepare('SELECT id,json FROM settings ORDER BY id').all();
  expect(await restoreLibrary(second.env,'new-owner',input)).toMatchObject({newItems:1,existingItems:0,imported:0});expect(second.db.prepare('SELECT COUNT(*) n FROM content').get()?.n).toBe(0);
  expect(await restoreLibrary(second.env,'new-owner',{...input,confirmed:true},true)).toMatchObject({imported:1});expect((await queryLibrary(second.env,{userId:'new-owner',filter:'liked'})).items[0]).toMatchObject({id:'portable',read:true});
  expect(second.db.prepare('SELECT id,json FROM settings ORDER BY id').all()).toEqual(existingSettings);expect(second.db.prepare('SELECT COUNT(*) n FROM auth_user').get()?.n).toBe(0);
  await restoreLibrary(second.env,'new-owner',{archive:{...archive,items:[article('portable',{title:'Never overwrite existing',url:'https://publisher.reader.net/portable'})]},confirmed:true},true);expect((await getContentById(second.env,'portable'))?.title).not.toBe('Never overwrite existing');
 });
 it('requires explicit confirmation and separate source/profile permission, rejects private URLs and oversized batches',async()=>{
  const {env,db}=fixture(),archive={format:'yourfeed-archive',version:1,items:[article('one',{url:'https://publisher.reader.net/story'})],sources:[{id:'imported-source',platform:'rss',name:'Publisher',locator:'https://publisher.reader.net/feed',topics:['science'],enabled:true}]};
  await expect(restoreLibrary(env,'owner',{archive},true)).rejects.toMatchObject({status:400});
  await restoreLibrary(env,'owner',{archive,confirmed:true},true);expect(db.prepare('SELECT COUNT(*) n FROM sources').get()?.n).toBe(0);
  await restoreLibrary(env,'owner',{archive,importSources:true,confirmed:true},true);expect(db.prepare('SELECT id FROM sources').get()?.id).toBe('imported-source');
  await expect(restoreLibrary(env,'owner',{archive:{...archive,items:[article('bad',{url:'https://127.0.0.1/admin'})]}})).rejects.toThrow();
  await expect(restoreLibrary(env,'owner',{archive:{...archive,items:Array.from({length:4},(_,i)=>article(String(i)))}})).rejects.toMatchObject({status:400});
  await expect(readLibraryArchiveBody(new Request('https://reader.net/api/archive/import/preview',{method:'POST',headers:{'Content-Length':String(9*1024*1024)},body:'{}'}))).rejects.toMatchObject({status:413});
 });
 it('keeps a maximum restore batch within the Free query budget and remaps references from source-only chunks',async()=>{
  const {env,db,calls}=fixture();env.HOSTING_MODE='hosted';
  const sources=Array.from({length:3},(_,i)=>({id:'archive-source-'+i,platform:'rss',name:'Publisher '+i,locator:'https://publisher.reader.net/feed/'+i,topics:['science'],enabled:true}));
  const profile=await getProfile(env);calls.value=0;
  const archive={format:'yourfeed-archive',version:1,items:[0,1,2].map(i=>article('restore-'+i,{url:'https://publisher.reader.net/'+i,sourceId:sources[i].id})),sources,profile,feedback:{'restore-0':{liked:true},'restore-1':{read:true},'restore-2':{saved:true}}};
  expect((await restoreLibrary(env,'owner',{archive,importSources:true,importProfile:true,confirmed:true},true)).imported).toBe(3);expect(calls.value).toBeLessThanOrEqual(40);
  db.prepare("UPDATE sources SET id='local-existing',json=json_set(json,'$.id','local-existing') WHERE id='archive-source-0'").run();
  const references={format:'yourfeed-archive',version:1,items:[article('ref-only',{url:'https://publisher.reader.net/ref',sourceId:'archive-source-0'})],sourceReferences:[sources[0]]};
  await restoreLibrary(env,'owner',{archive:references,confirmed:true},true);expect((await getContentById(env,'ref-only'))?.sourceId).toBe('local-existing');
 });
});
