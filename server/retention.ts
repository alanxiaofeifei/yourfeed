import type {Env} from './db';
import {getState,setState,databaseStorage} from './db';
import {rebuildSearchIndex} from './library';
import {HttpError} from './security';
import {isHosted} from './hosted';

const DAY=86400000;
export const RETENTION_DAYS=90;
async function retentionEnabled(env:Env):Promise<boolean>{const stored=await getState(env,'retention-policy');if(!stored)return isHosted(env);try{return JSON.parse(stored).enabled===true;}catch{return false;}}
const protectedItem="NOT EXISTS(SELECT 1 FROM feedback f WHERE f.item_id=c.id AND (json_extract(f.json,'$.liked')=1 OR json_extract(f.json,'$.saved')=1))";
// Cached-at time, not publisher date: an old article imported today gets 90 days.
const cachedAt="COALESCE(json_extract(c.json,'$.retrievedAt'),c.updated_at)";
const eligible="length(COALESCE(json_extract(c.json,'$.body'),''))>0 AND "+protectedItem;

export async function retentionStatus(env:Env,now=Date.now()) {
  const enabled=await retentionEnabled(env),expiredAt=new Date(now-RETENTION_DAYS*DAY).toISOString(),warningAt=new Date(now-(RETENTION_DAYS-7)*DAY).toISOString();
  const row=await env.DB.prepare(`SELECT SUM(CASE WHEN ${cachedAt}<=? THEN 1 ELSE 0 END) expired,SUM(CASE WHEN ${cachedAt}<=? AND ${cachedAt}>? THEN 1 ELSE 0 END) expiring,MIN(${cachedAt}) oldest FROM content c WHERE ${eligible}`).bind(expiredAt,warningAt,expiredAt).first<{expired:number|null;expiring:number|null;oldest:string|null}>();
  const bytes=await env.DB.prepare('SELECT COALESCE(SUM(length(CAST(json AS BLOB))),0) bytes FROM content').first<{bytes:number}>();
  const next=row?.oldest?Date.parse(row.oldest)+RETENTION_DAYS*DAY:NaN;
  return {enabled,days:RETENTION_DAYS,expiringCount:row?.expiring||0,expiredCount:row?.expired||0,...(Number.isFinite(next)?{nextExpiryAt:new Date(next).toISOString()}:{}),estimatedBytes:bytes?.bytes||0,estimateIncludes:'content-json-only',...await databaseStorage(env)};
}
export async function saveRetentionPolicy(env:Env,input:Record<string,unknown>) {
  if(typeof input.enabled!=='boolean')throw new HttpError(400,'请选择是否启用正文缓存清理。');
  await setState(env,'retention-policy',JSON.stringify({enabled:input.enabled,days:RETENTION_DAYS}));
  return retentionStatus(env);
}
export async function cleanupRetention(env:Env,{limit=20,now=Date.now()}:{limit?:number;now?:number}={}) {
  if(!await retentionEnabled(env))return {cleared:0,hasMore:false,disabled:true};
  limit=Math.min(25,Math.max(1,Math.floor(limit)));
  const cutoff=new Date(now-RETENTION_DAYS*DAY).toISOString();
  const rows=await env.DB.prepare(`SELECT c.rowid,c.id FROM content c WHERE ${eligible} AND ${cachedAt}<=? ORDER BY ${cachedAt},c.id LIMIT ?`).bind(cutoff,limit).all<{rowid:number;id:string}>();
  // Recheck protection in the UPDATE so a concurrent save/like wins over cleanup.
  let cleared=0;
  for(const row of rows.results){const changed=await env.DB.prepare(`UPDATE content AS c SET json=json_set(json_remove(json,'$.body'),'$.contentCoverage',CASE WHEN length(COALESCE(json_extract(json,'$.summary'),''))>0 THEN 'excerpt' ELSE 'metadata' END,'$.truncated',json('true'),'$.cacheExpiredAt',?) WHERE c.id=? AND ${protectedItem} AND ${cachedAt}<=? AND length(COALESCE(json_extract(c.json,'$.body'),''))>0 RETURNING rowid`).bind(new Date(now).toISOString(),row.id,cutoff).first();if(changed){cleared++;await env.DB.prepare('DELETE FROM content_search WHERE rowid=?').bind(row.rowid).run();}}
  await rebuildSearchIndex(env,limit);
  const hasMore=!!await env.DB.prepare(`SELECT 1 pending FROM content c WHERE ${eligible} AND ${cachedAt}<=? LIMIT 1`).bind(cutoff).first();
  return {cleared,hasMore,disabled:false};
}
