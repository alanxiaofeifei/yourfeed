import { betterAuth } from 'better-auth/minimal';
import { addOAuthServerContext, createAuthMiddleware, getOAuthState } from 'better-auth/api';
import { emailOTP } from 'better-auth/plugins/email-otp';
import { drizzleAdapter } from '@better-auth/drizzle-adapter';
import { drizzle } from 'drizzle-orm/d1';
import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';
import type { Env } from './db';
import { HttpError } from './security';

const authUser=sqliteTable('auth_user',{id:text('id').primaryKey(),name:text('name').notNull(),email:text('email').notNull().unique(),emailVerified:integer('email_verified',{mode:'boolean'}).notNull().default(false),image:text('image'),createdAt:integer('created_at',{mode:'timestamp_ms'}).notNull(),updatedAt:integer('updated_at',{mode:'timestamp_ms'}).notNull()});
const authSession=sqliteTable('auth_session',{id:text('id').primaryKey(),expiresAt:integer('expires_at',{mode:'timestamp_ms'}).notNull(),token:text('token').notNull().unique(),createdAt:integer('created_at',{mode:'timestamp_ms'}).notNull(),updatedAt:integer('updated_at',{mode:'timestamp_ms'}).notNull(),ipAddress:text('ip_address'),userAgent:text('user_agent'),userId:text('user_id').notNull().references(()=>authUser.id,{onDelete:'cascade'})});
const authAccount=sqliteTable('auth_account',{id:text('id').primaryKey(),accountId:text('account_id').notNull(),providerId:text('provider_id').notNull(),userId:text('user_id').notNull().references(()=>authUser.id,{onDelete:'cascade'}),accessToken:text('access_token'),refreshToken:text('refresh_token'),idToken:text('id_token'),accessTokenExpiresAt:integer('access_token_expires_at',{mode:'timestamp_ms'}),refreshTokenExpiresAt:integer('refresh_token_expires_at',{mode:'timestamp_ms'}),scope:text('scope'),password:text('password'),createdAt:integer('created_at',{mode:'timestamp_ms'}).notNull(),updatedAt:integer('updated_at',{mode:'timestamp_ms'}).notNull()});
const authVerification=sqliteTable('auth_verification',{id:text('id').primaryKey(),identifier:text('identifier').notNull(),value:text('value').notNull(),expiresAt:integer('expires_at',{mode:'timestamp_ms'}).notNull(),createdAt:integer('created_at',{mode:'timestamp_ms'}).notNull(),updatedAt:integer('updated_at',{mode:'timestamp_ms'}).notNull()});
const schema={user:authUser,session:authSession,account:authAccount,verification:authVerification};
const WEEK=7*86400_000,RECENT=10*60_000;
const value=(env:Env,key:string)=>typeof env[key]==='string'?String(env[key]).trim():'';
export function authMode(env:Env):'standalone'|'sites' {return value(env,'AUTH_MODE')==='sites'?'sites':'standalone';}
export function normalizeOwnerEmail(email:string):string {return email.trim().toLowerCase();}
export function ownerIdentityAllowed(env:Env,user:{email?:unknown;emailVerified?:unknown}):boolean {const email=value(env,'OWNER_EMAIL');return !!email&&user.emailVerified===true&&typeof user.email==='string'&&normalizeOwnerEmail(user.email)===normalizeOwnerEmail(email);}
function settings(env:Env){
 const secret=value(env,'AUTH_SECRET')||value(env,'BETTER_AUTH_SECRET'),owner=normalizeOwnerEmail(value(env,'OWNER_EMAIL')),base=value(env,'AUTH_BASE_URL')||value(env,'BETTER_AUTH_URL');
 if(!env.DB||secret.length<32||!/^\S+@[^@\s]+\.[^@\s]+$/.test(owner)||!base)throw new HttpError(503,'登录服务尚未配置，请设置 OWNER_EMAIL、AUTH_SECRET、AUTH_BASE_URL 与数据库。');
 let url:URL;try{url=new URL(base);}catch{throw new HttpError(503,'AUTH_BASE_URL 配置无效。');}
 const localHttp=url.protocol==='http:'&&['localhost','127.0.0.1'].includes(url.hostname)&&value(env,'AUTH_ALLOW_INSECURE_LOCAL')==='true';
 if((url.protocol!=='https:'&&!localHttp)||url.username||url.password||url.search||url.hash||url.pathname!=='/')throw new HttpError(503,'AUTH_BASE_URL 必须是网站的 HTTPS 根地址。');
 return {secret,owner,origin:url.origin,secure:url.protocol==='https:'};
}
export async function authHmac(env:Env,text:string):Promise<string>{
 const key=value(env,'AUTH_SECRET')||value(env,'BETTER_AUTH_SECRET');if(key.length<32)throw new HttpError(503,'登录服务密钥尚未配置。');
 const material=await crypto.subtle.importKey('raw',new TextEncoder().encode(key),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 return [...new Uint8Array(await crypto.subtle.sign('HMAC',material,new TextEncoder().encode(text)))].map(x=>x.toString(16).padStart(2,'0')).join('');
}
/** One atomic persistent write; no process-memory counter or read/write race. */
export async function consumeAuthRate(env:Env,purpose:string,subject:string,limit:number,seconds:number,now=Date.now()):Promise<boolean>{
 const id=await authHmac(env,'rate:'+purpose+':'+subject);
 const result=await env.DB.prepare('INSERT INTO auth_rate(id,hits,reset_at) VALUES (?,1,?) ON CONFLICT(id) DO UPDATE SET hits=CASE WHEN auth_rate.reset_at<=? THEN 1 ELSE auth_rate.hits+1 END,reset_at=CASE WHEN auth_rate.reset_at<=? THEN excluded.reset_at ELSE auth_rate.reset_at END WHERE auth_rate.reset_at<=? OR auth_rate.hits<? RETURNING id').bind(id,now+seconds*1000,now,now,now,limit).first();
 return !!result;
}
function ip(request:Request):string {return (request.headers.get('cf-connecting-ip')||'unknown').slice(0,128);}
type MailFailureReason='not_configured'|'transport_unavailable'|'test_recipient_restricted'|'sender_unverified'|'credentials_rejected'|'provider_rate_limited'|'provider_unavailable'|'sending_rejected'|'invalid_provider_response'|'sending_unavailable';
type MailAttempt={at:string;provider:'resend';stage:'accepted'|'provider_rejected'|'network_error'|'invalid_response';code:MailFailureReason|'accepted';upstreamStatus?:number;messageId?:string};
class MailFailure extends HttpError {constructor(public code:MailFailureReason,message:string){super(503,message);}}
/** Operational metadata only. Never persist the recipient, OTP, provider body or credential. */
async function recordMailAttempt(env:Env,attempt:Omit<MailAttempt,'at'|'provider'>):Promise<void>{
 try{await env.DB.prepare('INSERT INTO meta(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').bind('auth:mail:last-attempt',JSON.stringify({at:new Date().toISOString(),provider:'resend',...attempt})).run();}catch{/* Email delivery must not depend on optional operational metadata. */}
}
async function mailResponseJson(response:Response):Promise<Record<string,unknown>>{
 if(!response.body)return {};const reader=response.body.getReader();let total=0;const chunks:Uint8Array[]=[];
 try{while(true){const part=await reader.read();if(part.done)break;total+=part.value.length;if(total>8192)throw new Error('Response too large');chunks.push(part.value);}const bytes=new Uint8Array(total);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}const result=JSON.parse(new TextDecoder().decode(bytes));return result&&typeof result==='object'&&!Array.isArray(result)?result:{};}finally{await reader.cancel().catch(()=>{});}
}
async function sendMail(env:Env,email:string,otp:string,language:'zh'|'en'):Promise<void>{
 const key=value(env,'RESEND_API_KEY'),from=value(env,'AUTH_EMAIL_FROM')||value(env,'RESEND_FROM');if(!key||!from)throw new MailFailure('not_configured','邮箱验证码尚未启用，请配置 Resend 密钥和发件地址。');
 let result:Response;try{result=await fetch('https://api.resend.com/emails',{method:'POST',redirect:'manual',signal:AbortSignal.timeout(10000),headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},body:JSON.stringify({from,to:[email],subject:language==='zh'?'YourFeed 登录验证码':'YourFeed sign-in code',text:language==='zh'?`你的 YourFeed 登录验证码：${otp}。5 分钟内有效。请勿向他人提供此验证码。如果不是你发起的请求，请忽略这封邮件。`:`Your YourFeed sign-in code is ${otp}. It expires in 5 minutes. Do not share this code. If you did not request it, you can ignore this email.`})});}catch{await recordMailAttempt(env,{stage:'network_error',code:'transport_unavailable'});throw new MailFailure('transport_unavailable','验证码发送暂时不可用，请稍后重试。');}
 let body:Record<string,unknown>={};try{body=await mailResponseJson(result);}catch{/* The public response never includes upstream response contents. */}
 if(!result.ok){
  const message=typeof body.message==='string'?body.message.toLowerCase():'';
  const code=message.includes('testing emails')||message.includes('test mode')?'test_recipient_restricted':message.includes('domain')&&(message.includes('verified')||message.includes('verify'))?'sender_unverified':result.status===401?'credentials_rejected':result.status===429?'provider_rate_limited':result.status>=500?'provider_unavailable':'sending_rejected';
  await recordMailAttempt(env,{stage:'provider_rejected',code,upstreamStatus:result.status});
  throw new MailFailure(code,code==='test_recipient_restricted'?'邮件服务限制了测试邮件收件人，请配置已验证的发件域名或检查 Resend 测试收件限制。':code==='sender_unverified'?'邮件服务尚未验证发件域名，请检查 Resend 发件地址配置。':'验证码发送暂时不可用，请检查邮件服务配置后重试。');
 }
 if(typeof body.id!=='string'||!/^[a-zA-Z0-9_-]{6,128}$/.test(body.id)){await recordMailAttempt(env,{stage:'invalid_response',code:'invalid_provider_response',upstreamStatus:result.status});throw new MailFailure('invalid_provider_response','邮件服务未确认接收发送请求，请稍后重试。');}
 await recordMailAttempt(env,{stage:'accepted',code:'accepted',upstreamStatus:result.status,messageId:body.id});
}
export function createOwnerAuth(env:Env,onMailFailure?:(failure:MailFailure)=>void){
 const config=settings(env);const socialProviders:Record<string,any>={};
 for(const [provider,prefix] of [['google','GOOGLE'],['github','GITHUB']] as const){const clientId=value(env,prefix+'_CLIENT_ID'),clientSecret=value(env,prefix+'_CLIENT_SECRET');if(clientId&&clientSecret)socialProviders[provider]={clientId,clientSecret};}
 const facebookId=value(env,'FACEBOOK_CLIENT_ID'),facebookSecret=value(env,'FACEBOOK_CLIENT_SECRET');
 // Facebook does not attest mailbox ownership. It may only authenticate a
 // subject explicitly linked by an already verified, recently signed-in owner.
 if(facebookId&&facebookSecret)socialProviders.facebook={clientId:facebookId,clientSecret:facebookSecret,disableSignUp:true,mapProfileToUser:()=>({emailVerified:false})};
 return betterAuth({
  appName:'YourFeed',baseURL:config.origin,basePath:'/api/auth',secret:config.secret,
  database:drizzleAdapter(drizzle(env.DB as any,{schema}),{provider:'sqlite',schema,transaction:false}),
  emailAndPassword:{enabled:false},socialProviders,
  session:{expiresIn:WEEK/1000,disableSessionRefresh:true,freshAge:RECENT/1000,cookieCache:{enabled:false}},
  advanced:{useSecureCookies:config.secure,cookiePrefix:'yourfeed',defaultCookieAttributes:{httpOnly:true,secure:config.secure,sameSite:'lax',path:'/'}},
  trustedOrigins:[config.origin],onAPIError:{errorURL:config.origin+'/login'},rateLimit:{enabled:false},logger:{disabled:true},
  hooks:{before:createAuthMiddleware(async context=>{
   if((context.path==='/sign-in/social'||context.path==='/link-social')&&context.body?.provider==='facebook')await addOAuthServerContext({ownerSocialProvider:'facebook',ownerSocialAction:context.path==='/link-social'?'link':'sign-in'});
  })},
  // The library calls this list "trusted": here it only permits explicit
  // Facebook linking despite its unverified email. The hook below authenticates
  // the local owner instead; implicit linking and Facebook signup remain off.
  account:{encryptOAuthTokens:true,accountLinking:{enabled:true,trustedProviders:['facebook'],requireLocalEmailVerified:true,allowDifferentEmails:false,disableImplicitLinking:true}},
  user:{changeEmail:{enabled:false},deleteUser:{enabled:false},validateUserInfo:async({user,source},context)=>{
   const denied={error:'OWNER_ONLY',errorDescription:'此实例仅允许已验证的所有者邮箱登录。'};
   if(source.method!=='oauth'||source.oauth?.providerId!=='facebook')return ownerIdentityAllowed(env,user)?undefined:denied;
   if(source.action==='create-user'||typeof user.id!=='string'||typeof user.email!=='string'||normalizeOwnerEmail(user.email)!==config.owner)return denied;
   const profile=source.oauth.profile,subject=profile?.id??profile?.sub;
   if(typeof subject!=='string'||!/^\d{1,128}$/.test(subject)||(profile?.id!==undefined&&profile?.sub!==undefined&&profile.id!==profile.sub))return denied;
   const state=await getOAuthState();
   if(state?.serverContext?.ownerSocialProvider!=='facebook'||state.serverContext.ownerSocialAction!==(source.action==='link-account'?'link':'sign-in'))return denied;
   const stored=await env.DB.prepare('SELECT email,email_verified FROM auth_user WHERE id=?').bind(user.id).first<{email:string;email_verified:number}>();
   if(!stored||!ownerIdentityAllowed(env,{email:stored.email,emailVerified:!!stored.email_verified}))return denied;
   if(source.action==='link-account'){
    if(!context.request)return denied;
    try{const owner=await requireRecentAuth(context.request,env);return owner.id===user.id?undefined:denied;}catch{return denied;}
   }
   const linked=await env.DB.prepare('SELECT id FROM auth_account WHERE provider_id=? AND account_id=? AND user_id=?').bind('facebook',subject,user.id).first();
   return linked?undefined:denied;
  }},
  databaseHooks:{user:{create:{before:async user=>{if(!ownerIdentityAllowed(env,user))return false;return {data:user};}}},session:{create:{before:async session=>{const user=await env.DB.prepare('SELECT email,email_verified FROM auth_user WHERE id=?').bind(session.userId).first<{email:string;email_verified:number}>();return user&&ownerIdentityAllowed(env,{email:user.email,emailVerified:!!user.email_verified})?{data:session}:false;}}}},
  verification:{storeInDatabase:true,storeIdentifier:{hash:identifier=>authHmac(env,'verification:'+identifier)}},
  plugins:[emailOTP({otpLength:6,expiresIn:300,allowedAttempts:5,resendStrategy:'rotate',storeOTP:{hash:otp=>authHmac(env,'otp:'+otp)},sendVerificationOTP:async({email,otp,type},ctx)=>{if(type!=='sign-in'||normalizeOwnerEmail(email)!==config.owner)throw new HttpError(403,'此登录方式不可用。');try{await sendMail(env,email,otp,ctx?.request?.headers.get('accept-language')?.toLowerCase().startsWith('zh')?'zh':'en');}catch(error){const failure=error instanceof MailFailure?error:new MailFailure('sending_unavailable','验证码发送暂时不可用，请稍后重试。');onMailFailure?.(failure);/* Better Auth deliberately swallows send-hook errors. Remove only this unsent code and propagate through the request-scoped observer. */await env.DB.prepare('DELETE FROM auth_verification WHERE identifier=? AND value=?').bind(await authHmac(env,'verification:sign-in-otp-'+normalizeOwnerEmail(email)),(await authHmac(env,'otp:'+otp))+':0').run();throw failure;}}})],
 });
}
export interface AuthSession {user:{id:string;email?:string;name?:string};session:{id:string;createdAt:Date;expiresAt:Date};}
function sitesSession(request:Request,env:Env):AuthSession|null {
 const id=request.headers.get('oai-authenticated-user-id');if(!id||id.length>256)return null;
 const email=request.headers.get('oai-authenticated-user-email')||undefined;
 if(value(env,'OWNER_EMAIL')&&normalizeOwnerEmail(email||'')!==normalizeOwnerEmail(value(env,'OWNER_EMAIL')))return null;
 let name=request.headers.get('oai-authenticated-user-full-name')||undefined;
 if(name&&request.headers.get('oai-authenticated-user-full-name-encoding')==='percent-encoded-utf-8'){try{name=decodeURIComponent(name);}catch{name=undefined;}}
 return {user:{id,...(email?{email}:{}),...(name?{name:name.replace(/[\u0000-\u001f\u007f]/g,'').slice(0,160)}:{})},session:{id:'sites-managed',createdAt:new Date(0),expiresAt:new Date(8640000000000000)}};
}
export async function resolveSession(request:Request,env:Env):Promise<AuthSession|null>{
 if(authMode(env)==='sites')return sitesSession(request,env);
 if(!request.headers.get('cookie'))return null;
 try{const auth=createOwnerAuth(env);const result=await auth.api.getSession({headers:request.headers});if(!result||!ownerIdentityAllowed(env,result.user))return null;
  const createdAt=new Date(result.session.createdAt),expiresAt=new Date(result.session.expiresAt),now=Date.now();
  if(!Number.isFinite(createdAt.getTime())||!Number.isFinite(expiresAt.getTime())||createdAt.getTime()>now||expiresAt.getTime()<=now||createdAt.getTime()+WEEK<=now)return null;
  return {user:{id:result.user.id,email:result.user.email,name:result.user.name},session:{id:result.session.id,createdAt,expiresAt}};
 }catch{return null;}
}
export async function requireUser(request:Request,env:Env):Promise<AuthSession['user']>{const session=await resolveSession(request,env);if(!session)throw new HttpError(401,'请先登录你的私人实例。');return session.user;}
export async function requireRecentAuth(request:Request,env:Env):Promise<AuthSession['user']>{const session=await resolveSession(request,env);if(!session)throw new HttpError(401,'请先登录你的私人实例。');if(authMode(env)==='sites')return session.user;if(Date.now()-session.session.createdAt.getTime()>RECENT)throw new HttpError(401,'请重新登录后再修改敏感设置。');return session.user;}
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}});
const OAUTH_FAILURE_CODES=new Set(['account_not_linked','OWNER_ONLY','unable_to_link_account','email_does_not_match','invalid_code','state_mismatch','state_not_found','state_security_mismatch','state_invalid','unable_to_get_user_info','signup_disabled','access_denied','invalid_callback_request','provider_not_found','no_code','user_not_found','account_already_linked_to_different_user','unable_to_create_user']);
/** Keep fixed operational codes only: callback parameters and provider text can contain secrets. */
async function oauthCallbackResult(env:Env,result:Response,origin:string,provider:string):Promise<Response>{
 const location=result.headers.get('location');if(!location)return result;
 let destination:URL;try{destination=new URL(location,origin);}catch{return result;}
 if(destination.origin!==origin||destination.pathname!=='/login'||!destination.searchParams.has('error'))return result;
 const supplied=destination.searchParams.get('error')||'',code=OAUTH_FAILURE_CODES.has(supplied)?supplied:'oauth_failed';
 try{await env.DB.prepare('INSERT INTO meta(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').bind('auth:oauth:last-attempt',JSON.stringify({at:new Date().toISOString(),provider,code})).run();}catch{/* Optional diagnostics cannot affect sign-in. */}
 const safe=new URL('/login',origin);safe.searchParams.set('error',code);safe.searchParams.set('provider',provider);
 const headers=new Headers(result.headers);headers.set('Location',safe.toString());headers.set('Cache-Control','no-store');await result.body?.cancel();return new Response(null,{status:result.status,headers});
}
export function authCapabilities(env:Env){
 const mode=authMode(env);let configured=mode==='sites';try{if(mode==='standalone'){settings(env);configured=true;}}catch{}
 return {authMode:mode,configured,ownerOnly:true,emailOtp:configured&&mode==='standalone'&&!!value(env,'RESEND_API_KEY')&&!!(value(env,'AUTH_EMAIL_FROM')||value(env,'RESEND_FROM')),google:configured&&mode==='standalone'&&!!value(env,'GOOGLE_CLIENT_ID')&&!!value(env,'GOOGLE_CLIENT_SECRET'),github:configured&&mode==='standalone'&&!!value(env,'GITHUB_CLIENT_ID')&&!!value(env,'GITHUB_CLIENT_SECRET'),facebook:configured&&mode==='standalone'&&!!value(env,'FACEBOOK_CLIENT_ID')&&!!value(env,'FACEBOOK_CLIENT_SECRET'),facebookRequiresLink:true,sessionDays:7,recentAuthMinutes:10,otpExpiresSeconds:300,otpResendSeconds:60};
}
export async function handleAuth(request:Request,env:Env):Promise<Response>{
 const path=new URL(request.url).pathname;
 if(path==='/api/auth/config'&&request.method==='GET')return json(authCapabilities(env));
 if(authMode(env)==='sites')return json({error:'Sites 模式请使用 ChatGPT 登录入口。'},400);
 try{
  const config=settings(env),origin=new URL(request.url).origin;
  if(origin!==config.origin)throw new HttpError(403,'登录请求来源不匹配。');
  const relative=path.slice('/api/auth'.length);const callback=/^\/callback\/(google|github|facebook)$/.test(relative);
  const allowed=new Set(['/email-otp/send-verification-otp','/sign-in/email-otp','/sign-in/social','/link-social','/sign-out','/revoke-sessions']);
  if(!allowed.has(relative)&&!callback)return json({error:'登录接口不存在。'},404);
  if(!callback){if(request.method!=='POST')return json({error:'请求方法不支持。'},405);if(request.headers.get('origin')!==config.origin||!request.headers.get('content-type')?.includes('application/json'))throw new HttpError(403,'请从本站页面发起登录请求。');}
  let body:Record<string,unknown>={};
  if(request.method==='POST'&&!callback){const raw=await request.clone().text();if(raw.length>4096)throw new HttpError(413,'登录请求内容过大。');try{body=JSON.parse(raw);}catch{throw new HttpError(400,'登录请求格式不正确。');}if(!body||typeof body!=='object'||Array.isArray(body))throw new HttpError(400,'登录请求格式不正确。');}
  if(relative==='/revoke-sessions'||relative==='/link-social')await requireRecentAuth(request,env);
  if(relative==='/email-otp/send-verification-otp'){
   if(!authCapabilities(env).emailOtp)throw new HttpError(503,'邮箱验证码尚未配置，可使用已启用的其他登录方式。');
   if(typeof body.email!=='string'||!/^\S+@[^@\s]+\.[^@\s]+$/.test(body.email)||body.email.length>254||body.type!=='sign-in')throw new HttpError(400,'请输入有效邮箱并请求登录验证码。');
   if(!await consumeAuthRate(env,'send-ip',ip(request),10,3600))throw new HttpError(429,'请求过于频繁，请稍后再试。');
   if(!await consumeAuthRate(env,'send-email',normalizeOwnerEmail(body.email),1,60))throw new HttpError(429,'请等待 60 秒后再获取验证码。');
   if(normalizeOwnerEmail(body.email)!==config.owner)return json({success:true});
  }
  if(relative==='/sign-in/email-otp'){
   if(typeof body.email!=='string'||typeof body.otp!=='string'||!/^\d{6}$/.test(body.otp))throw new HttpError(400,'请输入邮箱与六位验证码。');
   if(!await consumeAuthRate(env,'verify-ip',ip(request),30,600))throw new HttpError(429,'验证请求过于频繁，请稍后再试。');
   if(normalizeOwnerEmail(body.email)!==config.owner)throw new HttpError(400,'验证码无效或已过期。');
  }
  if(relative==='/sign-in/social'||relative==='/link-social'){
   if(body.provider!=='google'&&body.provider!=='github'&&body.provider!=='facebook')throw new HttpError(400,'请选择已启用的登录方式。');
   if(!authCapabilities(env)[body.provider])throw new HttpError(503,'此社交登录尚未配置。');
   if(body.callbackURL!==undefined&&body.callbackURL!=='/')throw new HttpError(400,'登录完成后仅允许返回本站首页。');
   if(!await consumeAuthRate(env,'social-ip',ip(request),20,600))throw new HttpError(429,'请求过于频繁，请稍后再试。');
  }
  let forwarded=request;
  if(!callback){const safeBody=relative==='/email-otp/send-verification-otp'?{email:normalizeOwnerEmail(String(body.email)),type:'sign-in'}:relative==='/sign-in/email-otp'?{email:normalizeOwnerEmail(String(body.email)),otp:body.otp}:relative==='/sign-in/social'||relative==='/link-social'?{provider:body.provider,callbackURL:'/'}:{};const headers=new Headers(request.headers);headers.delete('content-length');forwarded=new Request(request.url,{method:'POST',headers,body:JSON.stringify(safeBody)});}
  let mailFailure:MailFailure|undefined;const auth=createOwnerAuth(env,failure=>{mailFailure=failure;});const result=await auth.handler(forwarded);
  // Native runInBackgroundOrAwait awaits but catches hook errors; never report successful sending after rejection.
  if(mailFailure){await result.body?.cancel();throw mailFailure;}
  if(callback&&result.status>=300&&result.status<400)return oauthCallbackResult(env,result,config.origin,relative.slice('/callback/'.length));
  if(result.status>=400){if(relative==='/sign-in/email-otp'&&result.status<500&&result.status!==429)return json({error:'验证码无效或已过期。'},400);return json({error:result.status===429?'请求过于频繁，请稍后重试。':'登录未完成，请检查验证码、邮箱或登录服务配置。'},result.status);}
  // Sign-in session token stays in the HttpOnly cookie; never copy it into browser-readable JSON.
  if(relative==='/sign-in/email-otp'){const headers=new Headers(result.headers);headers.set('Content-Type','application/json');headers.set('Cache-Control','no-store');await result.body?.cancel();return new Response(JSON.stringify({success:true}),{status:result.status,headers});}
  if(relative==='/revoke-sessions'){const signout=await auth.handler(new Request(config.origin+'/api/auth/sign-out',{method:'POST',headers:request.headers,body:'{}'}));const headers=new Headers(result.headers);for(const cookie of signout.headers.getSetCookie())headers.append('Set-Cookie',cookie);return new Response(await result.text(),{status:result.status,headers});}
  return result;
 }catch(error){return json({error:error instanceof HttpError?error.message:'登录服务暂时不可用，请稍后再试。',...(error instanceof MailFailure?{code:'AUTH_EMAIL_SEND_FAILED',reason:error.code}:{})},error instanceof HttpError?error.status:503);}
}
