'use client';
import { branding } from '../../data/branding';

import { useEffect, useState } from 'react';
import { ArrowRight, Check, KeyRound, Loader2, LockKeyhole, Mail, ShieldCheck } from 'lucide-react';
import { LanguageToggle, useI18n } from '../i18n';
import ThemeToggle from './ThemeToggle';
import './Login.css';
import {allowedLoginProviders,continueSocialLink,LinkContinuationError,linkReauthPath,loginIntent,socialDestination,verifyAndContinue,type SocialProvider} from '../../shared/auth-flow';

interface AuthConfig {authMode:'standalone'|'sites';configured:boolean;emailOtp:boolean;google:boolean;github:boolean;facebook?:boolean;facebookRequiresLink?:boolean;ownerOnly:boolean;}
interface Session {authenticated:boolean;user?:{email?:string};authMode?:'standalone'|'sites';linkedProviders?:SocialProvider[];}
const mailErrors:Record<string,readonly[string,string]>={
 test_recipient_restricted:['邮件服务限制了测试收件人。请让管理员检查 Resend 测试收件限制，或配置已验证的发件域名。','The mail service restricts test recipients. Ask the administrator to check Resend test recipient restrictions or configure a verified sender domain.'],
 sender_unverified:['发件域名尚未验证。请让管理员在 Resend 验证发件域名并检查发件地址。','The sender domain is not verified. Ask the administrator to verify the domain in Resend and check the sender address.'],
 credentials_rejected:['邮件服务凭据无效或无发送权限。请让管理员检查 Resend API 密钥与权限。','The mail service credentials were rejected. Ask the administrator to check the Resend API key and sending permissions.'],
 provider_rate_limited:['邮件服务暂时限流。请稍后重试，或让管理员检查 Resend 发送限额。','The mail service is rate limited. Try again later, or ask the administrator to check the Resend sending limits.'],
 request_rate_limited:['请求过于频繁。请等待至少 60 秒后再获取验证码。','Too many requests. Wait at least 60 seconds before requesting another code.'],
 transport_unavailable:['暂时无法连接邮件服务。请稍后重试；若持续出现，请让管理员检查服务连接。','The mail service could not be reached. Try again later; if it continues, ask the administrator to check the service connection.'],
 provider_unavailable:['邮件服务暂时不可用。请稍后重试。','The mail service is temporarily unavailable. Please try again later.'],
 not_configured:['邮箱验证码尚未配置。请联系实例管理员，或使用其他已启用的登录方式。','Email codes are not configured. Contact the administrator or use another enabled sign-in method.'],
 sending_rejected:['邮件服务拒绝了发送请求。请让管理员检查 Resend 发件配置与发送权限。','The mail service rejected the sending request. Ask the administrator to check the Resend sender configuration and sending permissions.'],
 invalid_provider_response:['邮件服务未确认接收发送请求。请稍后重试，或联系实例管理员。','The mail service did not confirm acceptance. Try again later or contact the administrator.'],
 sending_unavailable:['验证码暂未发送，请稍后重试。','The code could not be sent. Please try again later.'],
};
class AuthRequestError extends Error {constructor(public reason:string,readonly status:number){super('Authentication request failed');}}
const oauthErrors:Record<string,readonly[string,string]>={
 not_linked:['该社交账户尚未绑定。请用邮箱验证码确认本人，再继续绑定。','This social account is not linked. Confirm your identity by email, then continue linking.'],
 exchange:['服务端未能完成授权码交换。请让管理员检查 OAuth 配置与网络连接后重试。','The server could not exchange the authorization code. Ask the administrator to check the OAuth configuration and network connection.'],
 state:['登录验证状态已过期或丢失。请从本站重新发起登录，不要继续使用旧的回调页面。','The sign-in verification state expired or was lost. Start again from this site instead of reusing an old callback page.'],
 owner:['授权账户的邮箱不匹配所有者，或尚未通过验证。请使用正确的所有者账户。','The provider email does not match the owner or is not verified. Use the correct owner account.'],
 denied:['授权已取消或被服务商拒绝。你可以重新授权，或使用邮箱登录。','Authorization was cancelled or denied by the provider. Try again or sign in by email.'],
 identity:['未能取得可验证的账户资料。请确认已授权邮箱权限，或让管理员检查登录配置。','Verified account details could not be obtained. Check email permissions or ask the administrator to review the sign-in configuration.'],
 unavailable:['社交登录未完成。请重试或使用邮箱登录；若持续失败，请让管理员检查登录配置。','Social sign-in did not complete. Retry or sign in by email; if it continues, ask the administrator to check the configuration.'],
};

export default function Login(){
 const {t,language}=useI18n();const [config,setConfig]=useState<AuthConfig|null>(null);const [loading,setLoading]=useState(true);const [error,setError]=useState('');const [email,setEmail]=useState('');const [code,setCode]=useState('');const [sent,setSent]=useState(false);const [busy,setBusy]=useState(false);const [message,setMessage]=useState('');const [reauth,setReauth]=useState(false);const [retry,setRetry]=useState(0);const [pendingLink,setPendingLink]=useState<SocialProvider>();const [linkedProviders,setLinkedProviders]=useState<SocialProvider[]>([]);const [notLinkedProvider,setNotLinkedProvider]=useState<SocialProvider>();const [otpVerified,setOtpVerified]=useState(false);
 useEffect(()=>{
  const controller=new AbortController();setLoading(true);setError('');
  const intent=loginIntent(window.location.search);setReauth(intent.reauth);setPendingLink(intent.pendingLink);
  if(intent.oauthFailed)setError('oauth:'+intent.oauthFailure);
  void Promise.all([
   fetch('/api/auth/config',{signal:controller.signal,credentials:'same-origin',cache:'no-store'}).then(async response=>{if(!response.ok)throw Error();return response.json() as Promise<AuthConfig>;}),
   fetch('/api/session',{signal:controller.signal,credentials:'same-origin',cache:'no-store'}).then(response=>response.ok?response.json() as Promise<Session>:null),
  ]).then(([auth,session])=>{
   if(controller.signal.aborted)return;setConfig(auth);
   setLinkedProviders(session?.authenticated&&Array.isArray(session.linkedProviders)?session.linkedProviders:[]);
   if(session?.authenticated&&session.user?.email)setEmail(session.user.email);
   if(intent.accountNotLinked)setNotLinkedProvider(intent.failedProvider||(auth.google?'google':undefined));
   if(session?.authenticated&&!intent.reauth&&!intent.oauthFailed)window.location.replace('/');
  }).catch(()=>{if(!controller.signal.aborted)setError('configuration');}).finally(()=>{if(!controller.signal.aborted)setLoading(false);});
  return()=>controller.abort();
 },[retry]);
 const call=async(path:string,body:unknown)=>{const response=await fetch(path,{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json','Accept-Language':language==='zh'?'zh-CN':'en'},body:JSON.stringify(body)});if(!response.ok){let detail:unknown;try{detail=await response.json();}catch{}const data=detail&&typeof detail==='object'?detail as Record<string,unknown>:{};const reason=data.code==='AUTH_EMAIL_SEND_FAILED'&&typeof data.reason==='string'&&Object.hasOwn(mailErrors,data.reason)?data.reason:response.status===429?'request_rate_limited':'';throw new AuthRequestError(reason,response.status);}return response.json() as Promise<{url?:string;success?:boolean}>;};
 const send=async()=>{if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)){setError('email');return;}setBusy(true);setError('');setMessage('');try{await call('/api/auth/email-otp/send-verification-otp',{email:email.trim(),type:'sign-in'});setSent(true);setOtpVerified(false);setCode('');setMessage('sent');}catch(error){setError(error instanceof AuthRequestError&&error.reason?'mail:'+error.reason:'send');}finally{setBusy(false);}};
 const enterCode=()=>{if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)){setError('email');return;}setSent(true);setOtpVerified(false);setError('');setMessage('');};
 const verify=async()=>{
  if(!otpVerified&&!/^\d{6}$/.test(code)){setError('code');return;}
  setBusy(true);setError('');
  try{
   const destination=otpVerified&&pendingLink?await continueSocialLink(call,pendingLink):await verifyAndContinue(call,email,code,pendingLink);
   window.location.assign(destination);
  }catch(cause){
   const linkFailure=cause instanceof LinkContinuationError||otpVerified&&!!pendingLink;
   const detail=cause instanceof LinkContinuationError?cause.cause:cause;
   if(linkFailure){const expired=detail instanceof AuthRequestError&&detail.status===401;setOtpVerified(!expired);if(expired){setSent(false);setCode('');}setError('link');}
   else setError('verify');
   setBusy(false);
  }
 };
 const social=async(provider:SocialProvider)=>{setBusy(true);setError('');try{const result=await call('/api/auth/sign-in/social',{provider,callbackURL:'/'});window.location.assign(socialDestination(provider,result.url));}catch{setError('social');setBusy(false);}};
 const visibleProviders=config?allowedLoginProviders(config,reauth,pendingLink,linkedProviders):[];
 const pendingName=pendingLink==='google'?'Google':pendingLink==='github'?'GitHub':'Facebook';
 const mailError=error.startsWith('mail:')?mailErrors[error.slice(5)]:undefined;const oauthError=error.startsWith('oauth:')?oauthErrors[error.slice(6)]:undefined;
 const errorText=mailError?t(mailError[0],mailError[1]):oauthError?t(oauthError[0],oauthError[1]):error==='configuration'?t('登录配置暂时无法读取，请重试。','Sign-in configuration could not be loaded. Please retry.'):error==='email'?t('请填写有效的邮箱地址。','Enter a valid email address.'):error==='code'?t('请填写六位验证码。','Enter the six-digit verification code.'):error==='send'?t('验证码暂未发送，请稍后重试。','The code could not be sent. Please try again later.'):error==='verify'?t('验证码无效、已过期或无法访问此实例，请重新获取并核对邮箱。','The code is invalid or expired, or this account cannot access the instance. Check the email and request a new code.'):error==='link'?t('邮箱登录已完成，但绑定尚未启动。请重试；若会话已过期，请重新获取验证码。','Email sign-in completed, but account linking has not started. Retry; request a new code if the session expired.'):error==='social'?t('暂时无法使用此登录方式，请重试。','This sign-in method is currently unavailable. Please retry.'):'';
 return <main className="login-shell"><header className="login-top"><a className="login-brand" href="/">{branding.prefix}<span>{branding.suffix}</span></a><div><LanguageToggle/><ThemeToggle/></div></header><section className="login-card" aria-labelledby="login-title"><div className="login-heading"><div className="login-symbol"><LockKeyhole size={30}/></div><div><span className="login-eyebrow">{t('你的来源。你的空间。','YOUR SOURCES. YOUR SPACE.')}</span><h1 id="login-title">{reauth?t('再确认一次，是你本人。','Confirm it’s you.'):t('回到属于你的内容空间。','Return to your own space.')}</h1></div></div><p className="login-description">{t('安全登录后，继续阅读、收藏与整理你的发现。','Sign in securely to continue reading, saving, and organizing your discoveries.')}</p>
 {loading?<div className="login-loading" role="status"><Loader2 size={18} className="spin"/>{t('正在检查登录方式…','Checking sign-in methods…')}</div>:error==='configuration'?<button className="primary-button full" onClick={()=>setRetry(value=>value+1)}>{t('重新加载','Reload')}</button>:config?.authMode==='sites'?<><a className="primary-button full login-native" href="/signin-with-chatgpt?return_to=%2F" target="_top"><ShieldCheck size={16}/>{t('使用 ChatGPT 登录','Sign in with ChatGPT')}<ArrowRight size={15}/></a><p className="login-help">{t('此实例使用 Sites 的安全登录，仅授权的所有者可访问。','This instance uses secure Sites sign-in and is accessible only to its authorized owner.')}</p></>:config?.configured?<>
 {visibleProviders.length>0&&<div className="login-socials">{visibleProviders.includes('google')&&<button type="button" className="small-button" disabled={busy} onClick={()=>void social('google')}>Google</button>}{visibleProviders.includes('github')&&<button type="button" className="small-button" disabled={busy} onClick={()=>void social('github')}>GitHub</button>}{visibleProviders.includes('facebook')&&<button type="button" className="small-button login-facebook" disabled={busy} onClick={()=>void social('facebook')} aria-describedby={config.facebookRequiresLink?'facebook-link-help':undefined}><span>Facebook</span><small>{t('已绑定账户登录','Linked accounts only')}</small></button>}</div>}{visibleProviders.includes('facebook')&&config.facebookRequiresLink&&<p id="facebook-link-help" className="login-social-help">{config.emailOtp?t('首次请先用邮箱登录，再从账户菜单绑定 Facebook。','First sign in by email, then link Facebook from the account menu.'):t('首次请先通过其他已启用的方式登录，再从账户菜单绑定 Facebook。','First sign in using another enabled method, then link Facebook from the account menu.')}</p>}
 {pendingLink&&<p className="login-social-help" role="status">{config.emailOtp?t(`先使用邮箱验证码确认本人，验证后会直接前往 ${pendingName} 完成绑定。`,`Confirm your identity with an email code, then continue directly to ${pendingName} to link the account.`):t('绑定前需要先验证本人。此实例尚未启用邮箱验证码，请联系管理员启用，或先用已经绑定的账户登录。','Verify your identity before linking. Email codes are not enabled; contact the administrator or sign in using an already linked account.')}</p>}
 {config.emailOtp&&<form onSubmit={event=>{event.preventDefault();void(otpVerified&&pendingLink?verify():sent?verify():send());}}><div className={`login-fields ${sent?'has-code':''}`}><div className="form-field"><label className="form-label" htmlFor="owner-email"><Mail size={13}/>{t('登录邮箱（收件地址）','Sign-in email')}</label><input id="owner-email" aria-describedby="owner-email-help login-spam-hint" className="form-input" type="email" autoComplete="email" value={email} onChange={event=>{setEmail(event.target.value);setSent(false);setCode('');setMessage('');setOtpVerified(false);}} placeholder="you@example.com" required disabled={busy||otpVerified}/><p id="owner-email-help" className="login-help">{t('使用所有者的收件邮箱，而不是发件地址。','Use the owner’s recipient email, not the sender address.')}</p></div>{sent&&<div className="form-field"><label className="form-label" htmlFor="login-code"><KeyRound size={13}/>{t('邮箱验证码','Email verification code')}</label><input id="login-code" aria-describedby="login-spam-hint" className="form-input login-code" type="text" autoComplete="one-time-code" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} value={code} onChange={event=>setCode(event.target.value.replace(/\D/g,''))} placeholder="000000" required disabled={busy||otpVerified}/></div>}</div><button className="primary-button full" type="submit" disabled={busy}>{busy?<Loader2 size={16} className="spin"/>:<ArrowRight size={16}/>} {busy?t('正在处理…','Working…'):otpVerified&&pendingLink?t(`继续绑定 ${pendingName}`,`Continue linking ${pendingName}`):sent?(pendingLink?t('验证并继续绑定','Verify and continue linking'):t('验证并登录','Verify and sign in')):t('发送登录验证码','Send sign-in code')}</button>{sent?<button className="login-resend" type="button" onClick={()=>void send()} disabled={busy}>{t('重新发送验证码','Send another code')}</button>:<button className="login-resend" type="button" onClick={enterCode} disabled={busy}>{t('我已收到验证码','I already have a code')}</button>}<p id="login-spam-hint" className="login-spam-hint"><Mail size={18}/><span>{t('未收到？检查垃圾邮件，找到后标记为「不是垃圾邮件」。','Missing code? Check Spam/Junk and mark it “Not spam”.')}</span></p></form>}
 {!config.emailOtp&&!config.google&&!config.github&&!config.facebook&&<p className="login-setup-note">{t('此实例尚未启用可用的登录方式，请联系实例管理员。','No sign-in method is enabled. Contact the instance administrator.')}</p>}
 </>:<div className="login-setup-note"><ShieldCheck size={23}/><h2>{t('先完成实例的安全配置','Complete the instance security setup')}</h2><p>{t('登录尚未配置，内容与设置保持锁定。管理员需要设置所有者邮箱、会话密钥，以及邮件或 OAuth 服务。','Sign-in is not configured, so content and settings remain locked. The administrator must configure the owner email, session secret, and an email or OAuth service.')}</p></div>}
 {message==='sent'&&<p className="login-message" role="status"><Check size={14}/>{t('若此邮箱已获授权，邮件服务已受理发送。请检查收件箱。','If this email is authorized, the mail service accepted the request. Check your inbox.')}</p>}{errorText&&<p className="login-error" role="alert">{errorText}</p>}{notLinkedProvider&&!pendingLink&&config?.emailOtp&&config[notLinkedProvider]&&<a className="small-button login-native" href={linkReauthPath(notLinkedProvider)}>{t(`用邮箱确认并绑定 ${notLinkedProvider==='google'?'Google':notLinkedProvider==='github'?'GitHub':'Facebook'}`,`Confirm by email and link ${notLinkedProvider==='google'?'Google':notLinkedProvider==='github'?'GitHub':'Facebook'}`)}</a>}<footer className="login-security"><ShieldCheck size={13}/>{t('仅实例所有者可访问 · 不开放公共注册','Owner access only · No public registration')}</footer></section><div className="login-footnote">{t('你的来源，你的节奏。','Your sources. Your pace.')}</div></main>;
}
