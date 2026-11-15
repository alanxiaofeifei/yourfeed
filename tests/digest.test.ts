import {beforeEach,afterEach,describe,it,expect,vi} from 'vitest';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import type {Env} from '../server/db';
import type {ContentItem} from '../shared/types';
import {digestSchema,type DigestResponse} from '../shared/digest';

let env:Env,db:DatabaseSync,network:ReturnType<typeof vi.fn>,digest:typeof import('../server/digest'),api:typeof import('../server/api');
const now=new Date('2026-11-15T04:00:00Z');
const result={overview:'Three useful changes.',points:[{text:'Deployment has improved.',itemIds:['a']}]};
const news=(id:string,title:string):ContentItem=>({id,kind:'news',platform:'rss',sourceId:id,sourceName:'Synthetic '+id,title,url:`https://${id}.example.test/news`,summary:'Public synthetic summary '+id,body:'BODY_MUST_NOT_BE_SENT',publishedAt:'2026-11-15T01:00:00Z',topics:['ai','science']});
const items=[news('a','OpenAI launches GPT-6.1 model'),news('b','Claude enterprise deployment update'),news('c','DeepSeek API pricing update'),news('d','GLM API quota update')];
const response=(value:unknown=result,own=false)=>new Response(JSON.stringify(own?{output:[{content:[{type:'output_text',text:typeof value==='string'?value:JSON.stringify(value)}]}],usage:{input_tokens:1000,output_tokens:150}}:{choices:[{message:{content:typeof value==='string'?value:JSON.stringify(value)},finish_reason:'stop'}]}));
async function seed(rows=items){for(const item of rows)db.prepare('INSERT OR REPLACE INTO content(id,source_id,kind,url,json,updated_at) VALUES(?,?,?,?,?,?)').run(item.id,item.sourceId,item.kind,item.url,JSON.stringify(item),now.toISOString());}
async function own(){const {saveConfig}=await import('../server/db');await saveConfig(env,{provider:'openai',aiChannel:'own',key:'synthetic-private-own-key'});network.mockImplementation(async()=>response(result,true));}
const post=(user='owner',body:Record<string,unknown>={})=>digest.generateDigest(env,user,'en',body);
const request=(method='GET',body?:unknown,user='owner',language='en')=>new Request('https://digest.example.test/api/briefing/digest',{method,headers:{'Content-Type':'application/json','Accept-Language':language,'oai-authenticated-user-id':user},...(body?{body:JSON.stringify(body)}:{})});
function state(user='owner'){return JSON.parse((db.prepare('SELECT value FROM meta WHERE key=?').get(digest.digestKey(user)) as {value:string}).value);}
beforeEach(async()=>{
 vi.resetModules();vi.useFakeTimers();vi.setSystemTime(now);db=new DatabaseSync(':memory:');for(const name of readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())db.exec(readFileSync('drizzle/'+name,'utf8'));
 const prepare=(sql:string)=>{const stmt=db.prepare(sql);const bound=(args:any[])=>({first:async()=>stmt.get(...args)||null,run:async()=>({meta:{changes:Number(stmt.run(...args).changes)}}),all:async()=>({results:stmt.all(...args)})});return {bind:(...args:any[])=>bound(args),...bound([])};};
 env={DB:{prepare,batch:async(statements:any[])=>{db.exec('BEGIN');try{const result=await Promise.all(statements.map(s=>s.run()));db.exec('COMMIT');return result;}catch(error){db.exec('ROLLBACK');throw error;}}},AUTH_MODE:'sites',APP_ENCRYPTION_KEY:'12'.repeat(32)} as unknown as Env;
 network=vi.fn(async()=>response());vi.stubGlobal('fetch',network);digest=await import('../server/digest');api=await import('../server/api');await seed();
});
afterEach(()=>{vi.useRealTimers();vi.restoreAllMocks();vi.unstubAllGlobals();db.close();});

describe('explicit daily digest, real SQLite and mocked outbound network',()=>{
 it('GET is read-only even before initialize, returns none and never calls AI',async()=>{expect((await api.handleApi(request(),env)).status).toBe(200);expect(await (await api.handleApi(request(),env)).json()).toMatchObject({status:'none'});expect(db.prepare('SELECT count(*) n FROM meta').get()).toEqual({n:0});expect(network).not.toHaveBeenCalled();});
 it('sends only the selected three bounded fields, free channel shares existing daily quota, never sends URLs/body/user',async()=>{
  const picks=await api.handleApi(new Request('https://digest.example.test/api/briefing',{headers:{'oai-authenticated-user-id':'owner','Accept-Language':'en'}}),env);const chosen=(await picks.json() as any).items.map((row:any)=>row.item.id);
  const generated=await post();expect(generated.body.status).toBe('fresh');expect(network).toHaveBeenCalledTimes(1);expect(network.mock.calls[0][0]).toContain('ovh');
  const sent=JSON.parse(network.mock.calls[0][1].body);const wrapped=JSON.parse(sent.messages[1].content);const input=JSON.parse(wrapped.untrusted_task_data).untrusted_task_data;
  expect(input.map((row:any)=>row.id)).toEqual(chosen);expect(input).toHaveLength(3);expect(Object.keys(input[0]).sort()).toEqual(['id','title','sourceName','publishedAt','summary'].sort());expect(JSON.stringify(sent)).not.toMatch(/BODY_MUST_NOT_BE_SENT|example.test|digest-owner/);
  expect(db.prepare("SELECT value FROM meta WHERE key='free-ai:day:2026-11-15'").get()).toEqual({value:'1'});expect(db.prepare('SELECT count(*) n FROM reservations').get()).toEqual({n:0});
 });
 it('fresh GET and POST make zero additional calls, with one overwrite row per user',async()=>{await post();network.mockClear();expect(await digest.getDigest(env,'owner','en')).toMatchObject({status:'fresh'});expect((await post()).body.status).toBe('fresh');expect(network).not.toHaveBeenCalled();expect(db.prepare("SELECT count(*) n FROM meta WHERE key LIKE 'digest:v1:%'").get()).toEqual({n:1});});
 it.each(['date','content','ids','bullets','language','profile','channel','model'])('%s change marks stale without generating',async change=>{
  await post();network.mockClear();if(change==='date')vi.setSystemTime(new Date('2026-11-16T04:00:00Z'));
  if(change==='content'||change==='bullets'){const cached=state().digest.items[0];await seed([{...cached,...(change==='content'?{summary:'Changed summary'}:{analysis:{bullets:['Changed bullet'],relevance:'x',topics:['ai'],coverage:'excerpt',references:[],model:'old'}})}]);}
  if(change==='ids'){db.prepare('DELETE FROM content WHERE id=?').run(state().digest.items[0].id);}
  if(change==='profile')db.prepare('INSERT INTO settings(id,json) VALUES(?,?)').run('profile:user',JSON.stringify({...((await import('../shared/profile')).createProfile()),version:2}));
  if(change==='channel')await own();if(change==='model'){await own();await post('other');db.prepare("UPDATE settings SET json=json_set(json,'$.model','gpt-6.1-terra') WHERE id='profile:openai'").run();}
  network.mockClear();expect((await digest.getDigest(env,change==='model'?'other':'owner',change==='language'?'vi':'en')).status).toBe('stale');expect(network).not.toHaveBeenCalled();
 });
 it('force is throttled until 60s, failures also throttle; retry overwrites the same row',async()=>{await post();network.mockClear();expect(await post('owner',{force:true})).toMatchObject({status:429,body:{reason:'throttled',digest:{result}}});vi.setSystemTime(now.getTime()+59999);expect((await post('owner',{force:true})).status).toBe(429);expect(network).not.toHaveBeenCalled();vi.setSystemTime(now.getTime()+60000);expect((await post('owner',{force:true})).status).toBe(200);expect(network).toHaveBeenCalledTimes(1);expect(db.prepare("SELECT count(*) n FROM meta WHERE key='digest:v1:owner'").get()).toEqual({n:1});});
 it('atomic lock allows only one generation across concurrent requests',async()=>{
  let release!:(value:Response)=>void;network.mockImplementation(()=>new Promise<Response>(resolve=>release=resolve));const first=post();await vi.advanceTimersByTimeAsync(1);const second=await post();expect(second.status).toBe(429);expect(network).toHaveBeenCalledTimes(1);release(response());expect((await first).body.status).toBe('fresh');
 });
 it('lease survives the throttle boundary and crash recovery expires after 180s',async()=>{db.prepare('INSERT INTO meta VALUES(?,?)').run(digest.digestKey('owner'),JSON.stringify({nextAllowedAt:now.getTime()-1,leaseUntil:now.getTime()+1000,token:'old'}));expect((await post()).status).toBe(429);vi.setSystemTime(now.getTime()+1000);expect((await post()).status).toBe(200);});
 it.each([{overview:'Bad',points:[{text:'Invented',itemIds:['not-input']}]},{overview:'See https://evil.test',points:result.points},{overview:'Bad',points:[{text:'www.evil.test',itemIds:['a']}]},'not JSON',{overview:'x',points:[]},{overview:'Read mailto:reader@example.test',points:result.points},{overview:'Read //evil.test/path',points:result.points}])('rejects invalid JSON, IDs and URLs without caching: %j',async invalid=>{network.mockImplementation(async()=>response(invalid));const value=await post();expect(value.body.reason).toBe('invalid_output');expect(value.body.fallback?.label).toContain('not AI');expect(state().digest).toBeUndefined();expect((await post()).status).toBe(429);});
 it('drops sensitive picks before truncation, leaving only input IDs valid',async()=>{const a={...items[0],summary:'x'.repeat(450)+' sk-SECRET_SYNTHETIC_123456'};await seed([a]);const value=await post();const sent=JSON.stringify(network.mock.calls);expect(sent).not.toContain('sk-SECRET');expect(value.body.reason).toBe('invalid_output');});
 it.each(['Public note\naccess_token=synthetic-credential','Public note\npassword: synthetic-credential'])('drops sensitive assignments on a later line: %s',async summary=>{await seed([{...items[0],summary}]);const briefing={date:'2026-11-15',timeZone:'UTC',window:'today' as const,items:[{item:{...items[0],summary},reason:'',signal:''}]};expect(digest.digestInput(briefing)).toEqual([]);});
 it('bounds summary to 400 chars and never calls AI if every pick is unsafe or absent',async()=>{
  const picks={date:'2026-11-15',timeZone:'UTC',window:'today' as const,items:[{item:{...items[0],summary:'x'.repeat(800)},reason:'',signal:''}]};expect(digest.digestInput(picks)[0].summary).toHaveLength(400);
  await seed(items.map(item=>({...item,summary:'sk-SYNTHETIC_SECRET_12345678'})));expect((await post()).body.reason).toBe('sensitive');expect(network).not.toHaveBeenCalled();db.exec('DELETE FROM content');expect((await post()).body.reason).toBe('empty');expect(network).not.toHaveBeenCalled();
 });
 it('own-key generation reserves and settles actual usage in the existing ledger with bounded output',async()=>{await own();expect((await post()).body.digest).toMatchObject({channel:'own',model:'gpt-6.1-sol'});expect(db.prepare('SELECT content_id,status,input_tokens,output_tokens,cost FROM reservations').get()).toEqual({content_id:expect.stringMatching(/^digest-owner-2026-11-15-[0-9a-f-]{36}$/),status:'settled',input_tokens:1000,output_tokens:150,cost:.0035});expect(JSON.parse(network.mock.calls[0][1].body).max_output_tokens).toBe(900);expect(network).toHaveBeenCalledTimes(1);expect(network.mock.calls[0][0]).toContain('api.openai.com');});
 it('own invalid output still settles charged usage as failed and preserves old cache',async()=>{await own();await post();vi.setSystemTime(now.getTime()+60000);network.mockImplementation(async()=>response('invalid',true));const value=await post('owner',{force:true});expect(value.body.reason).toBe('invalid_output');expect(value.body.digest?.result).toEqual(result);expect(db.prepare("SELECT count(*) n FROM reservations WHERE status='failed' AND cost>0").get()).toEqual({n:1});});
 it('budget 429 falls back without provider calls or extra free quota',async()=>{await own();db.prepare("UPDATE settings SET json=json_set(json,'$.dailyLimit',0) WHERE id='config'").run();const value=await post();expect(value).toMatchObject({status:429,body:{reason:'budget',fallback:{}}});expect(network).not.toHaveBeenCalled();});
 it.each([401,402,429,500])('own provider %s falls back with settings reason, never switches to free',async status=>{await own();network.mockResolvedValue(new Response('private provider error',{status}));const value=await post();expect(value.body.reason).toBe('own_key');expect(value.body.fallback?.items).toHaveLength(3);expect(state().digest).toBeUndefined();expect(network).toHaveBeenCalledTimes(1);});
 it.each(['quota','rate','timeout'])('free %s falls back without caching',async kind=>{
  if(kind==='quota')db.prepare('INSERT INTO meta VALUES(?,?)').run('free-ai:day:2026-11-15','10');
  else if(kind==='rate')network.mockResolvedValue(new Response('',{status:429}));
  let started!:()=>void;const ready=new Promise<void>(resolve=>started=resolve);if(kind==='timeout')network.mockImplementation(()=>{started();return new Promise(()=>{});});
  const running=post();if(kind==='timeout'){await ready;await vi.advanceTimersByTimeAsync(8100);}const value=await running;expect(value.body.reason).toBe('free_unavailable');expect(value.body.fallback?.items).toHaveLength(3);expect(state().digest).toBeUndefined();if(kind==='quota')expect(network).not.toHaveBeenCalled();
 });
 it('own timeout retains uncertain reservation and offers fallback',async()=>{await own();network.mockRejectedValue(Error('synthetic timeout'));expect((await post()).body.reason).toBe('own_key');expect(db.prepare('SELECT status FROM reservations').get()).toEqual({status:'reserved'});});
 it.each(['throttled','budget','own_key','invalid_output','free_unavailable'])('failed regeneration %s returns the previous digest and notice without fallback',async reason=>{
  if(reason==='budget'||reason==='own_key')await own();
  await post();const previous=state().digest;network.mockClear();
  if(reason!=='throttled')vi.setSystemTime(now.getTime()+60000);
  if(reason==='budget')db.prepare("UPDATE settings SET json=json_set(json,'$.dailyLimit',0) WHERE id='config'").run();
  if(reason==='own_key')network.mockResolvedValue(new Response('',{status:401}));
  if(reason==='invalid_output')network.mockImplementation(async()=>response('invalid'));
  if(reason==='free_unavailable')db.prepare("UPDATE meta SET value='10' WHERE key='free-ai:day:2026-11-15'").run();
  const value=await post('owner',{force:true});
  expect(value.body).toMatchObject({reason,digest:previous,message:expect.any(String)});expect(value.body.fallback).toBeUndefined();expect(state().digest).toEqual(previous);
 });
 it.each(['Node.js','Next.js','driver.js','GPT-4.1'])('accepts dotted tech name %s in overview and points',name=>{
  expect(digestSchema.parse({overview:name,points:[{text:`Use ${name} today.`,itemIds:['a']}]}).overview).toBe(name);
 });
 it.each(['https://example.com','http://example.com','www.example.com','example.com/path','foo.co','node.js.com/path','https://Node.js'])('rejects link %s in overview and points',url=>{
  expect(digestSchema.safeParse({...result,overview:`Read ${url}`} ).success).toBe(false);
  expect(digestSchema.safeParse({...result,points:[{text:`Read ${url}`,itemIds:['a']}]}).success).toBe(false);
 });
 it('retries an uncertain own-key attempt after the lease, preserving its held budget and settling only the new attempt',async()=>{
  await own();network.mockRejectedValueOnce(Error('synthetic timeout'));expect((await post()).body.reason).toBe('own_key');
  const held=db.prepare('SELECT * FROM reservations').get()!;vi.setSystemTime(now.getTime()+180000);
  const retried=await post();expect(retried.body.status).toBe('fresh');expect(retried.body.reason).toBeUndefined();expect(network).toHaveBeenCalledTimes(2);
  const rows=db.prepare('SELECT * FROM reservations ORDER BY created_at').all();expect(rows).toHaveLength(2);expect(rows[0]).toEqual(held);expect(rows[1].content_id).not.toBe(held.content_id);expect(rows[1]).toMatchObject({status:'settled',reserved_cost:.0035,cost:.0035,input_tokens:1000,output_tokens:150});
  expect(await (await import('../server/db')).getUsage(env)).toMatchObject({cost:.0035,reserved:held.reserved_cost,analyzedToday:2});
 });
 it.each(['daily','monthly'])('uncertain own-key usage still enforces the %s budget on a new attempt',async limit=>{
  await own();network.mockRejectedValueOnce(Error('synthetic timeout'));await post();
  const held=db.prepare('SELECT * FROM reservations').get()!;const field=limit==='daily'?'dailyLimit':'monthlyBudget';const bound=limit==='daily'?1:held.reserved_cost;
  db.prepare("UPDATE settings SET json=json_set(json,?,?) WHERE id='config'").run('$.'+field,bound);
  vi.setSystemTime(now.getTime()+180000);expect((await post()).body.reason).toBe('budget');expect(network).toHaveBeenCalledTimes(1);expect(db.prepare('SELECT * FROM reservations').all()).toEqual([held]);
 });
 it('two user IDs have isolated caches and throttle state',async()=>{await post('first');expect((await digest.getDigest(env,'second','en')).status).toBe('none');vi.setSystemTime(now.getTime()+31000);expect((await post('second',{language:'vi'})).body.digest?.language).toBe('vi');expect((await digest.getDigest(env,'first','en')).digest?.language).toBe('en');expect(db.prepare("SELECT count(*) n FROM meta WHERE key LIKE 'digest:v1:%'").get()).toEqual({n:2});});
 it.each(['zh-CN','zh-TW','en','vi'])('POST %s body overrides header and GET never regenerates',async language=>{const generated=await api.handleApi(request('POST',{language}),env);const value=await generated.json() as DigestResponse;expect(value.digest?.language).toBe(language==='zh-CN'?'zh':language);expect(JSON.stringify(network.mock.calls)).toContain(({ 'zh-CN':'Simplified Chinese','zh-TW':'Traditional Chinese (Taiwan)',en:'English',vi:'Vietnamese'})[language]);network.mockClear();expect((await api.handleApi(request('GET',undefined,'owner',language),env)).status).toBe(200);expect(network).not.toHaveBeenCalled();});
 it('anonymous and cross-origin writes remain rejected',async()=>{expect((await api.handleApi(new Request('https://digest.example.test/api/briefing/digest'),env)).status).toBe(401);expect((await api.handleApi(new Request('https://digest.example.test/api/briefing/digest',{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://other.example.test','oai-authenticated-user-id':'owner'},body:'{}'}),env)).status).toBe(403);expect(network).not.toHaveBeenCalled();});
 it('never logs keys, prompt, replies or source content on success or failure',async()=>{const spies=['log','info','warn','error','debug'].map(method=>vi.spyOn(console,method as 'log').mockImplementation(()=>{}));await own();await post();vi.setSystemTime(now.getTime()+60000);network.mockRejectedValue(Error('sk-SECRET model reply Public synthetic summary'));await post('owner',{force:true});for(const spy of spies)expect(spy).not.toHaveBeenCalled();});
});
