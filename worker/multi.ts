import base from './index';
import type {Env} from '../server/db';
import {fixtureOtp} from '../server/multi-accounts';
import {handleAuth,resolveSession,consumeAuthRate} from '../server/auth';
import {sessionForRequest} from '../server/session';
export {TenantFeed} from './tenant';
export interface MultiEnv extends MultiBindings {APP_ENCRYPTION_KEY?:string;[key:string]:unknown;}
function authEnv(env:MultiEnv):Env{return {...env,DB:env.AUTH_DB};}
export async function runTenantCron(env:MultiEnv){
 const db=env.AUTH_DB;
 const pending=await db.prepare('SELECT user_id FROM account_deletions ORDER BY requested_at LIMIT 2').all<{user_id:string}>();
 let deleted=0;
 for(const row of pending.results){
  if(!await env.TENANT_FEEDS.getByName(row.user_id).erase())continue;
  await db.batch([db.prepare('DELETE FROM auth_session WHERE user_id=?').bind(row.user_id),db.prepare('DELETE FROM auth_account WHERE user_id=?').bind(row.user_id),db.prepare('DELETE FROM auth_user WHERE id=?').bind(row.user_id),db.prepare('DELETE FROM account_deletions WHERE user_id=?').bind(row.user_id)]);
  deleted++;
 }
 const cursor=await db.prepare("SELECT value FROM multi_state WHERE key='cron:cursor'").first<string>('value')||'';
 const selected=await db.prepare('SELECT id,email FROM auth_user WHERE id NOT IN (SELECT user_id FROM account_deletions) ORDER BY (id>?) DESC,id LIMIT 1').bind(cursor).first<{id:string;email:string}>();
 if(!selected)return {processed:0,deleted};
 await db.prepare("INSERT INTO multi_state(key,value) VALUES ('cron:cursor',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(selected.id).run();
 await env.TENANT_FEEDS.getByName(selected.id).background(selected);
 return {processed:1,deleted};
}
export default {
 async scheduled(_event:ScheduledEvent,env:MultiEnv,ctx:ExecutionContext){ctx.waitUntil(runTenantCron(env));},
 async fetch(request:Request,env:MultiEnv,ctx:ExecutionContext):Promise<Response>{
  try{
  if(env.HOSTING_MODE!=='multi'||env.AUTH_MODE!=='standalone')return Response.json({error:'Multi hosting is not configured'},{status:503});
  const url=new URL(request.url),auth=authEnv(env);
  if(url.origin!==env.AUTH_BASE_URL)return Response.json({error:'Invalid origin'},{status:403});
  if(url.pathname==='/api/auth/test-cron'){
   const expected=fixtureOtp(auth,'cron@example.test');
   if(!expected)return Response.json({error:'Not found'},{status:404});
   if(request.method!=='POST'||request.headers.get('origin')!==url.origin||!await consumeAuthRate(auth,'test-cron',request.headers.get('cf-connecting-ip')||'unknown',5,3600))return Response.json({error:'Forbidden'},{status:403});
   const session=await resolveSession(request,auth);
   if(!session?.user.email?.endsWith('@example.test')||request.headers.get('x-test-fixture')!==expected)return Response.json({error:'Forbidden'},{status:403});
   return Response.json(await runTenantCron(env),{headers:{'Cache-Control':'no-store'}});
  }
  if(url.pathname.startsWith('/api/auth/'))return handleAuth(request,auth);
  if(url.pathname==='/api/session')return Response.json(await sessionForRequest(request,auth),{headers:{'Cache-Control':'no-store'}});
  if(url.pathname==='/api/health'){
   const ready=await env.AUTH_DB.prepare('SELECT id FROM multi_policy WHERE id=1').first();
   const ok=!!ready&&typeof env.AUTH_SECRET==='string'&&env.AUTH_SECRET.length>=32&&typeof env.APP_ENCRYPTION_KEY==='string'&&env.APP_ENCRYPTION_KEY.length>=32;
   return Response.json({ok,schemaReady:!!ready,name:'YourFeed',hostingMode:'multi'},{status:ok?200:503,headers:{'Cache-Control':'no-store'}});
  }
  if(url.pathname.startsWith('/api/')){
   const session=await resolveSession(request,auth);
   if(!session)return Response.json({error:'Sign in required'},{status:401,headers:{'Cache-Control':'no-store'}});
   // Binding RPC carries the verified identity independently of client headers.
   return env.TENANT_FEEDS.getByName(session.user.id).api(request,session);
  }
  return await base.fetch(request,auth,ctx);
  }catch{console.warn(JSON.stringify({event:'multi_request_failed'}));return Response.json({error:'Service temporarily unavailable'},{status:503,headers:{'Cache-Control':'no-store'}});}
 }
};
