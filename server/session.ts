import type {Env} from './db';
import {authMode,resolveSession} from './auth';
export interface SessionInfo {authenticated:boolean;user?:{id:string;email?:string;name?:string};signInPath:string;signOutPath:string;ownerOnly:true;authMode:'sites'|'standalone';recentAuth:boolean;}
export async function sessionForRequest(request:Request,env:Env):Promise<SessionInfo>{
 const mode=authMode(env);const session=await resolveSession(request,env);
 const base:SessionInfo={authenticated:!!session,signInPath:mode==='sites'?'/signin-with-chatgpt?return_to=%2F':'/login',signOutPath:mode==='sites'?'/signout-with-chatgpt?return_to=%2F':'/api/auth/sign-out',ownerOnly:true,authMode:mode,recentAuth:!!session&&(mode==='sites'||Date.now()-session.session.createdAt.getTime()<=600000)};
 return session?{...base,user:session.user}:base;
}
