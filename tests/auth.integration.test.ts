import {afterAll,beforeAll,beforeEach,describe,it,expect,vi} from 'vitest';
import {Miniflare} from 'miniflare';
import {readFileSync} from 'node:fs';
import {handleAuth,resolveSession,requireRecentAuth,consumeAuthRate,ownerIdentityAllowed,authHmac,createOwnerAuth} from '../server/auth';
import type {Env} from '../server/db';
let mf:Miniflare,env:Env,code='';
const originalFetch=globalThis.fetch;
function req(path:string,body?:unknown,cookie?:string){const headers:Record<string,string>={origin:'https://yourfeed.example','content-type':'application/json','cf-connecting-ip':'203.0.113.40'};if(cookie)headers.cookie=cookie;return new Request('https://yourfeed.example/api/auth'+path,{method:body===undefined?'GET':'POST',headers,body:body===undefined?undefined:JSON.stringify(body)});}
const cookie=(response:Response)=>response.headers.getSetCookie().map(x=>x.split(';')[0]).join('; ');
async function send(){return handleAuth(req('/email-otp/send-verification-otp',{email:'owner@example.com',type:'sign-in'}),env);}
async function login(){expect((await send()).status).toBe(200);const response=await handleAuth(req('/sign-in/email-otp',{email:'owner@example.com',otp:code}),env);expect(response.status).toBe(200);return cookie(response);}
beforeAll(async()=>{
 mf=new Miniflare({modules:true,script:'export default {fetch(){return new Response("test")}}',d1Databases:{DB:'standalone-auth-test'},compatibilityDate:'2026-05-15'});
 env={DB:await mf.getD1Database('DB') as unknown as Env['DB'],AUTH_SECRET:'test-only-strong-auth-secret-1234567890-abcdefgh',OWNER_EMAIL:'owner@example.com',AUTH_BASE_URL:'https://yourfeed.example',RESEND_API_KEY:'test-only-mail-key',AUTH_EMAIL_FROM:'YourFeed <login@example.com>'};
 for(const sql of readFileSync('drizzle/0001_auth.sql','utf8').split('--> statement-breakpoint').map(x=>x.trim()).filter(Boolean))await env.DB.exec(sql.replace(/\r?\n/g,' '));
},60000);
beforeEach(async()=>{
 await env.DB.batch(['auth_session','auth_account','auth_verification','auth_rate','auth_user'].map(t=>env.DB.prepare('DELETE FROM '+t)));code='';
 vi.stubGlobal('fetch',vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>{if(String(input)==='https://api.resend.com/emails'){const message=JSON.parse(String(init?.body));code=message.text.match(/\b(\d{6})\b/)[1];return new Response(JSON.stringify({id:'test-email'}),{status:200});}throw new Error('Unexpected network call');}));
});
afterAll(async()=>{vi.stubGlobal('fetch',originalFetch);await mf?.dispose();});
describe('standalone singleowner authentication',()=>{
 it('never trusts Sites headers in standalone mode and fails closed without config',async()=>{
  const forged=new Request('https://yourfeed.example/api/session',{headers:{'oai-authenticated-user-id':'forged','oai-authenticated-user-email':'owner@example.com'}});
  expect(await resolveSession(forged,env)).toBeNull();
  const response=await handleAuth(req('/config'),{} as Env);const body=await response.json() as any;expect(body.configured).toBe(false);expect(JSON.stringify(body)).not.toContain('owner@example.com');
 });
 it('sends a sixdigit OTP, stores only HMACs and creates secure seven-day sessions',async()=>{
  expect((await send()).status).toBe(200);expect(code).toMatch(/^\d{6}$/);
  const rows=await env.DB.prepare('SELECT identifier,value FROM auth_verification').all<{identifier:string;value:string}>();expect(rows.results).toHaveLength(1);expect(rows.results[0].value).not.toContain(code);expect(rows.results[0].identifier).not.toContain('owner@example.com');
  const response=await handleAuth(req('/sign-in/email-otp',{email:'owner@example.com',otp:code}),env);expect(response.status).toBe(200);expect(await response.text()).not.toContain('token');
  const header=response.headers.getSetCookie().join(' ');expect(header).toContain('HttpOnly');expect(header).toContain('Secure');expect(header.toLowerCase()).toContain('samesite=lax');
  const session=await resolveSession(new Request('https://yourfeed.example/',{headers:{cookie:cookie(response)}}),env);expect(session?.user.email).toBe('owner@example.com');expect(Math.abs(session!.session.expiresAt.getTime()-session!.session.createdAt.getTime()-7*86400000)).toBeLessThan(1000);
 });
 it('enforces persistent 60second resend limits atomically',async()=>{
  const responses=await Promise.all(Array.from({length:6},()=>send()));expect(responses.filter(r=>r.status===200)).toHaveLength(1);expect(responses.filter(r=>r.status===429)).toHaveLength(5);
  const rows=await env.DB.prepare('SELECT id FROM auth_rate').all<{id:string}>();expect(rows.results.every(r=>/^[a-f0-9]{64}$/.test(r.id))).toBe(true);
 });
 it('consumes a valid OTP only once under concurrent requests',async()=>{
  expect((await send()).status).toBe(200);
  const responses=await Promise.all(Array.from({length:6},()=>handleAuth(req('/sign-in/email-otp',{email:'owner@example.com',otp:code}),env)));
  expect(responses.filter(r=>r.status===200)).toHaveLength(1);expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM auth_session').first<{n:number}>())?.n).toBe(1);
 });
 it('locks an OTP after five wrong attempts and rejects expired codes',async()=>{
  expect((await send()).status).toBe(200);const correct=code;
  for(let i=0;i<5;i++){const result=await handleAuth(req('/sign-in/email-otp',{email:'owner@example.com',otp:correct==='000000'?'111111':'000000'}),env);expect(result.status).toBeGreaterThanOrEqual(400);}
  expect((await handleAuth(req('/sign-in/email-otp',{email:'owner@example.com',otp:correct}),env)).status).toBeGreaterThanOrEqual(400);
  await env.DB.prepare('DELETE FROM auth_rate').run();expect((await send()).status).toBe(200);await env.DB.prepare('UPDATE auth_verification SET expires_at=?').bind(Date.now()-1000).run();
  expect((await handleAuth(req('/sign-in/email-otp',{email:'owner@example.com',otp:code}),env)).status).toBeGreaterThanOrEqual(400);
 });
 it('does not send codes to other emails, rejects unverified owners and blocks cross-origin login',async()=>{
  const response=await handleAuth(req('/email-otp/send-verification-otp',{email:'other@example.com',type:'sign-in'}),env);expect(response.status).toBe(200);expect(code).toBe('');
  expect(ownerIdentityAllowed(env,{email:'owner@example.com',emailVerified:false})).toBe(false);expect(ownerIdentityAllowed(env,{email:'other@example.com',emailVerified:true})).toBe(false);expect(ownerIdentityAllowed(env,{email:'OWNER@example.com',emailVerified:true})).toBe(true);
  const cross=req('/email-otp/send-verification-otp',{email:'owner@example.com',type:'sign-in'});cross.headers.set('origin','https://attacker.example');expect((await handleAuth(cross,env)).status).toBe(403);
 });
 it('requires recent auth for sensitive changes and revokes all devices including current',async()=>{
  const cookies=await login();const request=new Request('https://yourfeed.example/',{headers:{cookie:cookies}});expect((await requireRecentAuth(request,env)).email).toBe('owner@example.com');
  await env.DB.prepare('UPDATE auth_session SET created_at=?').bind(Date.now()-601000).run();await expect(requireRecentAuth(request,env)).rejects.toThrow('重新登录');
  await env.DB.prepare('UPDATE auth_session SET created_at=?').bind(Date.now()).run();const revoked=await handleAuth(req('/revoke-sessions',{},cookies),env);expect(revoked.status).toBe(200);expect(revoked.headers.getSetCookie().join(' ')).toContain('Max-Age=0');expect(await resolveSession(request,env)).toBeNull();
 });
 it('persists generic rate limits across concurrent writers and allows later expiry',async()=>{
  const now=Date.now();const results=await Promise.all(Array.from({length:8},()=>consumeAuthRate(env,'test','subject',3,60,now)));expect(results.filter(Boolean)).toHaveLength(3);expect(await consumeAuthRate(env,'test','subject',3,60,now+60001)).toBe(true);
  expect(await authHmac(env,'a')).not.toBe(await authHmac(env,'b'));
 });
 it('supports explicit owner social linking only after recent authentication',async()=>{
  const oauthEnv={...env,GOOGLE_CLIENT_ID:'test-google-client',GOOGLE_CLIENT_SECRET:'test-google-secret'};
  expect((await handleAuth(req('/link-social',{provider:'google',callbackURL:'/'}),oauthEnv)).status).toBe(401);
  const cookies=await login();const linked=await handleAuth(req('/link-social',{provider:'google',callbackURL:'/'},cookies),oauthEnv);
  expect(linked.status).toBe(200);const value=await linked.json() as any;expect(value.url).toContain('accounts.google.com');
  await env.DB.prepare('UPDATE auth_session SET created_at=?').bind(Date.now()-601000).run();
  expect((await handleAuth(req('/link-social',{provider:'google',callbackURL:'/'},cookies),oauthEnv)).status).toBe(401);
 });
 it('uses database atomic consume across independent adapters without relying on process locks',async()=>{
  await env.DB.prepare('INSERT INTO auth_verification(id,identifier,value,expires_at,created_at,updated_at) VALUES (?,?,?,?,?,?)').bind('race-row','race-id','hmac-value',Date.now()+300000,Date.now(),Date.now()).run();
  const adapters=await Promise.all(Array.from({length:8},async()=> (await createOwnerAuth(env).$context).adapter));
  const results=await Promise.all(adapters.map(adapter=>adapter.consumeOne({model:'verification',where:[{field:'id',value:'race-row'}]})));
  expect(results.filter(Boolean)).toHaveLength(1);
 });
 it('localizes verification email from the request language',async()=>{
  const request=req('/email-otp/send-verification-otp',{email:'owner@example.com',type:'sign-in'});request.headers.set('accept-language','zh-CN');
  expect((await handleAuth(request,env)).status).toBe(200);
  const fetchMock=vi.mocked(globalThis.fetch);const init=fetchMock.mock.calls[0][1];expect(JSON.parse(String(init?.body)).subject).toContain('登录验证码');
 });

});
