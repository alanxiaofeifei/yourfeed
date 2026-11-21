import type {Env} from './db';
import {HttpError} from './security';
import {localeFromTag} from '../shared/language';
import {signupMailto,signupMessages} from '../shared/signup';
export const isMulti=(env:Env)=>env.HOSTING_MODE==='multi';
export function maxAccounts(env:Env):number {
 const n=Number(env.MAX_ACCOUNTS??10);
 if(!Number.isSafeInteger(n)||n<0||n>10000)throw new HttpError(503,'Invalid account capacity');
 return n;
}
export async function syncAccountCap(env:Env){const result=await env.DB.prepare('UPDATE multi_policy SET max_accounts=? WHERE id=1').bind(maxAccounts(env)).run();if(result.meta.changes!==1)throw new HttpError(503,'Account policy unavailable');}
export async function signupOpen(env:Env,email:string):Promise<boolean> {
 const row=await env.DB.prepare(`SELECT (EXISTS(SELECT 1 FROM auth_user WHERE email=? COLLATE NOCASE) OR EXISTS(SELECT 1 FROM approved_emails WHERE email=? COLLATE NOCASE) OR (SELECT count(*) FROM auth_user)<?) AS allowed`).bind(email,email,maxAccounts(env)).first<{allowed:number}>();
 return row?.allowed===1;
}
export function fullResponse(email:string,request:Request){
 const language=localeFromTag(request.headers.get('accept-language'));
 return Response.json({code:'ACCOUNT_CAP_FULL',status:'full',error:signupMessages[language].full,mailto:signupMailto(email,language)},{status:403,headers:{'Cache-Control':'no-store'}});
}
/** Requires BOTH the exact preview deployment and a synthetic mailbox. Never sends mail. */
export function fixtureOtp(env:Env,email:string):string|undefined {
 if(env.MULTI_DEPLOYMENT!=='preview'||env.AUTH_BASE_URL!=='https://yourfeed-app-preview.alan-xiaofei224.workers.dev')return;
 const otp=env.AUTH_TEST_FIXTURE_OTP;
 return typeof otp==='string'&&/^\d{6}$/.test(otp)&&/^[a-z0-9._+-]+@example\.test$/i.test(email)?otp:undefined;
}
