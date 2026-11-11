import {getState,setState,getUsage,type Env} from './db';
import {HttpError} from './security';

export interface BackgroundPolicy {enabled:boolean;aiEnabled:boolean;intervalHours:number;}
export async function backgroundStatus(env:Env){
 let policy:Partial<BackgroundPolicy>={};try{policy=JSON.parse(await getState(env,'background:policy')||'{}');}catch{}
 return {enabled:policy.enabled===true,aiEnabled:policy.aiEnabled===true,intervalHours:Math.max(6,Number(policy.intervalHours)||6),schedulerConfigured:env.BACKGROUND_SCHEDULE_CONFIGURED==='true',lastRun:await getState(env,'background:last-run'),lastResult:await getState(env,'background:last-result'),hostingMode:env.HOSTING_MODE==='hosted'?'hosted':'personal'};
}
export async function saveBackgroundPolicy(env:Env,input:Record<string,unknown>,ownerId?:string){
 if(input.enabled!==undefined&&typeof input.enabled!=='boolean'||input.aiEnabled!==undefined&&typeof input.aiEnabled!=='boolean')throw new HttpError(400,'后台更新开关格式无效。');
 const old=await backgroundStatus(env);const intervalHours=input.intervalHours===undefined?old.intervalHours:Number(input.intervalHours);
 if(!Number.isInteger(intervalHours)||intervalHours<6||intervalHours>168)throw new HttpError(400,'后台更新间隔应为 6–168 小时。');
 const next={enabled:input.enabled===undefined?old.enabled:input.enabled,aiEnabled:input.aiEnabled===undefined?old.aiEnabled:input.aiEnabled,intervalHours};
 if(next.aiEnabled&&!ownerId)throw new HttpError(400,'请登录后设置后台 AI。');
 if(ownerId)await setState(env,'background:owner',ownerId);
 await setState(env,'background:policy',JSON.stringify(next));return backgroundStatus(env);
}
/** Invoked only by a platform schedule, never an unauthenticated HTTP endpoint. */
export async function runBackground(env:Env,now=Date.now()){
 const {backupWriteLocked}=await import('./maintenance-backup');if(backupWriteLocked(env))return {ran:false,reason:'backup-maintenance'};
 const policy=await backgroundStatus(env);
 if(env.HOSTING_MODE==='hosted'){const {assertHostedAdmission}=await import('./hosted');await assertHostedAdmission(env);}
 // Cache housekeeping is separate from opt-in network fetching and paid AI.
 const {cleanupRetention}=await import('./retention');await cleanupRetention(env,{limit:5});
 if(!policy.enabled)return {ran:false,reason:'disabled'};
 const previous=Date.parse(policy.lastRun||'');if(Number.isFinite(previous)&&now-previous<policy.intervalHours*3600000)return {ran:false,reason:'not-due'};
 const claimed=await env.DB.prepare("INSERT INTO meta(key,value) VALUES ('background:lock',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value WHERE CAST(meta.value AS INTEGER)<?").bind(String(now+60000),now).run();
 if(!claimed.meta.changes)return {ran:false,reason:'busy'};
 try{
  const {syncSources}=await import('./ingest');const sync=await syncSources(env,{limit:1});
  let analyzed=0;
  // Independently opt-in, personal credential policy and existing atomic budget
  // reservations still apply. Missing keys never fall through to owner keys.
  const ownerId=await getState(env,'background:owner');
  if(policy.aiEnabled&&ownerId){const {getConfig,getProviderKey}=await import('./db');const config=await getConfig(env);if(config.enabled&&await getProviderKey(env,config.provider)){const usage=await getUsage(env);if(usage.analyzedToday<config.dailyLimit&&usage.cost+(usage.reserved||0)<config.monthlyBudget){const {analyzePending}=await import('./ai');analyzed=(await analyzePending(env,1,ownerId)).analyzed;}}}
  // A round with pending work is resumed on the next platform tick.
  if(!sync.pending)await setState(env,'background:last-run',new Date(now).toISOString());
  await setState(env,'background:last-result',JSON.stringify({processed:sync.processed,pending:sync.pending,analyzed,at:new Date(now).toISOString()}));return {ran:true,pending:sync.pending,analyzed};
 }finally{await setState(env,'background:lock','0');}
}
