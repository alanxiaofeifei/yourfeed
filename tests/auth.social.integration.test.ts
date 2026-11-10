import {afterAll,beforeAll,beforeEach,describe,it,expect,vi} from 'vitest';
import {Miniflare} from 'miniflare';
import {readFileSync} from 'node:fs';
import {authCapabilities,handleAuth,resolveSession} from '../server/auth';
import {sessionForRequest} from '../server/session';
import type {Env} from '../server/db';

let worker:Miniflare,env:Env,otp='';
let facebook={id:'123456789',email:'owner@example.com',email_verified:false,name:'Fixture owner',picture:{data:{url:'https://example.org/avatar.png'}}};
let tokenApp='fixture-facebook-client',tokenSubject='123456789',githubVerified=true,googleVerified=true,googleExchangeStatus=200;
const network:string[]=[];
const originalFetch=globalThis.fetch;
function request(path:string,body?:unknown,cookies=''){
 const headers:Record<string,string>={origin:'https://yourfeed.example','content-type':'application/json','cf-connecting-ip':'203.0.113.50'};
 if(cookies)headers.cookie=cookies;
 return new Request('https://yourfeed.example/api/auth'+path,{method:body===undefined?'GET':'POST',headers,body:body===undefined?undefined:JSON.stringify(body)});
}
const cookies=(response:Response)=>response.headers.getSetCookie().map(value=>value.split(';')[0]).join('; ');
async function ownerLogin(){
 expect((await handleAuth(request('/email-otp/send-verification-otp',{email:'owner@example.com',type:'sign-in'}),env)).status).toBe(200);
 const response=await handleAuth(request('/sign-in/email-otp',{email:'owner@example.com',otp}),env);expect(response.status).toBe(200);return cookies(response);
}
async function start(provider='facebook',session='',link=false,extra:Record<string,unknown>={}){
 const response=await handleAuth(request(link?'/link-social':'/sign-in/social',{provider,callbackURL:'/',...extra},session),env);
 expect(response.status).toBe(200);const body=await response.json() as {url:string};
 return {url:new URL(body.url),cookies:[session,cookies(response)].filter(Boolean).join('; ')};
}
async function finish(flow:Awaited<ReturnType<typeof start>>,provider='facebook',query:Record<string,string>={}){
 const params=new URLSearchParams({state:flow.url.searchParams.get('state')!,code:'fixture-authorization-code',...query});
 return handleAuth(request('/callback/'+provider+'?'+params,undefined,flow.cookies),env);
}
async function userCount(){return env.DB.prepare('SELECT COUNT(*) n FROM auth_user').first<number>('n');}
async function accountCount(){return env.DB.prepare('SELECT COUNT(*) n FROM auth_account WHERE provider_id=?').bind('facebook').first<number>('n');}
beforeAll(async()=>{
 worker=new Miniflare({modules:true,script:'export default {fetch(){return new Response("fixture")}}',d1Databases:{DB:'auth-social-fixture'},compatibilityDate:'2026-05-15'});
 env={DB:await worker.getD1Database('DB') as unknown as Env['DB'],AUTH_SECRET:'fixture-auth-secret-123456789012345678901234',AUTH_BASE_URL:'https://yourfeed.example',OWNER_EMAIL:'owner@example.com',RESEND_API_KEY:'fixture-resend-key',AUTH_EMAIL_FROM:'login@example.com',FACEBOOK_CLIENT_ID:'fixture-facebook-client',FACEBOOK_CLIENT_SECRET:'fixture-facebook-secret',GOOGLE_CLIENT_ID:'fixture-google-client',GOOGLE_CLIENT_SECRET:'fixture-google-secret',GITHUB_CLIENT_ID:'fixture-github-client',GITHUB_CLIENT_SECRET:'fixture-github-secret'};
 await env.DB.exec('CREATE TABLE meta (key TEXT PRIMARY KEY NOT NULL,value TEXT NOT NULL)');
 for(const sql of readFileSync('drizzle/0001_auth.sql','utf8').split('--> statement-breakpoint').map(value=>value.trim()).filter(Boolean))await env.DB.exec(sql.replace(/\r?\n/g,' '));
},60000);
beforeEach(async()=>{
 await env.DB.batch(['auth_session','auth_account','auth_verification','auth_rate','auth_user','meta'].map(table=>env.DB.prepare('DELETE FROM '+table)));
 facebook={id:'123456789',email:'owner@example.com',email_verified:false,name:'Fixture owner',picture:{data:{url:'https://example.org/avatar.png'}}};tokenApp='fixture-facebook-client';tokenSubject=facebook.id;githubVerified=true;googleVerified=true;googleExchangeStatus=200;otp='';network.length=0;
 vi.stubGlobal('fetch',vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>{
  const url=new URL(input instanceof Request?input.url:String(input));network.push(url.origin+url.pathname);
  if(url.hostname==='api.resend.com'){otp=JSON.parse(String(init?.body)).text.match(/\b\d{6}\b/)[0];return Response.json({id:'fixture-email-accepted'});}
  if(url.hostname==='graph.facebook.com'&&url.pathname.endsWith('/oauth/access_token'))return Response.json({access_token:'fixture-facebook-access-token',token_type:'bearer',expires_in:3600});
  if(url.hostname==='graph.facebook.com'&&url.pathname==='/debug_token')return Response.json({data:{is_valid:true,app_id:tokenApp,user_id:tokenSubject}});
  if(url.hostname==='graph.facebook.com'&&url.pathname==='/me')return Response.json(facebook);
  if(url.hostname==='github.com'&&url.pathname==='/login/oauth/access_token')return Response.json({access_token:'fixture-github-token',token_type:'bearer',scope:'read:user user:email'});
  if(url.hostname==='api.github.com'&&url.pathname==='/user')return Response.json({id:98765,login:'fixture-owner',name:'Fixture owner',email:'owner@example.com'});
  if(url.hostname==='api.github.com'&&url.pathname==='/user/emails')return Response.json([{email:'owner@example.com',primary:true,verified:githubVerified}]);
  if(url.hostname==='oauth2.googleapis.com'&&url.pathname==='/token'){
   if(googleExchangeStatus!==200)return Response.json({error:'invalid_grant',error_description:'fixture-private-provider-description'},{status:googleExchangeStatus});
   // This payload comes from the mocked HTTPS token exchange, never from a
   // browser-provided idToken. Google code flow consumes this trusted response.
   const payload=Buffer.from(JSON.stringify({sub:'fixture-google-subject',email:'owner@example.com',email_verified:googleVerified,name:'Fixture owner'})).toString('base64url');
   return Response.json({access_token:'fixture-google-token',id_token:'e30.'+payload+'.fixture-signature',token_type:'bearer',expires_in:3600});
  }
  throw new Error('Unexpected fixture destination: '+url.origin+url.pathname);
 }));
});
afterAll(async()=>{vi.stubGlobal('fetch',originalFetch);await worker?.dispose();});

describe('owner-only OAuth through the real Better Auth adapters',()=>{
 it('explicitly links a verified Google account to a fresh OTP owner under the production account-linking settings',async()=>{
  const ownerCookies=await ownerLogin();const linked=await finish(await start('google',ownerCookies,true),'google');
  expect(linked.status).toBe(302);expect(linked.headers.get('location')).toBe('/');
  expect(await env.DB.prepare('SELECT COUNT(*) n FROM auth_account WHERE provider_id=?').bind('google').first<number>('n')).toBe(1);
  await env.DB.prepare('DELETE FROM auth_session').run();const signedIn=await finish(await start('google'),'google');
  expect(signedIn.headers.get('location')).toBe('/');expect((await resolveSession(new Request('https://yourfeed.example/',{headers:{cookie:cookies(signedIn)}}),env))?.user.email).toBe('owner@example.com');
 });
 it('records a fixed Google token-exchange error without provider text, state, authorization code or secrets',async()=>{
  const flow=await start('google',await ownerLogin(),true);googleExchangeStatus=400;const result=await finish(flow,'google');
  expect(result.headers.get('location')).toBe('https://yourfeed.example/login?error=invalid_code&provider=google');
  const raw=await env.DB.prepare('SELECT value FROM meta WHERE key=?').bind('auth:oauth:last-attempt').first<string>('value');
  expect(JSON.parse(raw!)).toMatchObject({provider:'google',code:'invalid_code'});
  for(const secret of [flow.url.searchParams.get('state')!,'fixture-authorization-code','fixture-google-secret','fixture-private-provider-description','owner@example.com']){expect(raw).not.toContain(secret);expect(result.headers.get('location')).not.toContain(secret);}
 });
 it('records only an allowed provider refusal and strips the callback error description',async()=>{
  const flow=await start('google');const result=await finish(flow,'google',{error:'access_denied',error_description:'fixture-private-description secret@example.com'});
  expect(result.headers.get('location')).toBe('https://yourfeed.example/login?error=access_denied&provider=google');
  const raw=await env.DB.prepare('SELECT value FROM meta WHERE key=?').bind('auth:oauth:last-attempt').first<string>('value');expect(JSON.parse(raw!)).toMatchObject({provider:'google',code:'access_denied'});expect(raw).not.toContain('secret@example.com');
 });
 it('normalizes unrecognized OAuth errors instead of persisting provider-supplied text',async()=>{
  const result=await finish(await start('google'),'google',{error:'fixture-sensitive-provider-error',error_description:'fixture-private-description'});
  expect(result.headers.get('location')).toBe('https://yourfeed.example/login?error=oauth_failed&provider=google');
  const raw=await env.DB.prepare('SELECT value FROM meta WHERE key=?').bind('auth:oauth:last-attempt').first<string>('value');expect(JSON.parse(raw!)).toMatchObject({provider:'google',code:'oauth_failed'});expect(raw).not.toContain('fixture-sensitive-provider-error');
 });
 it('advertises only configured providers and reveals no OAuth credentials',()=>{
  expect(authCapabilities(env)).toMatchObject({facebook:true,facebookRequiresLink:true,google:true,github:true});
  expect(authCapabilities({...env,FACEBOOK_CLIENT_SECRET:undefined})).toMatchObject({facebook:false});
  expect(JSON.stringify(authCapabilities(env))).not.toContain('fixture-facebook-secret');
 });
 it.each([false,true])('never creates an owner from a Facebook email claim (email_verified=%s)',async claim=>{
  facebook.email_verified=claim;const flow=await start();const result=await finish(flow);
  expect(result.status).toBe(302);expect(result.headers.get('location')).toContain('/login?error=');expect(await userCount()).toBe(0);expect(await accountCount()).toBe(0);
  expect(await resolveSession(new Request('https://yourfeed.example/',{headers:{cookie:cookies(result)}}),env)).toBeNull();
 });
 it('does not implicitly link Facebook to an existing verified owner by matching email',async()=>{
  await ownerLogin();const flow=await start();const result=await finish(flow);
  expect(result.headers.get('location')).toContain('account_not_linked');expect(await accountCount()).toBe(0);
 });
 it('links only during a recent owner session, then authenticates the persisted subject without trusting its email flag',async()=>{
  const ownerCookies=await ownerLogin();const flow=await start('facebook',ownerCookies,true);const linked=await finish(flow);
  expect(linked.status).toBe(302);expect(linked.headers.get('location')).toBe('/');expect(await accountCount()).toBe(1);
  const stored=await env.DB.prepare('SELECT email_verified FROM auth_user').first<number>('email_verified');expect(stored).toBe(1);
  const info=await sessionForRequest(new Request('https://yourfeed.example/',{headers:{cookie:ownerCookies}}),env);expect(info.linkedProviders).toEqual(['facebook']);
  await env.DB.prepare('DELETE FROM auth_session').run();const signIn=await finish(await start());
  expect(signIn.headers.get('location')).toBe('/');expect((await resolveSession(new Request('https://yourfeed.example/',{headers:{cookie:cookies(signIn)}}),env))?.user.email).toBe('owner@example.com');
  expect(await userCount()).toBe(1);expect(await accountCount()).toBe(1);
 });
 it('rechecks recent owner authentication on the Facebook link callback',async()=>{
  expect((await handleAuth(request('/link-social',{provider:'facebook',callbackURL:'/'}),env)).status).toBe(401);
  const ownerCookies=await ownerLogin();const flow=await start('facebook',ownerCookies,true);
  await env.DB.prepare('UPDATE auth_session SET created_at=?').bind(Date.now()-601000).run();
  expect((await finish(flow)).headers.get('location')).toContain('OWNER_ONLY');expect(await accountCount()).toBe(0);
 });
 it('does not let another Facebook subject reuse the owner email after a subject was linked',async()=>{
  const ownerCookies=await ownerLogin();expect((await finish(await start('facebook',ownerCookies,true))).headers.get('location')).toBe('/');
  await env.DB.prepare('DELETE FROM auth_session').run();facebook.id='987654321';tokenSubject=facebook.id;facebook.email_verified=true;
  const denied=await finish(await start());expect(denied.headers.get('location')).toContain('account_not_linked');expect(await accountCount()).toBe(1);
  expect(await env.DB.prepare('SELECT COUNT(*) n FROM auth_session').first<number>('n')).toBe(0);
 });
 it('does not authorize a linked Facebook subject after the local owner verification is removed',async()=>{
  const ownerCookies=await ownerLogin();expect((await finish(await start('facebook',ownerCookies,true))).headers.get('location')).toBe('/');
  await env.DB.prepare('DELETE FROM auth_session').run();await env.DB.prepare('UPDATE auth_user SET email_verified=0').run();facebook.email_verified=true;
  const denied=await finish(await start());expect(denied.headers.get('location')).toContain('OWNER_ONLY');
  expect(await env.DB.prepare('SELECT COUNT(*) n FROM auth_session').first<number>('n')).toBe(0);
 });
 it('rejects a different email or subject and tokens minted for a different Facebook app',async()=>{
  const ownerCookies=await ownerLogin();facebook.email='other@example.com';
  expect((await finish(await start('facebook',ownerCookies,true))).headers.get('location')).toContain('OWNER_ONLY');expect(await accountCount()).toBe(0);
  facebook.email='owner@example.com';tokenApp='another-app';expect((await finish(await start('facebook',ownerCookies,true))).headers.get('location')).toContain('unable_to_get_user_info');expect(await accountCount()).toBe(0);
  tokenApp='fixture-facebook-client';tokenSubject='another-subject';expect((await finish(await start('facebook',ownerCookies,true))).headers.get('location')).toContain('unable_to_get_user_info');expect(await accountCount()).toBe(0);
 });
 it('rejects forged callback state and ignores client-supplied tokens, profiles and OAuth state payloads',async()=>{
  const flow=await start('facebook','',false,{idToken:{token:'attacker-token'},user:{email:'owner@example.com',emailVerified:true},additionalData:{link:{userId:'attacker'},serverContext:{ownerSocialAction:'link'}},requestSignUp:true});
  expect(network).toEqual([]);
  const forged=await finish(flow,'facebook',{state:'forged-state'});expect(forged.headers.get('location')).toContain('state_mismatch');expect(network).toEqual([]);
  const result=await finish(flow,'facebook',{user:JSON.stringify({email:'owner@example.com',emailVerified:true,id:'123456789'})});
  expect(result.headers.get('location')).toContain('signup_disabled');expect(await userCount()).toBe(0);expect(await accountCount()).toBe(0);
 });
 it('cannot use a Google link state to authorize a Facebook binding',async()=>{
  const flow=await start('google',await ownerLogin(),true);const result=await finish(flow,'facebook');
  expect(result.headers.get('location')).toContain('OWNER_ONLY');expect(await accountCount()).toBe(0);
 });
 it.each(['google','github'])('preserves verified %s login and rejects an unverified mailbox',async provider=>{
  googleVerified=false;githubVerified=false;
  const rejected=await finish(await start(provider),provider);expect(rejected.headers.get('location')).toContain('OWNER_ONLY');expect(await userCount()).toBe(0);
  googleVerified=true;githubVerified=true;const accepted=await finish(await start(provider),provider);
  expect(accepted.headers.get('location')).toBe('/');expect((await resolveSession(new Request('https://yourfeed.example/',{headers:{cookie:cookies(accepted)}}),env))?.user.email).toBe('owner@example.com');
 });
});
