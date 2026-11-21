import {afterAll,beforeAll,beforeEach,describe,it,expect} from 'vitest';
import {Miniflare} from 'miniflare';
import {build} from 'esbuild';
import {readFileSync,readdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {tenantEnvironment} from '../server/tenant-env';
import {decryptSecret} from '../server/security';
import {fixtureOtp} from '../server/multi-accounts';
import {signupMailto,signupMessages} from '../shared/signup';
import type {Env} from '../server/db';
const origin='https://yourfeed-app-preview.alan-xiaofei224.workers.dev';
let mf:Miniflare,db:Awaited<ReturnType<Miniflare['getD1Database']>>;
const outbound:string[]=[];
let seq=0;
async function api(path:string,body?:unknown,cookie='',language='en'){
 const response=await mf.dispatchFetch(origin+path,{method:body===undefined?'GET':'POST',headers:{origin,'Content-Type':'application/json',cookie,'Accept-Language':language,'cf-connecting-ip':'203.0.113.'+(++seq)},body:body===undefined?undefined:JSON.stringify(body)});
 return response;
}
const send=(email:string)=>api('/api/auth/email-otp/send-verification-otp',{email,type:'sign-in'});
const verify=(email:string)=>api('/api/auth/sign-in/email-otp',{email,otp:'123456'});
function cookies(response:{headers:{getSetCookie():string[]}}){return response.headers.getSetCookie().map(s=>s.split(';')[0]).join('; ');}
async function login(email:string){expect((await send(email)).status).toBe(200);const response=await verify(email);expect(response.status,await response.clone().text()).toBe(200);return cookies(response);}
beforeAll(async()=>{
 const bundle=await build({entryPoints:['tests/fixtures/multi-worker.ts'],bundle:true,write:false,format:'esm',platform:'node',banner:{js:'import {createRequire} from "node:module"; const require=createRequire("/test.js");'},mainFields:['module','main'],conditions:['workerd','worker','browser'],target:'es2022',external:['node:*','cloudflare:workers'],logLevel:'silent',plugins:[{name:'fixtures',setup(b){
  b.onResolve({filter:/vinext\/server\/fetch-handler/},()=>({path:'framework',namespace:'test'}));
  b.onLoad({filter:/.*/,namespace:'test'},()=>({contents:'export default {fetch(){return new Response("page fixture")}}'}));
  b.onResolve({filter:/\.sql\?raw$/},args=>({path:resolve(args.resolveDir,args.path.slice(0,-4)),namespace:'raw'}));
  b.onLoad({filter:/.*/,namespace:'raw'},args=>({contents:readFileSync(args.path,'utf8'),loader:'text'}));
 }}]});
 mf=new Miniflare({modules:true,script:bundle.outputFiles[0].text,compatibilityDate:'2026-05-15',compatibilityFlags:['nodejs_compat'],d1Databases:{AUTH_DB:'multi-auth'},durableObjects:{TENANT_FEEDS:{className:'TestTenantFeed',useSQLite:true},PROBE:{className:'AdapterProbe',useSQLite:true}},bindings:{HOSTING_MODE:'multi',AUTH_MODE:'standalone',AUTH_BASE_URL:origin,AUTH_SECRET:'fixture-auth-secret-which-is-long-enough-123456',APP_ENCRYPTION_KEY:'a'.repeat(64),MAX_ACCOUNTS:'2',MULTI_DEPLOYMENT:'preview',AUTH_TEST_FIXTURE_OTP:'123456',RESEND_API_KEY:'fixture-mail-key',AUTH_EMAIL_FROM:'YourFeed <test@example.test>',OPENAI_API_KEY:'operator-must-not-be-used',FREE_AI_GROQ_API_KEY:'operator-free-key-must-not-be-used',YOUTUBE_API_KEY:'operator-youtube-must-not-be-used',BACKGROUND_SCHEDULE_CONFIGURED:'true'},outboundService:async (request:{url:string})=>{if(request.url.startsWith('https://cloudflare-dns.com/'))return Response.json({Status:0,Answer:[{type:1,data:'93.184.216.34'}]});outbound.push(request.url);throw new Error('Unexpected outbound request');}});
 db=await mf.getD1Database('AUTH_DB');
 for(const name of readdirSync('hosting/multi/migrations').filter(n=>n.endsWith('.sql')).sort()){
  const sql=readFileSync('hosting/multi/migrations/'+name,'utf8');
  if(name.startsWith('0001'))for(const statement of sql.split('--> statement-breakpoint').filter(x=>x.trim()))await db.exec(statement.replace(/\n/g,' '));
  else await db.exec(sql.replace(/\n/g,' '));
 }
},60000);
beforeEach(async()=>{
 await db.batch(['auth_session','auth_account','auth_verification','auth_rate','auth_user','approved_emails','account_deletions','multi_state'].map(t=>db.prepare('DELETE FROM '+t)));outbound.length=0;
});
afterAll(async()=>{await mf?.dispose();});
describe('open signup in actual workerd and SQLite Durable Objects',()=>{
 it('keeps fixture disabled unless all preview guards match; production config has no fixture',()=>{
  const base={DB:db as unknown as Env['DB'],MULTI_DEPLOYMENT:'preview',AUTH_BASE_URL:origin,AUTH_TEST_FIXTURE_OTP:'123456'} as Env;
  expect(fixtureOtp(base,'a@example.test')).toBe('123456');
  for(const env of [{...base,AUTH_TEST_FIXTURE_OTP:undefined},{...base,MULTI_DEPLOYMENT:'production'},{...base,AUTH_BASE_URL:'https://yourfeed-app.alanzhu.dev'}])expect(fixtureOtp(env,'a@example.test')).toBeUndefined();
  expect(fixtureOtp(base,'real@example.com')).toBeUndefined();
  const prod=JSON.parse(readFileSync('wrangler.multi.jsonc','utf8'));expect(prod.vars.AUTH_TEST_FIXTURE_OTP).toBeUndefined();expect(prod.vars.GOOGLE_SIGNIN_ENABLED).toBeUndefined();expect(prod.migrations[0].new_sqlite_classes).toEqual(['TenantFeed']);
 });
 it.each(['zh','zh-TW','en','vi'] as const)('localizes full capacity and encodes the entered mailbox in %s',language=>{
  const url=new URL(signupMailto('new+tag@example.test',language));
  expect(url.pathname).toBe('alan.xiaofei224@gmail.com');expect(url.searchParams.get('subject')).toBe(signupMessages[language].subject);expect(url.searchParams.get('body')).toContain('new+tag@example.test');expect(url.searchParams.get('body')?.split('\n')).toHaveLength(3);
 });
 it('creates empty isolated libraries, ignores forged identity and operator keys, and encrypts separate credentials',async()=>{
  const a=await login('a@example.test'),b=await login('b@example.test');
  for(const cookie of [a,b]){
   expect(await (await api('/api/feed',undefined,cookie)).json()).toMatchObject({items:[],total:0,sources:0});
   expect(await (await api('/api/settings',undefined,cookie)).json()).toMatchObject({configured:false,youtubeConfigured:false});
  }
  const write=async(cookie:string,path:string,body:unknown)=>mf.dispatchFetch(origin+path,{method:'PUT',headers:{origin,'Content-Type':'application/json',cookie},body:JSON.stringify(body)});
  const source=async(cookie:string,name:string)=>api('/api/sources',{name,platform:'rss',locator:'https://example.org/'+name+'.xml',topics:['tools'],enabled:true},cookie);
  const sa=await source(a,'alpha'),sb=await source(b,'beta');expect(sa.status,await sa.clone().text()).toBe(201);expect(sb.status,await sb.clone().text()).toBe(201);
  expect((await write(a,'/api/settings',{provider:'openai',key:'synthetic-key-aaaa',enabled:false})).status).toBe(200);
  expect((await write(b,'/api/settings',{provider:'openai',key:'synthetic-key-bbbb',enabled:false})).status).toBe(200);
  const identities=await db.prepare('SELECT id,email FROM auth_user ORDER BY email').all<{id:string;email:string}>();
  const alice=identities.results[0],bob=identities.results[1];
  const encrypted=JSON.parse(await (await api('/__test/inspect?id='+alice.id)).json() as string);
  expect(JSON.stringify(encrypted)).not.toContain('synthetic-key-aaaa');
  const master={DB:db as unknown as Env['DB'],APP_ENCRYPTION_KEY:'a'.repeat(64),OPENAI_API_KEY:'must-be-removed',FREE_AI_GROQ_API_KEY:'must-be-removed'};
  const ae=await tenantEnvironment(master,master.DB,alice),be=await tenantEnvironment(master,master.DB,bob);
  expect(ae.OPENAI_API_KEY).toBeUndefined();expect(ae.FREE_AI_GROQ_API_KEY).toBeUndefined();expect(ae.APP_ENCRYPTION_KEY).not.toBe(be.APP_ENCRYPTION_KEY);
  expect(await decryptSecret(encrypted.cipher,ae.APP_ENCRYPTION_KEY,String(ae.SECRET_NAMESPACE)+':openai')).toBe('synthetic-key-aaaa');
  await expect(decryptSecret(encrypted.cipher,be.APP_ENCRYPTION_KEY,String(be.SECRET_NAMESPACE)+':openai')).rejects.toThrow();
  const av=await (await api('/api/sources',undefined,a)).text(),bv=await (await api('/api/sources',undefined,b)).text();
  expect(av).toContain('alpha');expect(av).not.toContain('beta');expect(bv).toContain('beta');expect(bv).not.toContain('alpha');
  expect(await (await api('/api/settings',undefined,a)).json()).toMatchObject({keyLast4:'aaaa'});expect(await (await api('/api/settings',undefined,b)).json()).toMatchObject({keyLast4:'bbbb'});
  const forged=await mf.dispatchFetch(origin+'/api/settings',{headers:{'oai-authenticated-user-id':'a','oai-authenticated-user-email':'a@example.test','x-tenant-id':'a'}});expect(forged.status).toBe(401);
  expect(outbound).toEqual([]);
 });
 it('rejects full accounts before storing/sending OTP, permits approval and existing login when full',async()=>{
  await login('a@example.test');await login('b@example.test');
  const before=await db.prepare('SELECT count(*) AS n FROM auth_verification').first('n');
  const full=await api('/api/auth/email-otp/send-verification-otp',{email:'c@example.test',type:'sign-in'},'','zh-CN');expect(full.status).toBe(403);expect(await full.json()).toMatchObject({code:'ACCOUNT_CAP_FULL',error:signupMessages.zh.full,mailto:signupMailto('c@example.test','zh')});
  expect(await db.prepare('SELECT count(*) AS n FROM auth_verification').first('n')).toBe(before);expect(outbound).toEqual([]);
  await db.prepare('DELETE FROM auth_rate').run();expect((await send('a@example.test')).status).toBe(200);expect((await verify('a@example.test')).status).toBe(200);
  await db.prepare('INSERT INTO approved_emails(email) VALUES (?)').bind('c@example.test').run();await login('c@example.test');expect(await db.prepare('SELECT count(*) AS n FROM auth_user').first('n')).toBe(3);
 });
 it('atomically rejects concurrent verified registrations beyond the cap',async()=>{
  const emails=['race-a@example.test','race-b@example.test','race-c@example.test','race-d@example.test'];
  for(const email of emails)expect((await send(email)).status).toBe(200);
  const responses=await Promise.all(emails.map(verify));expect(responses.filter(r=>r.status===200)).toHaveLength(2);expect(responses.filter(r=>r.status===403)).toHaveLength(2);expect(await db.prepare('SELECT count(*) AS n FROM auth_user').first('n')).toBe(2);expect(outbound).toEqual([]);
 });
 it('runs bounded round-robin background work and erases an account with immediate session denial',async()=>{
  const cookie=await login('delete@example.test');const id=await db.prepare('SELECT id FROM auth_user').first<string>('id');
  expect(await (await api('/__test/cron',{})).json()).toEqual({processed:1,deleted:0});
  await db.prepare('INSERT INTO account_deletions(user_id) VALUES (?)').bind(id).run();expect((await api('/api/feed',undefined,cookie)).status).toBe(401);
  expect(await (await api('/__test/cron',{})).json()).toEqual({processed:0,deleted:1});expect(await db.prepare('SELECT count(*) AS n FROM auth_user').first('n')).toBe(0);
 });
 it('round-robins two tenants with one background call per tick',async()=>{
  await login('round-a@example.test');await login('round-b@example.test');
  const cursors=[];
  for(let i=0;i<3;i++){expect(await (await api('/__test/cron',{})).json()).toEqual({processed:1,deleted:0});cursors.push(await db.prepare("SELECT value FROM multi_state WHERE key='cron:cursor'").first('value'));}
  expect(cursors[0]).not.toBe(cursors[1]);expect(cursors[0]).toBe(cursors[2]);
 });
 it('defaults Google off and protects signup checks and API writes with origin/rate boundaries',async()=>{
  const config=await (await api('/api/auth/config')).json();expect(config).toMatchObject({configured:true,emailOtp:true,google:false,github:false,facebook:false,ownerOnly:false});expect(JSON.stringify(config)).not.toContain('fixture-auth');
  expect(await (await api('/api/auth/signup-check',{email:'new@example.test'})).json()).toEqual({status:'open'});
  const bad=await mf.dispatchFetch(origin+'/api/auth/signup-check',{method:'POST',headers:{origin:'https://evil.test','Content-Type':'application/json'},body:JSON.stringify({email:'new@example.test'})});expect(bad.status).toBe(403);
  const real=await send('never-send@example.com');expect(real.status).toBe(403);expect(outbound).toEqual([]);
  expect((await send('throttle@example.test')).status).toBe(200);expect((await send('throttle@example.test')).status).toBe(429);
 });
 it('adapts binding, first/all/run/raw metadata, FTS/json and atomic batch rollback',async()=>{
  const sql=async(statements:{sql:string;values?:unknown[]}[],extra:Record<string,unknown>={})=>api('/__test/sql',{statements,...extra});
  await sql([{sql:'CREATE TABLE sample(id INTEGER PRIMARY KEY,value TEXT)'}]);
  const insert=await (await sql([{sql:'INSERT INTO sample(value) VALUES (?)',values:['hello']}],{method:'run'})).json();expect(insert).toMatchObject({success:true,meta:{changes:1,last_row_id:1}});expect((insert as any).meta.size_after).toBeGreaterThan(0);
  expect(await (await sql([{sql:'SELECT value FROM sample'}],{method:'first',column:'value'})).json()).toBe('hello');
  expect(await (await sql([{sql:'SELECT value FROM sample WHERE id=99'}],{method:'first'})).json()).toBeNull();
  expect(await (await sql([{sql:'SELECT id,value FROM sample'}],{method:'raw',columnNames:true})).json()).toEqual([['id','value'],[1,'hello']]);
  expect((await sql([{sql:'INSERT INTO sample VALUES (2,\'two\')'},{sql:'INSERT INTO missing_table VALUES (1)'}],{batch:true})).status).toBe(400);
  expect(await (await sql([{sql:'SELECT count(*) AS n FROM sample'}],{method:'first',column:'n'})).json()).toBe(1);
  const read=await (await sql([{sql:'SELECT json_extract(?,\'$.a\') AS value',values:['{"a":42}']}])).json();expect(read).toMatchObject({results:[{value:42}],meta:{changes:0}});
  await sql([{sql:"CREATE VIRTUAL TABLE search USING fts5(text,tokenize='trigram')"}]);await sql([{sql:"INSERT INTO search VALUES ('searchable')"}]);expect(await (await sql([{sql:"SELECT count(*) AS n FROM search WHERE search MATCH 'search'"}],{method:'first',column:'n'})).json()).toBe(1);
 });
});
