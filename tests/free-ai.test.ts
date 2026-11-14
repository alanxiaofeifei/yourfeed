import {beforeEach,afterEach,describe,it,expect,vi} from 'vitest';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import type {Env} from '../server/db';
import {curatedQuestions} from '../shared/preference-cards';
import {createProfile} from '../shared/profile';
import {freeAiMessages} from '../shared/free-ai-messages';

let env:Env,db:DatabaseSync,network:ReturnType<typeof vi.fn>,now:number;
let free:typeof import('../server/free-ai');
function environment():Env{
 db=new DatabaseSync(':memory:');for(const name of readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())db.exec(readFileSync('drizzle/'+name,'utf8'));
 const prepare=(sql:string)=>{const stmt=db.prepare(sql);const bound=(args:any[])=>({first:async()=>stmt.get(...args)||null,run:async()=>({meta:{changes:Number(stmt.run(...args).changes)}}),all:async()=>({results:stmt.all(...args)})});return {bind:(...args:any[])=>bound(args),...bound([])};};
 return {DB:{prepare,batch:async(statements:any[])=>{db.exec('BEGIN');try{const result=await Promise.all(statements.map(s=>s.run()));db.exec('COMMIT');return result;}catch(error){db.exec('ROLLBACK');throw error;}}},APP_ENCRYPTION_KEY:'12'.repeat(32)} as unknown as Env;
}
const response=(value:unknown={ok:true},extra:Record<string,unknown>={})=>new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(value),reasoning:'private reasoning that must be discarded'},finish_reason:'stop'}],...extra}));
const task={instructions:'Return JSON',prompt:'Synthetic nonpersonal input',parse:(text:string)=>{const data=JSON.parse(text);if(data.ok!==true)throw Error('invalid');return data as {ok:true};}};
beforeEach(async()=>{vi.resetModules();env=environment();now=Date.now();vi.spyOn(Date,'now').mockImplementation(()=>now);network=vi.fn(async()=>response());vi.stubGlobal('fetch',network);free=await import('../server/free-ai');});
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();db.close();});

describe('keyless free channel with real SQLite budgets and mocked network',()=>{
 it('constructs only the two fixed official keyless JSON requests and strips reasoning',async()=>{
  for(const endpoint of ['ovh','pollinations'] as const){const request=free.buildFreeAiRequest(endpoint,'system','prompt');const body=JSON.parse(request.init.body);expect(request.init.headers).toEqual({'Content-Type':'application/json'});expect(request.init.redirect).toBe('manual');expect(body).toMatchObject({max_tokens:4096,response_format:{type:'json_object'},stream:false});expect(body.model).toBe(endpoint==='ovh'?'gpt-oss-20b':'openai');expect(request.url).toBe(endpoint==='ovh'?'https://oai.endpoints.kepler.ai.cloud.ovh.net/v1/chat/completions':'https://text.pollinations.ai/v1/chat/completions');}
  expect(await free.runFreeAi(env,task)).toEqual({ok:true});expect(network).toHaveBeenCalledTimes(1);expect(JSON.stringify(await free.runFreeAi(env,task))).not.toContain('reasoning');
 });
 for(const status of [402,429,500,503])it(`OVH ${status} falls through to Pollinations, honors Retry-After, and never exposes raw errors`,async()=>{
  network.mockResolvedValueOnce(new Response('secret error text',{status,headers:{'Retry-After':'120'}}));
  expect(await free.runFreeAi(env,task)).toEqual({ok:true});expect(network).toHaveBeenCalledTimes(2);expect(network.mock.calls[1][0]).toContain('pollinations');
  now+=31_000;expect(await free.runFreeAi(env,task)).toEqual({ok:true});expect(network.mock.calls[2][0]).toContain('pollinations');
  now+=90_000;expect(await free.runFreeAi(env,task)).toEqual({ok:true});expect(network.mock.calls[3][0]).toContain('ovh');
 });
 it('honors HTTP-date Retry-After and blocks redirects',async()=>{
  network.mockResolvedValueOnce(new Response('',{status:302,headers:{Location:'https://evil.test','Retry-After':new Date(now+120_000).toUTCString()}}));await free.runFreeAi(env,task);now+=31_000;await free.runFreeAi(env,task);expect(network.mock.calls.map(call=>call[0])).toEqual([expect.stringContaining('ovh'),expect.stringContaining('pollinations'),expect.stringContaining('pollinations')]);
 });
 for(const bad of ['invalid-json','invalid-shape','empty','truncated','oversized'])it(`validates ${bad} before accepting either provider`,async()=>{
  network.mockImplementationOnce(async()=>bad==='invalid-json'?new Response('not json'):bad==='invalid-shape'?response({ok:false}):bad==='empty'?response({}, {choices:[{message:{content:'',reasoning:'only reasoning'}}]}):bad==='truncated'?response({ok:true},{choices:[{message:{content:'{}'},finish_reason:'length'}]}):new Response('x'.repeat(256001)));
  expect(await free.runFreeAi(env,task)).toEqual({ok:true});expect(network).toHaveBeenCalledTimes(2);
 });
 it('timeouts cover fetch and stalled bodies and still try backup within the overall deadline',async()=>{
  network.mockImplementationOnce(()=>new Promise(()=>{}));const start=performance.now();expect(await free.runFreeAi(env,{...task,timeoutSeconds:.12})).toEqual({ok:true});expect(performance.now()-start).toBeLessThan(250);expect(network.mock.calls[0][1].signal.aborted).toBe(true);
  now+=31_000;network.mockImplementationOnce(async()=>new Response(new ReadableStream({start(){}})));expect(await free.runFreeAi(env,{...task,timeoutSeconds:.12})).toEqual({ok:true});
 });
 it('both endpoints failing returns no AI and opens a circuit without more network or budget writes',async()=>{
  network.mockImplementation(async()=>new Response('',{status:429}));expect(await free.runFreeAi(env,task)).toBeUndefined();expect(await free.runFreeAi(env,task)).toBeUndefined();expect(network).toHaveBeenCalledTimes(2);expect(db.prepare("SELECT value FROM meta WHERE key LIKE 'free-ai:day:%'").get()).toEqual({value:'1'});
 });
 it('reserves in-flight endpoint slots synchronously across concurrent calls',async()=>{
  let release!:()=>void;const ready=new Promise<void>(resolve=>release=resolve);network.mockImplementation(async()=>{await ready;return response();});const running=Array.from({length:12},()=>free.runFreeAi(env,task));await new Promise(resolve=>setTimeout(resolve,20));expect(network).toHaveBeenCalledTimes(2);release();await Promise.all(running);expect(network).toHaveBeenCalledTimes(2);
 });
 it('enforces ten attempts per owner/day atomically across fresh isolates and rolls over next day',async()=>{
  const results=await Promise.all(Array.from({length:20},()=>free.runFreeAi(env,task)));expect(results.filter(Boolean).length).toBeLessThanOrEqual(2);expect(db.prepare("SELECT value FROM meta WHERE key LIKE 'free-ai:day:%'").get()).toEqual({value:'10'});
  vi.resetModules();free=await import('../server/free-ai');network.mockClear();expect(await free.runFreeAi(env,task)).toBeUndefined();expect(network).not.toHaveBeenCalled();
  db.prepare("UPDATE meta SET key='free-ai:day:2000-01-01'").run();expect(await free.runFreeAi(env,task)).toEqual({ok:true});
 });
 it('fails closed if persistent budget storage is unavailable',async()=>{expect(await free.runFreeAi({} as Env,task)).toBeUndefined();expect(network).not.toHaveBeenCalled();});
 it('settings default and restoration preserve encrypted custom keys and can explicitly resume the saved connection',async()=>{
  const {publicConfig,saveConfig,getProviderKey,getConfig}=await import('../server/db');expect(await publicConfig(env)).toMatchObject({usingFreeAi:true,freeAiAvailable:true,configured:false});
  await saveConfig(env,{provider:'custom',baseUrl:'https://models.example.com/v1',model:'my-model',inputPricePerMillion:0,outputPricePerMillion:0,key:'synthetic-private-key',aiChannel:'own'});const cipher=db.prepare("SELECT json FROM settings WHERE id='key:custom'").get();
  expect(await publicConfig(env)).toMatchObject({usingFreeAi:false,configured:true});await saveConfig(env,{restoreDefaultAi:true});expect(await publicConfig(env)).toMatchObject({usingFreeAi:true,configured:true});expect(db.prepare("SELECT json FROM settings WHERE id='key:custom'").get()).toEqual(cipher);expect(await getProviderKey(env,'custom')).toBe('synthetic-private-key');expect((await getConfig(env)).aiChannel).toBe('free');
  const json=JSON.stringify(await publicConfig(env));expect(json).not.toMatch(/kepler|text\.pollinations|gpt-oss-20b|synthetic-private-key/);await saveConfig(env,{aiChannel:'own'});expect((await publicConfig(env)).usingFreeAi).toBe(false);expect(network).not.toHaveBeenCalled();
 });
 for(const language of ['zh','en','zh-TW','vi'] as const)it(`${language}: keyless preference generation validates output without disclosing endpoint/model`,async()=>{
  const questions=curatedQuestions(language);network.mockResolvedValue(response({questions}));const {generatePreferenceCards}=await import('../server/preference-cards');expect(await generatePreferenceCards(env,language)).toEqual({source:'ai',questions});expect(network).toHaveBeenCalledTimes(1);expect(db.prepare('SELECT COUNT(*) n FROM sources').get()).toEqual({n:0});expect(db.prepare("SELECT COUNT(*) n FROM settings WHERE id='profile:user'").get()).toEqual({n:0});expect(freeAiMessages[language].notice.length).toBeGreaterThan(80);
 });
 it('invalid preference IDs on both endpoints return the exact static bank',async()=>{
  const questions=curatedQuestions('en');questions[0].optionA.sourceIds=['invented' as any];network.mockImplementation(async()=>response({questions}));const {generatePreferenceCards}=await import('../server/preference-cards');expect(await generatePreferenceCards(env,'en')).toEqual({source:'curated',questions:curatedQuestions('en')});expect(network).toHaveBeenCalledTimes(2);
 });
 it('manual free reading caches validated summaries and automatic analysis never uses free AI',async()=>{
  const {analyzeItem,analyzePending}=await import('../server/ai');const item={id:'synthetic',sourceId:'rss',sourceName:'Synthetic',kind:'article',platform:'rss',title:'Synthetic title',url:'https://example.test/article',summary:'Synthetic summary',publishedAt:new Date().toISOString(),topics:['science']} as const;
  network.mockImplementation(async()=>response({bullets:['A supported point'],relevance:'Science',topics:['science'],references:[item.url]}));expect(await analyzePending(env,3,'owner')).toEqual({analyzed:0,remaining:0});expect(network).not.toHaveBeenCalled();const first=await analyzeItem(env,item as any);expect(first.analysis?.model).toBe('Free public channel');expect((await analyzeItem(env,item as any)).analysis).toEqual(first.analysis);expect(network).toHaveBeenCalledTimes(1);
 });
 it('free discovery, profile advice and import failure leave curated/plain paths available',async()=>{
  network.mockImplementation(async()=>new Response('',{status:503}));const {sourceDiscoveryConversation,assistSourceImport}=await import('../server/ai');const profile=createProfile('explorer','en');const reply=await sourceDiscoveryConversation(env,[{role:'user',content:'Science please'}],[{id:'science',name:'Science',platform:'rss',locator:'https://science.demo.net/rss.xml',topics:['science']}],profile);expect(reply).toEqual({message:freeAiMessages.en.fallback,ready:false,recommendedIds:[]});
  expect(await assistSourceImport(env,'Science',[])).toMatchObject({status:'completed',candidates:[],warnings:[freeAiMessages.zh.fallback]});const {generateProfileAdvice}=await import('../server/profile-advisor');expect(await generateProfileAdvice(env,'owner',{profile})).toEqual({needsConfiguration:true});expect(network).toHaveBeenCalledTimes(2);
 });
 it('free profile advice returns only validated advice and a public label',async()=>{
  const report={description:'Your weights favor science.',descriptionBasis:['interest_weights'],recommendations:[{title:'Explore science',detail:'Read one explanation.',topics:['science'],basis:['interest_weights']}],nextSteps:['Choose one article.']};network.mockImplementation(async()=>response(report));const {generateProfileAdvice}=await import('../server/profile-advisor');const result=await generateProfileAdvice(env,'never-send-owner',{profile:createProfile('explorer','en'),language:'en'});expect(result).toMatchObject({needsConfiguration:false,advice:report,model:'Free public channel'});const request=JSON.parse(network.mock.calls[0][1].body);expect(JSON.stringify(request)).not.toContain('never-send-owner');expect(network).toHaveBeenCalledTimes(1);
 });
 it('free catalog conversation accepts only catalog IDs; free import retains the ordinary validated preview',async()=>{
  const {sourceDiscoveryConversation,assistSourceImport}=await import('../server/ai');network.mockImplementation(async()=>response({message:'Try this science feed.',ready:true,recommendedIds:['science']}));expect(await sourceDiscoveryConversation(env,[{role:'user',content:'Science please'}],[{id:'science',name:'Science',platform:'rss',locator:'https://science.demo.net/rss.xml',topics:['science']}],createProfile('explorer','en'))).toMatchObject({ready:true,recommendedIds:['science']});
  now+=31_000;const candidate={id:'candidate-1',name:'Science',platform:'rss' as const,locator:'https://science.demo.net/rss.xml',topics:[],enabled:false,origin:'deterministic' as const};network.mockImplementation(async()=>response({candidates:[{candidateId:'candidate-1',name:'Science',platform:'rss',locator:candidate.locator,topics:['science'],evidence:'Science RSS'}]}));expect(await assistSourceImport(env,'Science RSS '+candidate.locator,[candidate])).toMatchObject({status:'completed',candidates:[{id:'candidate-1',topics:['science'],enabled:false}]});expect(db.prepare('SELECT COUNT(*) n FROM sources').get()).toEqual({n:0});
 });
 it('own-key failures never switch to the free endpoints or use an operator key',async()=>{
  const {saveConfig}=await import('../server/db');await saveConfig(env,{provider:'openai',key:'synthetic-own-private-key'});network.mockImplementation(async()=>new Response('',{status:429}));const {generatePreferenceCards}=await import('../server/preference-cards');expect((await generatePreferenceCards(env,'en')).source).toBe('curated');expect(network).toHaveBeenCalledTimes(1);expect(network.mock.calls[0][0]).toBe('https://api.openai.com/v1/responses');
 });
});
