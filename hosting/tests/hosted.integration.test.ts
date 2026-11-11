import {afterAll,beforeAll,beforeEach,describe,it,expect,vi} from 'vitest';
import {Miniflare} from 'miniflare';
import {readFileSync} from 'node:fs';
import controlWorker,{hashToken,signAdmin,type ControlEnv} from '../control/worker';
import {hostedEnvironment,assertHostedAdmission,activateHostedIdentity} from '../../server/hosted';
import {handleAuth,resolveSession} from '../../server/auth';
import type {Env} from '../../server/db';

let mf:Miniflare,control:ControlEnv,a:Env,b:Env,mailCode='';
const operatorSecret='fixture-only-operator-secret-not-real-1234567890-abcdef';
const tokenA='a'.repeat(64),tokenB='b'.repeat(64),originalFetch=globalThis.fetch;
const op=async(data:unknown,nonce=crypto.randomUUID().replace(/-/g,''))=>{
 const raw=JSON.stringify(data),timestamp=String(Date.now()),signature=await signAdmin(operatorSecret,`POST\n/admin\n${timestamp}\n${nonce}\n${await hashToken(raw)}`);
 return new Request('https://control.example/admin',{method:'POST',headers:{'Content-Type':'application/json','x-hosting-timestamp':timestamp,'x-hosting-nonce':nonce,'x-hosting-signature':signature},body:raw});
};
const admin=async(data:unknown)=>controlWorker.fetch(await op(data),control);
const registration=(id='yf-member-a',token=tokenA,databaseId='11111111-1111-4111-8111-111111111111',origin='https://member-a.example')=>({operation:'register',instanceId:id,instanceToken:token,databaseId,origin});
const invite=(email='one@example.com',requestId='fixture-invite-request-one')=>admin({operation:'invite',email,requestId});
const authReq=(path:string,body?:unknown,cookie?:string,origin='https://member-a.example')=>new Request(origin+'/api/auth'+path,{method:body===undefined?'GET':'POST',headers:{origin,'Content-Type':'application/json','cf-connecting-ip':'203.0.113.50',...(cookie?{cookie}:{})},...(body!==undefined?{body:JSON.stringify(body)}:{})});
const cookies=(r:Response)=>r.headers.getSetCookie().map(x=>x.split(';')[0]).join('; ');
beforeAll(async()=>{
 mf=new Miniflare({modules:true,script:'export default {fetch(){return new Response("fixture")}}',d1Databases:{CONTROL:'hosted-control-test',A:'hosted-reader-a',B:'hosted-reader-b'},compatibilityDate:'2026-05-15'});
 control={CONTROL_DB:await mf.getD1Database('CONTROL') as unknown as ControlEnv['CONTROL_DB'],CONTROL_ADMIN_SECRET:operatorSecret,MAX_TENANTS:'5'};
 for(const sql of readFileSync('hosting/control/migrations/0001_control.sql','utf8').replace(/^--.*$/gm,'').split(';').map(x=>x.trim()).filter(Boolean))await control.CONTROL_DB.exec(sql.replace(/\n/g,' '));
 const make=async(db:'A'|'B',id:string,token:string,origin:string):Promise<Env>=>{
  const DB=await mf.getD1Database(db) as unknown as Env['DB'];
  await DB.exec('CREATE TABLE meta(key TEXT PRIMARY KEY NOT NULL,value TEXT NOT NULL)');
  for(const sql of readFileSync('drizzle/0001_auth.sql','utf8').split('--> statement-breakpoint').map(x=>x.trim()).filter(Boolean))await DB.exec(sql.replace(/\n/g,' '));
  return {DB,HOSTING_MODE:'hosted',AUTH_MODE:'standalone',INSTANCE_ID:id,HOSTED_INSTANCE_TOKEN:token,AUTH_BASE_URL:origin,AUTH_SECRET:`fixture-session-${db}-independent-1234567890-abcdefgh`,RESEND_API_KEY:'fixture-mail-only',AUTH_EMAIL_FROM:'YourFeed <login@example.com>',HOSTED_CONTROL_SERVICE:{fetch:(request:Request)=>controlWorker.fetch(request,control)}};
 };
 a=await make('A','yf-member-a',tokenA,'https://member-a.example');b=await make('B','yf-member-b',tokenB,'https://member-b.example');
},60_000);
beforeEach(async()=>{
 await control.CONTROL_DB.batch(['hosting_slots','hosting_admin_nonce','hosting_audit'].map(t=>control.CONTROL_DB.prepare('DELETE FROM '+t)));
 for(const env of [a,b]){await env.DB.batch(['auth_session','auth_account','auth_verification','auth_rate','auth_user','meta'].map(t=>env.DB.prepare('DELETE FROM '+t)));await env.DB.prepare('INSERT INTO meta(key,value) VALUES (?,?)').bind('hosted:instance',env.INSTANCE_ID).run();}
 mailCode='';vi.stubGlobal('fetch',vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>{if(String(input)!=='https://api.resend.com/emails')throw new Error('No external APIs allowed in tests');const message=JSON.parse(String(init?.body));mailCode=message.text.match(/\b(\d{6})\b/)[1];return new Response(JSON.stringify({id:'fixture-mail-accepted'}));}));
});
afterAll(async()=>{vi.stubGlobal('fetch',originalFetch);await mf?.dispose();});

describe('isolated invited hosting control',()=>{
 it('requires signed operator authorization and consumes each nonce once',async()=>{
  expect((await controlWorker.fetch(new Request('https://control.example/admin',{method:'POST',headers:{'Content-Type':'application/json'},body:'{"operation":"list"}'}),control)).status).toBe(401);
  const request=await op(registration());expect((await controlWorker.fetch(request.clone() as Request,control)).status).toBe(201);expect((await controlWorker.fetch(request.clone() as Request,control)).status).toBe(409);
  const bad=await op({operation:'list'});bad.headers.set('x-hosting-signature','0'.repeat(64));expect((await controlWorker.fetch(bad,control)).status).toBe(401);
 });
 it('pins immutable slot identities and never stores the raw tenant capability',async()=>{
  expect((await admin(registration())).status).toBe(201);expect((await admin(registration())).status).toBe(200);
  expect((await admin({...registration(),databaseId:'22222222-2222-4222-8222-222222222222'})).status).toBe(409);
  const row=await control.CONTROL_DB.prepare('SELECT * FROM hosting_slots').first();expect(JSON.stringify(row)).not.toContain(tokenA);expect(JSON.stringify(await (await admin({operation:'list'})).json())).not.toContain(await hashToken(tokenA));
 });
 it('atomically reserves exactly five slots under a six-user registration race',async()=>{
  for(let n=0;n<5;n++)expect((await admin(registration('yf-tenant-'+n,String(n+1).repeat(64),`${n+1}1111111-1111-4111-8111-111111111111`,`https://tenant-${n}.example`))).status).toBe(201);
  const responses=await Promise.all(Array.from({length:6},(_,n)=>invite(`reader${n}@example.com`,'fixture-request-'+String(n).padStart(16,'0'))));
  expect(responses.filter(r=>r.status===201)).toHaveLength(5);expect(responses.filter(r=>r.status===409)).toHaveLength(1);
  expect((await control.CONTROL_DB.prepare("SELECT COUNT(*) n FROM hosting_slots WHERE state IN ('reserved','active')").first<{n:number}>())?.n).toBe(5);
  expect((await admin(registration('yf-tenant-extra','f'.repeat(64),'99999999-9999-4999-8999-999999999999','https://extra.example'))).status).toBe(409);
 });
 it('deduplicates concurrent invitations and callbacks without another member or slot',async()=>{
  await admin(registration());await admin(registration('yf-member-b',tokenB,'22222222-2222-4222-8222-222222222222','https://member-b.example'));
  const results=await Promise.all(Array.from({length:6},()=>invite()));expect(results.every(r=>r.ok)).toBe(true);
  const values=await Promise.all(results.map(r=>r.json() as Promise<any>));expect(new Set(values.map(x=>x.instanceId)).size).toBe(1);
  await Promise.all(Array.from({length:6},()=>activateHostedIdentity(a,'one@example.com')));
  const row=await control.CONTROL_DB.prepare("SELECT * FROM hosting_slots WHERE state='active'").first<any>();expect(row.member_id).toBeTypeOf('string');
  expect((await control.CONTROL_DB.prepare("SELECT COUNT(*) n FROM hosting_slots WHERE state IN ('reserved','active')").first<{n:number}>())?.n).toBe(1);
 });
 it('rejects wrong tenant tokens, origins, identities and database bindings',async()=>{
  await admin(registration());await invite();
  expect((await hostedEnvironment(a)).OWNER_EMAIL).toBe('one@example.com');
  await expect(hostedEnvironment({...a,HOSTED_INSTANCE_TOKEN:tokenB})).rejects.toThrow();
  await expect(hostedEnvironment({...a,AUTH_BASE_URL:'https://member-b.example'})).rejects.toThrow();
  await expect(hostedEnvironment({...a,DB:b.DB})).rejects.toThrow('数据库身份');
  await expect(activateHostedIdentity(a,'other@example.com')).rejects.toThrow();
  await expect(hostedEnvironment({...a,AUTH_MODE:'sites'})).rejects.toThrow();
  await expect(hostedEnvironment({...a,HOSTED_CONTROL_SERVICE:undefined})).rejects.toThrow();
 });
 it('fails closed on control outage and never substitutes an environment owner',async()=>{
  const env={...a,OWNER_EMAIL:'platform-owner@example.com',HOSTED_CONTROL_SERVICE:{fetch:()=>Promise.reject(new Error('offline'))}};
  await expect(hostedEnvironment(env)).rejects.toThrow();
  expect(await resolveSession(new Request('https://member-a.example/',{headers:{cookie:'fake=token'}}),env)).toBeNull();
  const caps=await (await handleAuth(authReq('/config'),env)).json() as any;expect(caps.configured).toBe(false);expect(caps.emailOtp).toBe(false);expect(caps.hostingUnavailable).toBe(true);expect(JSON.stringify(caps)).not.toContain('platform-owner');
 });
 it('requires a live reservation and never recycles an expired or revoked database',async()=>{
  await admin(registration());await expect(assertHostedAdmission(a)).rejects.toThrow();await invite();
  await control.CONTROL_DB.prepare('UPDATE hosting_slots SET expires_at=?').bind(Date.now()-1).run();
  await expect(assertHostedAdmission(a)).rejects.toThrow();expect((await admin({operation:'expire',instanceId:'yf-member-a'})).status).toBe(200);
  expect((await invite('new@example.com','fixture-invite-request-next')).status).toBe(409);
  expect((await invite()).status).toBe(409);expect((await admin({...registration(),instanceToken:'c'.repeat(64)})).status).toBe(409);
 });
 it('supports configurable open-source capacity while rejecting invalid limits',async()=>{
  expect((await controlWorker.fetch(await op(registration()),{...control,MAX_TENANTS:'0'})).status).toBe(503);
  expect((await controlWorker.fetch(await op(registration()),{...control,MAX_TENANTS:'1'})).status).toBe(201);
  expect((await controlWorker.fetch(await op(registration('yf-member-b',tokenB,'22222222-2222-4222-8222-222222222222','https://member-b.example')),{...control,MAX_TENANTS:'1'})).status).toBe(409);
 });
 it('renews an expired invitation only for its original member and cannot resurrect revoked access',async()=>{
  await admin(registration());await invite();const original=await control.CONTROL_DB.prepare('SELECT * FROM hosting_slots').first<any>();
  await control.CONTROL_DB.prepare('UPDATE hosting_slots SET expires_at=?').bind(Date.now()-1).run();await admin({operation:'expire',instanceId:'yf-member-a'});
  expect((await admin({operation:'renew',instanceId:'yf-member-a',email:'different@example.com'})).status).toBe(409);
  expect((await admin({operation:'renew',instanceId:'yf-member-a',email:'one@example.com'})).status).toBe(200);
  const renewed=await control.CONTROL_DB.prepare('SELECT * FROM hosting_slots').first<any>();expect(renewed.member_id).toBe(original.member_id);expect(renewed.database_id).toBe(original.database_id);expect(renewed.owner_email).toBe(original.owner_email);
  await activateHostedIdentity(a,'one@example.com');expect((await admin({operation:'renew',instanceId:'yf-member-a',email:'one@example.com'})).status).toBe(409);
  await admin({operation:'revoke',instanceId:'yf-member-a'});expect((await admin({operation:'renew',instanceId:'yf-member-a',email:'one@example.com'})).status).toBe(409);
 });
 it('does not overbook capacity when renewing an expired reservation',async()=>{
  const limited={...control,MAX_TENANTS:'1'};await admin(registration());await invite();
  await control.CONTROL_DB.prepare("UPDATE hosting_slots SET state='expired'").run();await admin(registration('yf-member-b',tokenB,'22222222-2222-4222-8222-222222222222','https://member-b.example'));await invite('two@example.com','fixture-invite-request-two');
  const result=await controlWorker.fetch(await op({operation:'renew',instanceId:'yf-member-a',email:'one@example.com'}),limited);expect(result.status).toBe(409);
 });
 it('checks the control schema and operator configuration before reporting healthy',async()=>{
  expect((await controlWorker.fetch(new Request('https://control.example/health'),control)).status).toBe(200);
  expect((await controlWorker.fetch(new Request('https://control.example/health'),{...control,CONTROL_DB:a.DB})).status).toBe(503);
  expect((await controlWorker.fetch(new Request('https://control.example/health'),{...control,CONTROL_ADMIN_SECRET:''})).status).toBe(503);
 });
 it('rejects oversized streaming bodies before buffering or consuming an operator nonce',async()=>{
  const request=new Request('https://control.example/admin',{method:'POST',headers:{'Content-Type':'application/json'},body:new ReadableStream({start(controller){controller.enqueue(new TextEncoder().encode('x'.repeat(8193)));controller.close();}}),duplex:'half'} as RequestInit);
  expect((await controlWorker.fetch(request,control)).status).toBe(413);
  expect((await control.CONTROL_DB.prepare('SELECT COUNT(*) n FROM hosting_admin_nonce').first<{n:number}>())?.n).toBe(0);
 });
});

describe('tenant-owned authentication and immediate revocation',()=>{
 it('uses the assigned verified mailbox, creates only a local session and rejects cross-instance cookies',async()=>{
  await admin(registration());await admin(registration('yf-member-b',tokenB,'22222222-2222-4222-8222-222222222222','https://member-b.example'));await invite();await invite('two@example.com','fixture-invite-request-two');
  const env={...a,OWNER_EMAIL:'platform-owner@example.com'};
  expect((await handleAuth(authReq('/email-otp/send-verification-otp',{email:'one@example.com',type:'sign-in'}),env)).status).toBe(200);
  expect(mailCode).toMatch(/^\d{6}$/);
  const signed=await handleAuth(authReq('/sign-in/email-otp',{email:'one@example.com',otp:mailCode}),env);expect(signed.status).toBe(200);
  const cookie=cookies(signed);expect(signed.headers.getSetCookie().join(' ')).not.toMatch(/Domain=/i);
  const req=new Request('https://member-a.example/',{headers:{cookie}});expect((await resolveSession(req,env))?.user.email).toBe('one@example.com');
  expect(await resolveSession(new Request('https://member-b.example/',{headers:{cookie}}),b)).toBeNull();
  expect((await b.DB.prepare('SELECT COUNT(*) n FROM auth_session').first<{n:number}>())?.n).toBe(0);
  expect((await control.CONTROL_DB.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE name='auth_session'").first<{n:number}>())?.n).toBe(0);
  expect((await admin({operation:'revoke',instanceId:'yf-member-a'})).status).toBe(200);
  expect(await resolveSession(req,env)).toBeNull();await expect(assertHostedAdmission(env)).rejects.toThrow();
  expect((await handleAuth(authReq('/email-otp/send-verification-otp',{email:'one@example.com',type:'sign-in'}),env)).status).toBe(403);
  // Another reader's reservation remains independently usable after A is revoked.
  expect((await hostedEnvironment(b)).OWNER_EMAIL).toBe('two@example.com');
 });
 it('preserves self-hosted and native Sites identities without any control lookup',async()=>{
  const standalone={...a,HOSTING_MODE:undefined,OWNER_EMAIL:'self@example.com',HOSTED_CONTROL_SERVICE:{fetch:()=>{throw new Error('Must not use control');}}};
  expect(await hostedEnvironment(standalone)).toBe(standalone);await expect(assertHostedAdmission(standalone)).resolves.toBeUndefined();
  const request=new Request('https://personal.example/',{headers:{'oai-authenticated-user-id':'original-sites-owner','oai-authenticated-user-email':'self@example.com'}});
  expect((await resolveSession(request,{...standalone,AUTH_MODE:'sites'}))?.user.id).toBe('original-sites-owner');
  expect(await resolveSession(request,{...a,AUTH_MODE:'sites'})).toBeNull();
 });
});
