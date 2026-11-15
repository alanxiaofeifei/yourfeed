import {afterAll,beforeAll,beforeEach,describe,it,expect,vi} from 'vitest';
import {Miniflare} from 'miniflare';
import {readdirSync,readFileSync} from 'node:fs';
import {handleApi} from '../server/api';
import {saveFeedback,readFeedback,upsertContent,listContent,getContentById,type Env} from '../server/db';
import {feedbackAffinities,rankFeed} from '../server/ranking';
import {exportLibraryPage,queryLibrary} from '../server/library';
import {restoreLibrary} from '../server/library-restore';
import {cachedBatchContent} from '../server/feed-rotation';
import {createProfile} from '../shared/profile';
import {archiveFiles} from '../shared/library-archive';
import type {ContentItem,Feedback} from '../shared/types';
const now=Date.parse('2026-11-15T00:00:00Z'),stamp=new Date(now).toISOString();
const item=(id:string,sourceId=id,topics:ContentItem['topics']=['science']):ContentItem=>({id,sourceId,sourceName:'Synthetic publisher',topics,kind:'article',platform:'RSS',title:'Synthetic science '+id,url:'https://example.com/'+id,summary:'An excerpt',publishedAt:stamp});
describe('deterministic local learning',()=>{
 it('uses exact positive weights, topic splitting, source weight and negative precedence',()=>{
  const rows=[item('a','publisher',['science','tools'])];
  const positive=feedbackAffinities(rows,{a:{liked:true,saved:true,read:true,updatedAt:stamp}},now);
  expect(positive.topic.science).toBeCloseTo(1.6/6);expect(positive.topic.tools).toBeCloseTo(1.6/6);expect(positive.source.get('publisher')).toBeCloseTo(.8);
  const negative=feedbackAffinities(rows,{a:{liked:true,saved:true,read:true,disliked:true,updatedAt:stamp}},now);
  expect(negative.topic.science).toBeCloseTo(-1.4/6);expect(negative.source.get('publisher')).toBeCloseTo(-.7);
 });
 it('decays by a 30-day half-life with safe legacy/invalid dates and future timestamps',()=>{
  const rows=[item('a')],signal=(updatedAt?:string)=>feedbackAffinities(rows,{a:{liked:true,updatedAt}},now).source.get('a')!;
  expect(signal(stamp)).toBe(.5);expect(signal(new Date(now-30*86400000).toISOString())).toBe(.25);
  expect(signal()).toBeCloseTo(.5*Math.pow(.5,14/30));expect(signal('invalid')).toBe(signal());expect(signal(new Date(now+86400000).toISOString())).toBe(.5);
 });
 it('clamps the final sum independently of input order and uses deterministic ties',()=>{
  const rows=Array.from({length:50},(_,i)=>item('a'+i,'same'));
  const feedback=Object.fromEntries(rows.map((row,i)=>[row.id,{liked:i<25,disliked:i>=25,updatedAt:stamp}]));
  expect(feedbackAffinities(rows,feedback,now).source.get('same')).toBe(-1.5);
  expect(feedbackAffinities([...rows].reverse(),feedback,now).topic.science).toBeCloseTo(-1.5);
  expect(rankFeed([item('b'),item('a')],[],{},'rest','all','all','',undefined,now).map(row=>row.id)).toEqual(['a','b']);
 });
 it('downweights related topics/sources without hiding peers and Undo restores the order',()=>{
  const rows=[item('signal','source'),item('peer','source'),item('other','other',['tools'])];
  const profile={...createProfile('explorer','en'),goals:[],topicWeights:{science:.8,tools:.8}};
  const rank=(feedback:Record<string,Feedback>)=>rankFeed(rows,[],feedback,'grow','all','all','',profile,now);
  const baseline=rank({});const negative={signal:{disliked:true,dismissed:true,updatedAt:stamp}};
  expect(rank(negative).map(row=>row.id)).toEqual(['other','peer']);
  expect(rank({signal:{disliked:false,dismissed:false,updatedAt:stamp}}).map(row=>[row.id,row.reason])).toEqual(baseline.map(row=>[row.id,row.reason]));
  expect(rank({signal:{dismissed:true,updatedAt:stamp}})).toEqual(rank(negative));
 });
 it.each(['zh','zh-TW','en','vi'] as const)('explains source, topic, goal and default in %s without replacing retained analysis',language=>{
  const rows=[item('seed','pub'),item('second','pub2'),item('candidate','pub')],profile={...createProfile('explorer',language),goals:[]};
  const rank=(feedback:Record<string,Feedback>,data=rows)=>rankFeed(data,[],feedback,'grow','all','all','',profile,now);
  const source=rank({seed:{liked:true,read:true,updatedAt:stamp}}).find(row=>row.id==='candidate')!;
  const expected={zh:'因为你常喜欢来自','zh-TW':'因為你常喜歡來自',en:'Because you often like content from',vi:'Vì bạn thường thích nội dung từ'};
  expect(source.reason).toContain(expected[language]);
  const topic=rank({seed:{liked:true,read:true,updatedAt:stamp},second:{liked:true,read:true,updatedAt:stamp}},[...rows.slice(0,2),item('candidate','unique')]).find(row=>row.id==='candidate')!;
  expect(topic.reason).toContain({zh:'因为你喜欢','zh-TW':'因為你喜歡',en:'Because you like',vi:'Vì bạn thích'}[language]);
  expect(rank({})[0].reason).toBeTruthy();
  const goalProfile={...profile,goals:['science']};expect(rankFeed([rows[0]],[],{},'grow','all','all','',goalProfile,now)[0].reason).toContain('science');
  const analyzed={...rows[0],analysis:{bullets:['Original'],topics:rows[0].topics,coverage:'excerpt' as const,references:[],model:'fixture',summaryLanguage:language,relevance:'Existing analysis'}};
  expect(rank({},[analyzed])[0].reason).toBe('Existing analysis');expect(analyzed.analysis.bullets).toEqual(['Original']);
 });
});
let mf:Miniflare,env:Env;
const origin='https://synthetic.example';
const request=(path:string,user='alice',patch?:Record<string,unknown>)=>new Request(origin+path,{method:patch?'POST':'GET',headers:{Origin:origin,'Content-Type':'application/json','oai-authenticated-user-id':user},...(patch?{body:JSON.stringify(patch)}:{})});
beforeAll(async()=>{
 mf=new Miniflare({modules:true,script:'export default {fetch(){return new Response("fixture")}}',d1Databases:{DB:'feedback-learning',OTHER:'feedback-independent'},compatibilityDate:'2026-05-15'});
 env={DB:await mf.getD1Database('DB') as unknown as Env['DB'],AUTH_MODE:'sites'};
 for(const file of readdirSync('drizzle').filter(file=>file.endsWith('.sql')).sort())for(const sql of readFileSync('drizzle/'+file,'utf8').split('--> statement-breakpoint').map(sql=>sql.trim()).filter(Boolean))await env.DB.exec(sql.replace(/\r?\n/g,' '));
},60000);
afterAll(async()=>{await mf?.dispose();});
beforeEach(async()=>{await env.DB.batch(['feedback','content_search','content_sources','content_aliases','content','sources','meta','settings'].map(table=>env.DB.prepare('DELETE FROM '+table)));});
describe('D1 learning persistence and isolation',()=>{
 it('keeps ranked feedback out of source writes and ignores legacy cache contamination on every reading path',async()=>{
  const source=item('cached'),ranked={...source,liked:true,saved:true,read:true,disliked:true,dismissed:true,updatedAt:stamp,reason:'Alice-only recommendation'};
  await upsertContent(env,[ranked]);
  const raw=JSON.parse((await env.DB.prepare('SELECT json FROM content WHERE id=?').bind(source.id).first<{json:string}>())!.json);
  for(const key of ['liked','saved','read','disliked','dismissed','updatedAt','reason'])expect(raw).not.toHaveProperty(key);
  // Simulate a cache written by the older automatic-analysis path; no data migration is needed.
  await env.DB.prepare('UPDATE content SET json=? WHERE id=?').bind(JSON.stringify(ranked),source.id).run();
  await saveFeedback(env,'alice',source.id,{disliked:true});
  const records=[...(await listContent(env)),(await getContentById(env,source.id))!,...(await cachedBatchContent(env,new Date(Date.now()+1000).toISOString())),...(await queryLibrary(env,{userId:'bob'})).items];
  for(const record of records)for(const key of ['liked','saved','read','disliked','dismissed','updatedAt','reason'])expect(record).not.toHaveProperty(key);
  const feed=await handleApi(request('/api/feed','bob'),env);expect((await feed.json() as any).items).toHaveLength(1);
  expect((await exportLibraryPage(env,'bob')).feedback).toEqual({});
  expect((await queryLibrary(env,{userId:'alice',filter:'disliked'})).items[0].disliked).toBe(true);
  // Merging an analysis update into an existing cache also removes stale view fields.
  await upsertContent(env,[source]);const cleaned=JSON.parse((await env.DB.prepare('SELECT json FROM content WHERE id=?').bind(source.id).first<{json:string}>())!.json);
  expect(cleaned).not.toHaveProperty('liked');expect(cleaned).not.toHaveProperty('reason');
  expect((await readFeedback(env,'alice'))[source.id].disliked).toBe(true);
 });

 it('keeps the same user and item IDs independent across instance databases',async()=>{
  const other:Env={DB:await mf.getD1Database('OTHER') as unknown as Env['DB'],AUTH_MODE:'sites'};
  for(const file of readdirSync('drizzle').filter(file=>file.endsWith('.sql')).sort())for(const sql of readFileSync('drizzle/'+file,'utf8').split('--> statement-breakpoint').map(sql=>sql.trim()).filter(Boolean))await other.DB.exec(sql.replace(/\r?\n/g,' '));
  await Promise.all([upsertContent(env,[item('same')]),upsertContent(other,[item('same')])]);
  await saveFeedback(env,'alice','same',{disliked:true});
  expect((await readFeedback(env,'alice')).same.disliked).toBe(true);expect(await readFeedback(other,'alice')).toEqual({});
  await saveFeedback(other,'alice','same',{liked:true});expect((await readFeedback(env,'alice')).same.liked).toBeUndefined();
 });

 it('normalizes old/new API clients and ignores client timestamps/user IDs without network calls',async()=>{
  const network=vi.spyOn(globalThis,'fetch').mockRejectedValue(new Error('No live network permitted'));
  try{
   await upsertContent(env,[item('a')]);
   const response=await handleApi(request('/api/feedback','alice',{id:'a',userId:'bob',patch:{disliked:true,updatedAt:'2000-01-01'}}),env);
   expect(response.status).toBe(200);expect((await response.json() as any).feedback).toMatchObject({disliked:true,dismissed:true});
   expect((await readFeedback(env,'alice')).a.updatedAt).not.toBe('2000-01-01');expect(await readFeedback(env,'bob')).toEqual({});
   expect((await handleApi(request('/api/library?filter=disliked','bob'),env)).status).toBe(200);
   expect((await queryLibrary(env,{userId:'alice',filter:'disliked'})).items).toHaveLength(1);expect((await queryLibrary(env,{userId:'bob',filter:'disliked'})).items).toHaveLength(0);
   await handleApi(request('/api/feedback','alice',{id:'a',patch:{dismissed:false}}),env);expect((await readFeedback(env,'alice')).a).toMatchObject({disliked:false,dismissed:false});expect(network).not.toHaveBeenCalled();
  }finally{network.mockRestore();}
 });
 it('keeps concurrent flags, ranks each user independently, and reviews legacy dismissals beyond the feed window',async()=>{
  await upsertContent(env,[item('signal','pub'),item('peer','pub'),item('other','other',['tools'])]);
  await Promise.all([saveFeedback(env,'alice','signal',{liked:true}),saveFeedback(env,'alice','signal',{saved:true}),saveFeedback(env,'alice','signal',{read:true})]);
  expect((await readFeedback(env,'alice')).signal).toMatchObject({liked:true,saved:true,read:true});
  const rows=[item('signal','pub'),item('peer','pub')];
  expect(rankFeed(rows,[],await readFeedback(env,'alice'),'grow').find(row=>row.id==='peer')!.reason).toContain('因为你常喜欢来自');
  expect(rankFeed(rows,[],await readFeedback(env,'bob'),'grow').find(row=>row.id==='peer')!.reason).not.toContain('因为你常喜欢来自');
  await env.DB.prepare('INSERT INTO feedback(user_id,item_id,json) VALUES (?,?,?)').bind('alice','other',JSON.stringify({dismissed:true})).run();
  expect((await queryLibrary(env,{userId:'alice',filter:'disliked'})).items.map(row=>row.id)).toEqual(['other']);
 });
 it('round-trips negative signals and decay timestamps in the existing archive format',async()=>{
  await upsertContent(env,[item('a')]);await saveFeedback(env,'alice','a',{disliked:true,saved:true},{restoredAt:stamp});
  const page=await exportLibraryPage(env,'alice');
  const files=archiveFiles([page],(zh,en)=>en||zh);const archive=JSON.parse(files.find(file=>file.name==='archive.json')!.text);
  expect(archive.feedback.a).toMatchObject({disliked:true,dismissed:true,saved:true,updatedAt:stamp});
  await env.DB.batch(['feedback','content_search','content_sources','content_aliases','content'].map(table=>env.DB.prepare('DELETE FROM '+table)));
  await restoreLibrary(env,'bob',{archive,confirmed:true},true);
  expect((await readFeedback(env,'bob')).a).toMatchObject(archive.feedback.a);expect(await readFeedback(env,'alice')).toEqual({});
 });
});
