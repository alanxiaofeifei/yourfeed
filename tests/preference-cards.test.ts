import {afterAll,beforeAll,beforeEach,describe,expect,it} from 'vitest';
import {Miniflare} from 'miniflare';
import {readFileSync,readdirSync} from 'node:fs';
import {handleApi} from '../server/api';
import {initialize,type Env} from '../server/db';
import {createProfile} from '../shared/profile';
import {curatedQuestions,newPreferenceState,questionsSchema,preferenceSummary,preferenceProfile,preferenceCatalog} from '../shared/preference-cards';
import {getPreferenceCards,savePreferenceCards,preferenceKey} from '../server/preference-cards';

for(const language of ['zh','en','zh-TW','vi'] as const)it(`${language}: ten distinct, localized two-choice cards with verified key-free mappings`,()=>{
 const questions=curatedQuestions(language);expect(questionsSchema.safeParse({questions}).success).toBe(true);expect(new Set(questions.map(q=>q.dimension)).size).toBe(10);
 const state=newPreferenceState(language);state.answers=Object.fromEntries(questions.map(q=>[q.id,'A']));const summary=preferenceSummary(state);expect(summary.sources.length).toBeGreaterThan(6);expect(new Set(summary.sources.map(s=>s.id)).size).toBe(summary.sources.length);
 for(const q of questions)for(const option of [q.optionA,q.optionB])for(const id of option.sourceIds){const entry=preferenceCatalog.find(entry=>entry.id===id)!;expect(entry).toMatchObject({platform:'rss',verification:{status:'verified'}});expect(entry.requiresApi).toBeUndefined();}
});
it('rejects invented IDs, URLs, extra fields, duplicate IDs/dimensions and malformed or oversized output',()=>{
 const good={questions:curatedQuestions('en')};
 for(const mutate of [(v:any)=>v.extra=true,(v:any)=>v.questions[0].optionA.sourceIds=['invented'],(v:any)=>v.questions[0].optionA.topics=['invented'],(v:any)=>v.questions[0].optionA.url='https://example.net/rss',(v:any)=>v.questions[0].prompt='<script>bad</script>',(v:any)=>v.questions[0].prompt='https://bad.net/rss',(v:any)=>v.questions[0].prompt='x'.repeat(121),(v:any)=>v.questions[1].id=v.questions[0].id,(v:any)=>v.questions[1].dimension=v.questions[0].dimension,(v:any)=>v.questions.pop()]){const value=structuredClone(good);mutate(value);expect(questionsSchema.safeParse(value).success).toBe(false);}
});
it('skips add no interests; manual entry preserves unrelated profile fields and all-skip weights',()=>{
 const state=newPreferenceState('en'),profile={...createProfile('creator','vi'),displayName:'Owner'};
 state.answers=Object.fromEntries(state.questions.map(q=>[q.id,'skipped']));expect(preferenceSummary(state).sources).toEqual([]);expect(preferenceProfile(state,profile)).toEqual(profile);
 state.manualInterest='Explore food science';state.manualTopics=['cooking'];const next=preferenceProfile(state,profile);expect(next).toMatchObject({displayName:'Owner',preset:'creator',language:'vi',topicWeights:{cooking:.5}});expect(next.goals[0]).toBe('Explore food science');expect(preferenceSummary(state).sources.some(s=>s.id==='king-arthur-baking')).toBe(true);
});

let mf:Miniflare,env:Env,other:Env;
beforeAll(async()=>{mf=new Miniflare({modules:true,script:'export default {fetch(){return new Response("fixture")}}',d1Databases:{DB:'preference-cards',OTHER:'preference-isolated'},compatibilityDate:'2026-05-15'});env={DB:await mf.getD1Database('DB') as unknown as Env['DB'],AUTH_MODE:'sites'};other={...env,DB:await mf.getD1Database('OTHER') as unknown as Env['DB']};for(const target of [env,other])for(const file of readdirSync('drizzle').filter(file=>file.endsWith('.sql')).sort())for(const sql of readFileSync('drizzle/'+file,'utf8').split('--> statement-breakpoint').map(sql=>sql.trim()).filter(Boolean))await target.DB.exec(sql.replace(/\r?\n/g,' '));},60000);
beforeEach(async()=>{await env.DB.prepare('DELETE FROM settings').run();await initialize(env);});
afterAll(async()=>mf?.dispose());
const call=(path:string,method='GET',body?:unknown,extra:Record<string,string>={})=>handleApi(new Request(`https://reader.test/api/${path}`,{method,headers:{'Content-Type':'application/json',Origin:'https://reader.test','oai-authenticated-user-id':'owner','Accept-Language':'vi',...extra},...(body===undefined?{}:{body:JSON.stringify(body)})}),env);
describe('preference state in existing local D1 settings',()=>{
 it('GET is read only and localized; answers survive reopening without any product writes',async()=>{
  const fresh=await (await call('preference-cards')).json() as ReturnType<typeof newPreferenceState>;expect(fresh).toMatchObject({revision:0,language:'vi'});expect(await env.DB.prepare('SELECT COUNT(*) n FROM settings').first('n')).toBe(0);
  fresh.answers.q1='B';fresh.position=1;const response=await call('preference-cards','PUT',{expectedRevision:0,state:fresh});expect(response.status).toBe(200);expect(await response.json()).toMatchObject({revision:1,position:1,answers:{q1:'B'}});
  expect(await getPreferenceCards(env,'owner','en')).toMatchObject({revision:1,position:1});expect(await env.DB.prepare('SELECT COUNT(*) n FROM sources').first('n')).toBe(0);expect(await env.DB.prepare("SELECT COUNT(*) n FROM settings WHERE id='profile:user'").first('n')).toBe(0);
 });
 it('isolates authenticated identities and databases; caller cannot supply an owner ID',async()=>{
  const state=newPreferenceState('en');await savePreferenceCards(env,'owner',{expectedRevision:0,state});expect((await getPreferenceCards(env,'another','en')).revision).toBe(0);expect((await getPreferenceCards(other,'owner','en')).revision).toBe(0);
  expect((await call('preference-cards','PUT',{expectedRevision:0,state,userId:'another'})).status).toBe(400);
 });
 it('uses actual D1 compare-and-swap for concurrent tabs and rejects stale revision',async()=>{
  const state=newPreferenceState('en');const result=await Promise.all([call('preference-cards','PUT',{expectedRevision:0,state}),call('preference-cards','PUT',{expectedRevision:0,state})]);expect(result.map(r=>r.status).sort()).toEqual([200,409]);expect((await getPreferenceCards(env,'owner','en')).revision).toBe(1);
 });
 it('retains completed answers across reentry and rejects unknown answers or invalid progress',async()=>{
  const state={...newPreferenceState('zh'),position:10,completedAt:new Date().toISOString(),answers:{q1:'A' as const},manualInterest:'Baking',manualTopics:['cooking' as const]};await savePreferenceCards(env,'owner',{expectedRevision:0,state});expect(await getPreferenceCards(env,'owner','en')).toMatchObject({completedAt:state.completedAt,answers:{q1:'A'},manualInterest:'Baking'});
  for(const patch of [{position:11},{answers:{unknown:'A'}},{answers:{q1:'C'}},{manualInterest:'x'.repeat(241)},{revision:0.5}])expect((await call('preference-cards','PUT',{expectedRevision:1,state:{...state,revision:1,...patch}})).status).toBe(400);
 });
 it('inherits existing authentication, same-origin and maintenance protections',async()=>{
  const state=newPreferenceState('en');expect((await handleApi(new Request('https://reader.test/api/preference-cards'),env)).status).toBe(401);
  expect((await call('preference-cards','PUT',{expectedRevision:0,state},{Origin:'https://evil.test'})).status).toBe(403);
  env.PRIVATE_BACKUP_LOCK='true';env.PRIVATE_BACKUP_GRANT=String(Date.now()+60000)+':'+'a'.repeat(43);expect((await call('preference-cards','PUT',{expectedRevision:0,state})).status).toBe(503);delete env.PRIVATE_BACKUP_LOCK;delete env.PRIVATE_BACKUP_GRANT;
 });
 it('never overwrites corrupt stored progress',async()=>{await env.DB.prepare('INSERT INTO settings(id,json) VALUES (?,?)').bind(preferenceKey('owner'),'{}').run();expect((await call('preference-cards')).status).toBe(409);expect((await call('preference-cards','PUT',{expectedRevision:0,state:newPreferenceState('en')})).status).toBe(409);});
 it('without AI credentials returns the curated bank and writes no sources or profile',async()=>{const response=await call('preference-cards/generate','POST',{});expect(response.status).toBe(200);expect(await response.json()).toEqual({source:'curated',questions:curatedQuestions('vi')});expect(await env.DB.prepare('SELECT COUNT(*) n FROM settings').first('n')).toBe(0);});
});
