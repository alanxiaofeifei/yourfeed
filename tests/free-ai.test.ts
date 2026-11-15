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
afterEach(()=>{vi.useRealTimers();vi.restoreAllMocks();vi.unstubAllGlobals();db.close();});

describe('keyless free channel with real SQLite budgets and mocked network',()=>{
 it('keeps 30-second OVH spacing after successful tasks',async()=>{
  const start=now;expect(await free.runFreeAi(env,task)).toEqual({ok:true});
  now=start+2001;expect(await free.runFreeAi(env,task)).toEqual({ok:true});
  now=start+29999;expect(await free.runFreeAi(env,task)).toBeUndefined();
  expect(network.mock.calls.map(call=>call[0])).toEqual([expect.stringContaining('ovh'),expect.stringContaining('pollinations')]);
  now=start+30000;expect(await free.runFreeAi(env,task)).toEqual({ok:true});
  expect(network.mock.calls[2][0]).toContain('ovh');
 });
 it('constructs only the two fixed official keyless JSON requests and strips reasoning',async()=>{
  for(const endpoint of ['ovh','pollinations'] as const){const request=free.buildFreeAiRequest(endpoint,'system','prompt');const body=JSON.parse(request.init.body);expect(request.init.headers).toEqual({'Content-Type':'application/json'});expect(request.init.redirect).toBe('manual');expect(body).toMatchObject({max_tokens:4096,response_format:{type:'json_object'},stream:false});expect(body.model).toBe(endpoint==='ovh'?'gpt-oss-20b':'openai');expect(request.url).toBe(endpoint==='ovh'?'https://oai.endpoints.kepler.ai.cloud.ovh.net/v1/chat/completions':'https://text.pollinations.ai/v1/chat/completions');}
  const ovh=JSON.parse(free.buildFreeAiRequest('ovh','system','prompt').init.body),pollinations=JSON.parse(free.buildFreeAiRequest('pollinations','system','prompt').init.body);
  expect(ovh.reasoning_effort).toBe('low');expect(pollinations).toEqual({model:'openai',stream:false,max_tokens:4096,response_format:{type:'json_object'},messages:[{role:'system',content:'system'},{role:'user',content:'prompt'}]});
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
 for(const kind of ['retry seconds','retry date','reset delay','reset epoch','reset date','x-reset epoch','latest header','minimum','invalid'])it(`OVH 429 cooldown honors ${kind} through the exact retry boundary`,async()=>{
  now=Math.floor(now/1000)*1000;const start=now;
  const headers:Record<string,string>=kind==='retry seconds'?{'Retry-After':'120'}:kind==='retry date'?{'Retry-After':new Date(now+120_000).toUTCString()}:kind==='reset delay'?{'ratelimit-reset':'120'}:kind==='reset epoch'?{'ratelimit-reset':String(now/1000+120)}:kind==='reset date'?{'ratelimit-reset':new Date(now+120_000).toUTCString()}:kind==='x-reset epoch'?{'x-ratelimit-reset':String(now/1000+120)}:kind==='latest header'?{'Retry-After':'60','ratelimit-reset':'120'}:kind==='minimum'?{'Retry-After':'1','ratelimit-reset':'0'}:{'Retry-After':'invalid','ratelimit-reset':'invalid'};
  const cooldown=kind==='minimum'?30_000:kind==='invalid'?60_000:120_000;
  network.mockResolvedValueOnce(new Response('private rate-limit error',{status:429,headers}));expect(await free.runFreeAi(env,task)).toEqual({ok:true});
  now=start+cooldown-1;await free.runFreeAi(env,task);expect(network.mock.calls.filter(call=>call[0].includes('ovh'))).toHaveLength(1);
  now=start+cooldown;expect(await free.runFreeAi(env,task)).toEqual({ok:true});expect(network.mock.calls.filter(call=>call[0].includes('ovh'))).toHaveLength(2);
 });
 for(const bad of ['invalid-json','invalid-shape','empty','truncated','oversized'])it(`validates ${bad} before accepting either provider`,async()=>{
  network.mockImplementationOnce(async()=>bad==='invalid-json'?new Response('not json'):bad==='invalid-shape'?response({ok:false}):bad==='empty'?response({}, {choices:[{message:{content:'',reasoning:'only reasoning'}}]}):bad==='truncated'?response({ok:true},{choices:[{message:{content:'{}'},finish_reason:'length'}]}):new Response('x'.repeat(256001)));
  expect(await free.runFreeAi(env,task)).toEqual({ok:true});expect(network).toHaveBeenCalledTimes(2);
 });
 for(const stalled of ['fetch','body'])for(const timeoutSeconds of [undefined,8])it(`${stalled}: OVH gets six seconds, backup the remaining two, within eight total (${timeoutSeconds??'default'})`,async()=>{
  vi.useFakeTimers();vi.setSystemTime(now);network.mockImplementation(async()=>stalled==='fetch'?new Promise(()=>{}):new Response(new ReadableStream({start(){}})));
  let settled=false;const result=free.runFreeAi(env,{...task,timeoutSeconds}).then(value=>{settled=true;return value;});
  await vi.advanceTimersByTimeAsync(5999);expect(network).toHaveBeenCalledTimes(1);expect(settled).toBe(false);expect(network.mock.calls[0][1].signal.aborted).toBe(false);
  await vi.advanceTimersByTimeAsync(1);expect(network).toHaveBeenCalledTimes(2);expect(network.mock.calls[0][1].signal.aborted).toBe(true);expect(network.mock.calls[1][0]).toContain('pollinations');
  await vi.advanceTimersByTimeAsync(1999);expect(settled).toBe(false);expect(network.mock.calls[1][1].signal.aborted).toBe(false);
  await vi.advanceTimersByTimeAsync(1);expect(await result).toBeUndefined();expect(network.mock.calls[1][1].signal.aborted).toBe(true);expect(network).toHaveBeenCalledTimes(2);
 });
 it('never exceeds a shorter caller deadline or starts a backup after it',async()=>{
  vi.useFakeTimers();vi.setSystemTime(now);network.mockImplementation(()=>new Promise(()=>{}));const result=free.runFreeAi(env,{...task,timeoutSeconds:.12});
  await vi.advanceTimersByTimeAsync(120);expect(await result).toBeUndefined();expect(network).toHaveBeenCalledTimes(1);expect(network.mock.calls[0][1].signal.aborted).toBe(true);
 });
 it('accepts the observed 3.3-second OVH preference reply without switching providers',async()=>{
  const {generatePreferenceCards}=await import('../server/preference-cards');const questions=curatedQuestions('en');vi.useFakeTimers();vi.setSystemTime(now);
  let release!:()=>void;const started=new Promise<void>(resolve=>release=resolve);
  network.mockImplementation(async()=>{release();await new Promise(resolve=>setTimeout(resolve,3300));return response({questions});});const result=generatePreferenceCards(env,'en');await started;
  await vi.advanceTimersByTimeAsync(3299);expect(network).toHaveBeenCalledTimes(1);expect(network.mock.calls[0][1].signal.aborted).toBe(false);
  await vi.advanceTimersByTimeAsync(1);expect(await result).toEqual({source:'ai',questions});expect(network).toHaveBeenCalledTimes(1);
 });
 it('preference generation waits six seconds for OVH and accepts backup within the eight-second budget',async()=>{
  const {generatePreferenceCards}=await import('../server/preference-cards');const questions=curatedQuestions('en');vi.useFakeTimers();vi.setSystemTime(now);
  let release!:()=>void;const started=new Promise<void>(resolve=>release=resolve);
  network.mockImplementationOnce(()=>{release();return new Promise(()=>{});}).mockImplementationOnce(async()=>{await new Promise(resolve=>setTimeout(resolve,1500));return response({questions});});
  let settled=false;const result=generatePreferenceCards(env,'en').then(value=>{settled=true;return value;});await started;
  await vi.advanceTimersByTimeAsync(5999);expect(network).toHaveBeenCalledTimes(1);expect(settled).toBe(false);
  await vi.advanceTimersByTimeAsync(1);expect(network).toHaveBeenCalledTimes(2);expect(network.mock.calls[0][1].signal.aborted).toBe(true);
  await vi.advanceTimersByTimeAsync(1499);expect(settled).toBe(false);
  await vi.advanceTimersByTimeAsync(1);expect(await result).toEqual({source:'ai',questions});expect(network.mock.calls[1][0]).toContain('pollinations');
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

describe('operator supplement, mocked network only',()=>{
 const key='synthetic-operator-secret-DO-NOT-EXPOSE';
 const models=()=>network.mock.calls.map(call=>JSON.parse(call[1].body).model);
 const enable=()=>{env.FREE_AI_GROQ_API_KEY=key;};
 it('uses 120b for two successful tasks more than two seconds apart',async()=>{
  enable();expect(await free.runFreeAi(env,task)).toEqual({ok:true});
  now+=2001;expect(await free.runFreeAi(env,task)).toEqual({ok:true});
  expect(models()).toEqual(['openai/gpt-oss-120b','openai/gpt-oss-120b']);
  expect(db.prepare("SELECT value FROM meta WHERE key LIKE 'free-ai:day:%'").get()).toEqual({value:'2'});
 });
 it('keeps successful Groq tasks spaced by two seconds',async()=>{
  enable();const start=now;await free.runFreeAi(env,task);
  now=start+1999;await free.runFreeAi(env,task);expect(models()).toEqual(['openai/gpt-oss-120b','gpt-oss-20b']);
  now=start+2000;await free.runFreeAi(env,task);expect(models()).toEqual(['openai/gpt-oss-120b','gpt-oss-20b','openai/gpt-oss-120b']);
 });
 for(const prompt of ['x'.repeat(20000),'中'.repeat(7000)])it(`skips Groq for an oversized ${prompt[0]==='x'?'ASCII':'UTF-8'} prompt without cooling it down`,async()=>{
  enable();expect(await free.runFreeAi(env,{...task,prompt})).toEqual({ok:true});
  expect(models()).toEqual(['gpt-oss-20b']);
  expect(await free.runFreeAi(env,task)).toEqual({ok:true});
  now+=2000;expect(await free.runFreeAi(env,task)).toEqual({ok:true});
  expect(models()).toEqual(['gpt-oss-20b','openai/gpt-oss-120b','openai/gpt-oss-120b']);
  expect(db.prepare("SELECT value FROM meta WHERE key LIKE 'free-ai:day:%'").get()).toEqual({value:'3'});
 });
 it('uses a realistic input token estimate and keeps two-second spacing when the token budget is sufficient',async()=>{
  enable();const start=now;
  network.mockImplementation(async()=>new Response(await response().text(),{headers:{'x-ratelimit-remaining-tokens':'6000','x-ratelimit-reset-requests':'24h','x-ratelimit-reset-tokens':'5s'}}));
  const mediumTask={...task,prompt:'x'.repeat(10000)};
  expect(await free.runFreeAi(env,mediumTask)).toEqual({ok:true});
  now=start+1999;await free.runFreeAi(env,task);expect(models()).toEqual(['openai/gpt-oss-120b','gpt-oss-20b']);
  now=start+2000;expect(await free.runFreeAi(env,mediumTask)).toEqual({ok:true});
  expect(models()).toEqual(['openai/gpt-oss-120b','gpt-oss-20b','openai/gpt-oss-120b']);
 });
 it('preserves the remaining-requests zero cooldown after a successful response',async()=>{
  enable();const start=now;
  network.mockImplementationOnce(async()=>new Response(await response().text(),{headers:{'x-ratelimit-remaining-requests':'0','x-ratelimit-reset-requests':'2m'}}));
  expect(await free.runFreeAi(env,task)).toEqual({ok:true});
  now=start+2001;expect(await free.runFreeAi(env,task)).toEqual({ok:true});
  expect(models()).toEqual(['openai/gpt-oss-120b','openai/gpt-oss-20b']);
  now=start+119999;await free.runFreeAi(env,task);expect(models().filter(model=>model==='openai/gpt-oss-120b')).toHaveLength(1);
  now=start+120000;await free.runFreeAi(env,task);expect(models().filter(model=>model==='openai/gpt-oss-120b')).toHaveLength(2);
 });
 it('preserves byte-for-byte anonymous request construction and order without the secret',async()=>{
  network.mockResolvedValueOnce(new Response('',{status:503}));await free.runFreeAi(env,task);
  expect(network).toHaveBeenCalledTimes(2);
  for(const [index,endpoint] of (['ovh','pollinations'] as const).entries()){
   const expected=free.buildFreeAiRequest(endpoint,task.instructions+' Return only a JSON object matching this task.',task.prompt);
   expect(network.mock.calls[index]).toEqual([expected.url,{...expected.init,signal:expect.any(AbortSignal)}]);
   expect(expected.init.body).toBe(JSON.stringify({model:endpoint==='ovh'?'gpt-oss-20b':'openai',...(endpoint==='ovh'?{reasoning_effort:'low'}:{}),stream:false,max_tokens:4096,response_format:{type:'json_object'},messages:[{role:'system',content:task.instructions+' Return only a JSON object matching this task.'},{role:'user',content:task.prompt}]}));
  }
 });
 it('starts with 120b, keeps credentials only in the outbound header, and reserves one daily attempt',async()=>{
  enable();expect(await free.runFreeAi(env,task)).toEqual({ok:true});expect(network).toHaveBeenCalledTimes(1);
  const [url,init]=network.mock.calls[0];expect(url).toBe('https://api.groq.com/openai/v1/chat/completions');
  expect(init).toMatchObject({method:'POST',redirect:'manual',headers:{'Content-Type':'application/json',Authorization:'Bearer '+key}});
  expect(JSON.parse(init.body)).toEqual({model:'openai/gpt-oss-120b',reasoning_effort:'low',stream:false,max_tokens:2048,response_format:{type:'json_object'},messages:[{role:'system',content:task.instructions+' Return only a JSON object matching this task.'},{role:'user',content:task.prompt}]});
  expect(init.body).not.toContain(key);expect(db.prepare("SELECT value FROM meta WHERE key LIKE 'free-ai:day:%'").get()).toEqual({value:'1'});
 });
 it('120b 429 tries 20b with the same bounded authenticated request',async()=>{
  enable();network.mockResolvedValueOnce(new Response('',{status:429}));expect(await free.runFreeAi(env,task)).toEqual({ok:true});
  expect(models()).toEqual(['openai/gpt-oss-120b','openai/gpt-oss-20b']);
  const first=network.mock.calls[0][1],second=network.mock.calls[1][1];expect(second.headers).toEqual(first.headers);expect(second.redirect).toBe('manual');expect(JSON.parse(second.body)).toEqual({...JSON.parse(first.body),model:'openai/gpt-oss-20b'});
 });
 it('reserves Groq in-flight slots without enabling 20b for ordinary concurrency',async()=>{
  enable();let release!:()=>void;const ready=new Promise<void>(resolve=>release=resolve);
  network.mockImplementation(async()=>{await ready;return response();});const running=Array.from({length:12},()=>free.runFreeAi(env,task));
  await new Promise(resolve=>setTimeout(resolve,20));expect(models()).toEqual(['openai/gpt-oss-120b','gpt-oss-20b','openai']);
  release();await Promise.all(running);expect(network).toHaveBeenCalledTimes(3);expect(db.prepare("SELECT value FROM meta WHERE key LIKE 'free-ai:day:%'").get()).toEqual({value:'10'});
 });
 it('both Groq models limited fall through to public endpoints and count only once',async()=>{
  enable();network.mockImplementationOnce(async()=>new Response('',{status:429})).mockImplementationOnce(async()=>new Response('',{status:429})).mockImplementationOnce(async()=>new Response('',{status:503}));
  expect(await free.runFreeAi(env,task)).toEqual({ok:true});expect(models()).toEqual(['openai/gpt-oss-120b','openai/gpt-oss-20b','gpt-oss-20b','openai']);
  expect(network.mock.calls[2][1].headers).toEqual({'Content-Type':'application/json'});expect(network.mock.calls[3][1].headers).toEqual({'Content-Type':'application/json'});
  expect(db.prepare("SELECT value FROM meta WHERE key LIKE 'free-ai:day:%'").get()).toEqual({value:'1'});
 });
 for(const status of [302,400,401,402,500,503])it(`120b ${status} skips 20b, including subsequent calls in cooldown`,async()=>{
  enable();network.mockResolvedValueOnce(new Response(key,{status,headers:{'Retry-After':'120','x-ratelimit-remaining-requests':'0'}}));
  await free.runFreeAi(env,task);now+=31_000;await free.runFreeAi(env,task);
  expect(models()).toEqual(['openai/gpt-oss-120b','gpt-oss-20b','gpt-oss-20b']);
 });
 for(const kind of ['network','invalid','vendor error','truncated'])it(`120b ${kind} skips 20b and suppresses diagnostics`,async()=>{
  enable();network.mockImplementationOnce(async()=>{if(kind==='network')throw Error(key+' '+task.prompt);return kind==='invalid'?new Response('invalid'):kind==='vendor error'?response({ok:true},{error:{message:key}}):response({ok:true},{choices:[{message:{content:'{}'},finish_reason:'length'}]});});
  expect(await free.runFreeAi(env,task)).toEqual({ok:true});expect(models()).toEqual(['openai/gpt-oss-120b','gpt-oss-20b']);
 });
 for(const [headers,delay] of [
  [{'x-ratelimit-reset-requests':'1m26.4s'},86400],
  [{'x-ratelimit-reset-tokens':'5.475s'},30000],
  [{'x-ratelimit-reset-tokens':'250ms'},30000],
  [{'x-ratelimit-reset-tokens':'31000000us'},31000],
  [{'x-ratelimit-reset-tokens':'31000000µs'},31000],
  [{'x-ratelimit-reset-tokens':'31000000000ns'},31000],
  [{'x-ratelimit-reset-tokens':'30s1000us1000µs1000000ns'},30003],
  [{'Retry-After':'100','x-ratelimit-reset-requests':'1m26.4s','x-ratelimit-reset-tokens':'2m'},120000],
  [{'Retry-After':'45','x-ratelimit-remaining-tokens':'0','x-ratelimit-reset-requests':'24h','x-ratelimit-reset-tokens':'5s'},45000],
  [{'Retry-After':'45','x-ratelimit-remaining-requests':'0','x-ratelimit-reset-requests':'1m','x-ratelimit-reset-tokens':'24h'},60000],
  [{'Retry-After':'45','x-ratelimit-remaining-requests':'0','x-ratelimit-remaining-tokens':'0','x-ratelimit-reset-requests':'1m','x-ratelimit-reset-tokens':'2m'},120000],
  [{'x-ratelimit-reset-requests':'invalid','x-ratelimit-reset-tokens':'-1s'},60000],
 ] as [Record<string,string>,number][])it(`Groq limit duration headers respect exact ${delay}ms boundary: ${JSON.stringify(headers)}`,async()=>{
  enable();const start=now;network.mockResolvedValueOnce(new Response('',{status:429,headers}));await free.runFreeAi(env,task);
  now=start+delay-1;await free.runFreeAi(env,task);expect(models().filter(model=>model==='openai/gpt-oss-120b')).toHaveLength(1);
  now=start+delay;await free.runFreeAi(env,task);expect(models().filter(model=>model==='openai/gpt-oss-120b')).toHaveLength(2);
 });
 for(const status of [200,429,503])for(const header of ['x-ratelimit-remaining-requests','x-ratelimit-remaining-tokens'])it(`preemptive ${header} cooldown on ${status}, enables 20b only for actual limits`,async()=>{
  enable();const start=now;const headers={[header]:header.endsWith('requests')?'0':'2047','x-ratelimit-reset-requests':'2m','x-ratelimit-reset-tokens':'5.475s'};
  network.mockImplementationOnce(async()=>new Response(status===200?await response().text():'',{status,headers}));await free.runFreeAi(env,task);
  const delay=header.endsWith('requests')?120000:30000;
  now=start+delay-1;await free.runFreeAi(env,task);expect(models().filter(model=>model==='openai/gpt-oss-120b')).toHaveLength(1);
  expect(models().includes('openai/gpt-oss-20b')).toBe(status!==503);
  now=start+delay;await free.runFreeAi(env,task);expect(models().filter(model=>model==='openai/gpt-oss-120b')).toHaveLength(2);
 });
 for(const kind of ['invalid body','invalid task'])it(`a preemptively limited 200 with ${kind} skips 20b for this and subsequent tasks`,async()=>{
  enable();const start=now;
  network.mockImplementationOnce(async()=>new Response(kind==='invalid body'?'invalid':await response({ok:false}).text(),{headers:{'x-ratelimit-remaining-requests':'0','x-ratelimit-reset-requests':'2m'}}));
  expect(await free.runFreeAi(env,task)).toEqual({ok:true});expect(models()).toEqual(['openai/gpt-oss-120b','gpt-oss-20b']);
  now=start+31000;await free.runFreeAi(env,task);
  expect(models()).toEqual(['openai/gpt-oss-120b','gpt-oss-20b','gpt-oss-20b']);
 });
 it('retains independent model cooldowns and retries 20b at its reset while 120b remains limited',async()=>{
  enable();const start=now;network.mockResolvedValueOnce(new Response('',{status:429,headers:{'x-ratelimit-reset-requests':'5m'}})).mockResolvedValueOnce(new Response('',{status:429,headers:{'x-ratelimit-reset-tokens':'2m'}}));
  await free.runFreeAi(env,task);now=start+119999;await free.runFreeAi(env,task);expect(models().filter(model=>model==='openai/gpt-oss-20b')).toHaveLength(1);
  now=start+120000;await free.runFreeAi(env,task);expect(models().filter(model=>model==='openai/gpt-oss-20b')).toHaveLength(2);expect(models().filter(model=>model==='openai/gpt-oss-120b')).toHaveLength(1);
 });
 for(const stalled of ['fetch','body'])it(`120b stalled ${stalled} stops at four seconds, skips 20b and leaves public fallback time`,async()=>{
  enable();vi.useFakeTimers();vi.setSystemTime(now);network.mockImplementation(async()=>stalled==='fetch'?new Promise(()=>{}):new Response(new ReadableStream({start(){}})));
  const running=free.runFreeAi(env,task);await vi.advanceTimersByTimeAsync(3999);expect(network).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1);expect(models()).toEqual(['openai/gpt-oss-120b','gpt-oss-20b']);expect(network.mock.calls[0][1].signal.aborted).toBe(true);
  await vi.advanceTimersByTimeAsync(3000);expect(models()).toEqual(['openai/gpt-oss-120b','gpt-oss-20b','openai']);
  await vi.advanceTimersByTimeAsync(1000);expect(await running).toBeUndefined();expect(network.mock.calls.every(call=>call[1].signal.aborted)).toBe(true);
 });
 it('bounds two slow Groq attempts to six seconds combined and retains both public fallbacks within eight',async()=>{
  enable();vi.useFakeTimers();vi.setSystemTime(now);
  network.mockImplementationOnce(async()=>{await new Promise(resolve=>setTimeout(resolve,3999));return new Response('',{status:429});}).mockImplementation(()=>new Promise(()=>{}));
  const running=free.runFreeAi(env,task);await vi.advanceTimersByTimeAsync(3999);expect(models()).toEqual(['openai/gpt-oss-120b','openai/gpt-oss-20b']);
  await vi.advanceTimersByTimeAsync(2001);expect(models()).toEqual(['openai/gpt-oss-120b','openai/gpt-oss-20b','gpt-oss-20b']);expect(network.mock.calls[1][1].signal.aborted).toBe(true);
  await vi.advanceTimersByTimeAsync(1000);expect(models()).toHaveLength(4);await vi.advanceTimersByTimeAsync(1000);expect(await running).toBeUndefined();
 });
 it('never exceeds shorter caller deadlines with the supplement enabled',async()=>{
  enable();vi.useFakeTimers();vi.setSystemTime(now);network.mockImplementation(()=>new Promise(()=>{}));const running=free.runFreeAi(env,{...task,timeoutSeconds:.12});
  await vi.advanceTimersByTimeAsync(120);expect(await running).toBeUndefined();expect(models()).toEqual(['openai/gpt-oss-120b','gpt-oss-20b','openai']);expect(network.mock.calls.every(call=>call[1].signal.aborted)).toBe(true);
 });
 it('does not log or throw provider errors, secrets, prompts or replies',async()=>{
  enable();const spies=['log','info','warn','error','debug'].map(method=>vi.spyOn(console,method as 'log').mockImplementation(()=>{}));
  expect(await free.runFreeAi(env,task)).toEqual({ok:true});now+=31000;network.mockRejectedValue(Error(key+' '+task.prompt+' private reply'));
  await expect(free.runFreeAi(env,task)).resolves.toBeUndefined();for(const spy of spies)expect(spy).not.toHaveBeenCalled();
 });
 it('operator secret does not configure any own connection, affect settings JSON or enable automatic AI',async()=>{
  const {publicConfig,getProviderKey,PROVIDERS,saveConfig}=await import('../server/db');const baseline=await publicConfig(env);enable();
  expect(await publicConfig(env)).toEqual(baseline);expect(baseline).toMatchObject({usingFreeAi:true,configured:false});
  for(const provider of PROVIDERS)expect(await getProviderKey(env,provider)).toBeUndefined();
  await saveConfig(env,{aiChannel:'own'});expect(await publicConfig(env)).toMatchObject({usingFreeAi:true,configured:false});
  const {analyzePending}=await import('../server/ai');expect(await analyzePending(env,3,'owner')).toEqual({analyzed:0,remaining:0});expect(network).not.toHaveBeenCalled();
  const {generatePreferenceCards}=await import('../server/preference-cards');network.mockImplementation(async()=>response({questions:curatedQuestions('en')}));expect((await generatePreferenceCards(env,'en')).source).toBe('ai');expect(models()).toEqual(['openai/gpt-oss-120b']);
 });
 it('operator secret does not override a selected own connection',async()=>{
  enable();const {saveConfig}=await import('../server/db');await saveConfig(env,{provider:'openai',key:'synthetic-own-private-key',aiChannel:'own'});
  network.mockResolvedValue(new Response('',{status:429}));const {generatePreferenceCards}=await import('../server/preference-cards');expect((await generatePreferenceCards(env,'en')).source).toBe('curated');expect(network).toHaveBeenCalledTimes(1);expect(network.mock.calls[0][0]).toContain('api.openai.com');expect(network.mock.calls[0][1].headers.Authorization).not.toContain(key);
 });
 it('probe does nothing without configuration and only returns minimal status when configured',async()=>{
  expect(await free.probeFreeGroq(env)).toEqual({configured:false,ok:false});expect(network).not.toHaveBeenCalled();enable();
  network.mockResolvedValueOnce(new Response(key,{status:200})).mockResolvedValueOnce(new Response(key,{status:429}));
  expect(await free.probeFreeGroq(env)).toEqual({configured:true,ok:true,status:200});expect(await free.probeFreeGroq(env)).toEqual({configured:true,ok:false,status:429});
  expect(network.mock.calls[0]).toEqual(['https://api.groq.com/openai/v1/models',{method:'GET',headers:{Authorization:'Bearer '+key},redirect:'manual',signal:expect.any(AbortSignal)}]);
  expect(db.prepare("SELECT COUNT(*) n FROM meta WHERE key LIKE 'free-ai:day:%'").get()).toEqual({n:0});
 });
 it('probe suppresses thrown diagnostics and stops at four seconds',async()=>{
  enable();network.mockRejectedValueOnce(Error(key));expect(await free.probeFreeGroq(env)).toEqual({configured:true,ok:false});
  vi.useFakeTimers();network.mockImplementation(()=>new Promise(()=>{}));const running=free.probeFreeGroq(env);await vi.advanceTimersByTimeAsync(4000);expect(await running).toEqual({configured:true,ok:false});expect(network.mock.calls[1][1].signal.aborted).toBe(true);
 });
});
