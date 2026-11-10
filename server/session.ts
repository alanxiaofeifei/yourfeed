import type {Env} from './db';
import {authMode,resolveSession} from './auth';
export interface SessionInfo {authenticated:boolean;user?:{id:string;email?:string;name?:string};signInPath:string;signOutPath:string;ownerOnly:true;authMode:'sites'|'standalone';recentAuth:boolean;linkedProviders?:('google'|'github'|'facebook')[];}
export async function sessionForRequest(request:Request,env:Env):Promise<SessionInfo>{
 const mode=authMode(env);const session=await resolveSession(request,env);
 const base:SessionInfo={authenticated:!!session,signInPath:mode==='sites'?'/signin-with-chatgpt?return_to=%2F':'/login',signOutPath:mode==='sites'?'/signout-with-chatgpt?return_to=%2F':'/api/auth/sign-out',ownerOnly:true,authMode:mode,recentAuth:!!session&&(mode==='sites'||Date.now()-session.session.createdAt.getTime()<=600000)};
 if(!session)return base;
 if(mode==='sites')return {...base,user:session.user};
 const accounts=await env.DB.prepare('SELECT DISTINCT provider_id FROM auth_account WHERE user_id=?').bind(session.user.id).all<{provider_id:string}>();
 const linkedProviders=(['google','github','facebook'] as const).filter(provider=>accounts.results.some(account=>account.provider_id===provider));
 return {...base,user:session.user,linkedProviders};
}
