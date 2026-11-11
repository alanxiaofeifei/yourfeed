import type {D1Database} from '@cloudflare/workers-types';
import {operatorPage} from './operator-page';

export interface ControlEnv {CONTROL_DB:D1Database;CONTROL_ADMIN_SECRET:string;MAX_TENANTS?:string;SELF_HOST_URL?:string;}
interface Slot {id:string;origin:string;database_id:string;token_hash:string;state:string;owner_email:string|null;member_id:string|null;request_id:string|null;expires_at:number|null;epoch:number;created_at:number;updated_at:number;}
class Failure extends Error {constructor(public status:number,message:string){super(message);}}
const encoder=new TextEncoder();
const hex=(bytes:ArrayBuffer)=>[...new Uint8Array(bytes)].map(n=>n.toString(16).padStart(2,'0')).join('');
export const hashToken=async(value:string)=>hex(await crypto.subtle.digest('SHA-256',encoder.encode(value)));
export async function signAdmin(secret:string,canonical:string){const key=await crypto.subtle.importKey('raw',encoder.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);return hex(await crypto.subtle.sign('HMAC',key,encoder.encode(canonical)));}
function same(a:string,b:string){if(a.length!==b.length)return false;let difference=0;for(let i=0;i<a.length;i++)difference|=a.charCodeAt(i)^b.charCodeAt(i);return difference===0;}
const json=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'}});
function limit(env:ControlEnv){const n=Number(env.MAX_TENANTS??'5');if(!Number.isSafeInteger(n)||n<1||n>100)throw new Failure(503,'Invalid hosting capacity');return n;}
function cleanEmail(value:unknown){if(typeof value!=='string'||value.length>254||!/^\S+@[^@\s]+\.[^@\s]+$/.test(value))throw new Failure(400,'A valid invited email is required');return value.trim().toLowerCase();}
function instanceId(value:unknown){if(typeof value!=='string'||!/^yf-[a-z0-9-]{3,60}$/.test(value))throw new Failure(400,'Invalid instance ID');return value;}
function origin(value:unknown){try{if(typeof value!=='string')throw new Error();const u=new URL(value);if(u.protocol!=='https:'||u.username||u.password||u.pathname!=='/'||u.search||u.hash)throw new Error();return u.origin;}catch{throw new Failure(400,'An exact HTTPS instance origin is required');}}
function policy(slot:Slot){return {instanceId:slot.id,origin:slot.origin,state:slot.state,ownerEmail:slot.owner_email,memberId:slot.member_id,epoch:slot.epoch};}
async function body(request:Request){
 if(!request.headers.get('content-type')?.includes('application/json'))throw new Failure(415,'JSON is required');
 if(Number(request.headers.get('content-length')||0)>8192)throw new Failure(413,'Request too large');
 const reader=request.body?.getReader();if(!reader)throw new Failure(400,'Invalid JSON');
 let length=0;const chunks:Uint8Array[]=[];
 try{while(true){const part=await reader.read();if(part.done)break;length+=part.value.byteLength;if(length>8192)throw new Failure(413,'Request too large');chunks.push(part.value);}}finally{await reader.cancel().catch(()=>{});}
 const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}const raw=new TextDecoder().decode(bytes);
 let data:Record<string,unknown>;try{data=JSON.parse(raw);if(!data||typeof data!=='object'||Array.isArray(data))throw new Error();}catch{throw new Failure(400,'Invalid JSON');}return {raw,data};
}
async function authorizeAdmin(request:Request,env:ControlEnv,raw:string,now:number){
 if(!env.CONTROL_ADMIN_SECRET||env.CONTROL_ADMIN_SECRET.length<43)throw new Failure(503,'Operator authentication is not configured');
 const timestamp=request.headers.get('x-hosting-timestamp')||'',nonce=request.headers.get('x-hosting-nonce')||'',signature=request.headers.get('x-hosting-signature')||'';
 if(!/^\d{13}$/.test(timestamp)||Math.abs(now-Number(timestamp))>60_000||!/^[a-f0-9]{32,64}$/.test(nonce)||!/^[a-f0-9]{64}$/.test(signature))throw new Failure(401,'Operator authorization failed');
 const expected=await signAdmin(env.CONTROL_ADMIN_SECRET,`${request.method}\n${new URL(request.url).pathname}\n${timestamp}\n${nonce}\n${await hashToken(raw)}`);
 if(!same(expected,signature))throw new Failure(401,'Operator authorization failed');
 const consumed=await env.CONTROL_DB.prepare('INSERT INTO hosting_admin_nonce(nonce,expires_at) VALUES (?,?) ON CONFLICT(nonce) DO NOTHING RETURNING nonce').bind(nonce,now+120_000).first();
 if(!consumed)throw new Failure(409,'Operator request already consumed');
 // Bound replay records without logging payloads, emails, capabilities or provider secrets.
 await env.CONTROL_DB.prepare('DELETE FROM hosting_admin_nonce WHERE expires_at<?').bind(now).run();
}
async function audit(env:ControlEnv,operation:string,id:string|null,now:number){await env.CONTROL_DB.prepare('INSERT INTO hosting_audit(id,operation,instance_id,created_at) VALUES (?,?,?,?)').bind(crypto.randomUUID(),operation,id,now).run();}
async function tenant(request:Request,env:ControlEnv,path:string,data:Record<string,unknown>,now:number){
 const id=instanceId(data.instanceId),base=origin(data.origin),token=(request.headers.get('authorization')||'').replace(/^Bearer /,'');
 if(!/^\S{43,256}$/.test(token))throw new Failure(403,'Invitation unavailable');
 let slot=await env.CONTROL_DB.prepare('SELECT * FROM hosting_slots WHERE id=? AND origin=? AND token_hash=?').bind(id,base,await hashToken(token)).first<Slot>();
 if(!slot||!['reserved','active'].includes(slot.state)||!slot.owner_email||!slot.member_id||(slot.state==='reserved'&&(!slot.expires_at||slot.expires_at<=now)))throw new Failure(403,'Invitation unavailable');
 if(path==='/internal/activate'){
  const email=cleanEmail(data.email);if(slot.owner_email!==email)throw new Failure(403,'Invitation unavailable');
  // The tenant calls this only after its own Google or OTP verification. Repeats return the same member.
  const updated=await env.CONTROL_DB.prepare("UPDATE hosting_slots SET state='active',expires_at=NULL,updated_at=? WHERE id=? AND owner_email=? AND state IN ('reserved','active') AND (state='active' OR expires_at>?) RETURNING *").bind(now,id,email,now).first<Slot>();
  if(!updated)throw new Failure(403,'Invitation unavailable');slot=updated;
 }
 return json(policy(slot));
}
async function admin(env:ControlEnv,data:Record<string,unknown>,now:number){
 const max=limit(env);
 if(data.operation==='list'){
  const result=await env.CONTROL_DB.prepare('SELECT id,origin,database_id,state,owner_email,member_id,expires_at,epoch,updated_at FROM hosting_slots ORDER BY created_at,id').all();
  return json({maxTenants:max,slots:result.results});
 }
 if(data.operation==='register'){
  const id=instanceId(data.instanceId),base=origin(data.origin),databaseId=data.databaseId,token=data.instanceToken;
  if(typeof databaseId!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(databaseId)||typeof token!=='string'||!/^[a-f0-9]{64}$/.test(token))throw new Failure(400,'A new database ID and 32-byte instance capability are required');
  const tokenHash=await hashToken(token),existing=await env.CONTROL_DB.prepare('SELECT * FROM hosting_slots WHERE id=?').bind(id).first<Slot>();
  if(existing){if(existing.origin!==base||existing.database_id!==databaseId||existing.token_hash!==tokenHash)throw new Failure(409,'Instance identities are immutable; rebuild a new empty instance instead');return json({instanceId:id,state:existing.state});}
  const added=await env.CONTROL_DB.prepare("INSERT INTO hosting_slots(id,origin,database_id,token_hash,created_at,updated_at) SELECT ?,?,?,?,?,? WHERE (SELECT COUNT(*) FROM hosting_slots WHERE state IN ('free','reserved','active'))<? ON CONFLICT DO NOTHING RETURNING id").bind(id,base,databaseId,tokenHash,now,now,max).first();
  if(!added)throw new Failure(409,'No capacity for another preprovisioned instance');await audit(env,'register',id,now);return json({instanceId:id,state:'free'},201);
 }
 if(data.operation==='invite'){
  const email=cleanEmail(data.email),requestId=data.requestId;
  if(typeof requestId!=='string'||!/^[a-zA-Z0-9_-]{16,128}$/.test(requestId))throw new Failure(400,'A stable request ID is required');
  const existing=await env.CONTROL_DB.prepare('SELECT * FROM hosting_slots WHERE owner_email=? OR request_id=?').bind(email,requestId).first<Slot>();
  if(existing){if(existing.owner_email!==email||!['reserved','active'].includes(existing.state))throw new Failure(409,'Invitation is unavailable; never reuse an occupied instance');return json({instanceId:existing.id,url:existing.origin,state:existing.state,expiresAt:existing.expires_at});}
  const days=Number(data.expiresDays??7);if(!Number.isInteger(days)||days<1||days>30)throw new Failure(400,'Invitation lifetime must be 1–30 days');
  // One atomic statement claims one slot. No read/count/write race or callback allocation.
  const row=await env.CONTROL_DB.prepare("UPDATE hosting_slots SET state='reserved',owner_email=?,member_id=?,request_id=?,expires_at=?,updated_at=?,epoch=epoch+1 WHERE id=(SELECT id FROM hosting_slots WHERE state='free' ORDER BY created_at,id LIMIT 1) AND state='free' AND NOT EXISTS(SELECT 1 FROM hosting_slots WHERE owner_email=? OR request_id=?) AND (SELECT COUNT(*) FROM hosting_slots WHERE state IN ('reserved','active'))<? RETURNING *").bind(email,crypto.randomUUID(),requestId,now+days*86400_000,now,email,requestId,max).first<Slot>();
  if(!row){const repeated=await env.CONTROL_DB.prepare("SELECT * FROM hosting_slots WHERE owner_email=? AND state IN ('reserved','active')").bind(email).first<Slot>();if(repeated)return json({instanceId:repeated.id,url:repeated.origin,state:repeated.state,expiresAt:repeated.expires_at});throw new Failure(409,'Hosting is full; existing members can still sign in. Self-hosting remains available.');}
  await audit(env,'invite',row.id,now);return json({instanceId:row.id,url:row.origin,state:row.state,expiresAt:row.expires_at},201);
 }
 if(data.operation==='revoke'||data.operation==='expire'){
  const id=instanceId(data.instanceId),state=data.operation==='revoke'?'revoked':'expired';
  const row=await env.CONTROL_DB.prepare(data.operation==='revoke'?"UPDATE hosting_slots SET state='revoked',epoch=epoch+1,updated_at=? WHERE id=? AND state IN ('reserved','active') RETURNING id":"UPDATE hosting_slots SET state='expired',epoch=epoch+1,updated_at=? WHERE id=? AND state='reserved' AND expires_at<=? RETURNING id").bind(...(data.operation==='revoke'?[now,id]:[now,id,now])).first();
  if(!row)throw new Failure(409,'No matching invitation state');await audit(env,state,id,now);return json({instanceId:id,state,reusable:false});
 }
 if(data.operation==='renew'){
  const id=instanceId(data.instanceId),email=cleanEmail(data.email),days=Number(data.expiresDays??7);
  if(!Number.isInteger(days)||days<1||days>30)throw new Failure(400,'Invitation lifetime must be 1–30 days');
  // Resume only the original mailbox/member in its original instance. Never swap its owner,
  // reset data, renew an active/revoked member, or bypass capacity with an expired reservation.
  const row=await env.CONTROL_DB.prepare("UPDATE hosting_slots SET state='reserved',expires_at=?,updated_at=?,epoch=epoch+1 WHERE id=? AND owner_email=? AND state IN ('reserved','expired') AND (state='reserved' OR (SELECT COUNT(*) FROM hosting_slots WHERE state IN ('reserved','active'))<?) RETURNING *").bind(now+days*86400_000,now,id,email,max).first<Slot>();
  if(!row)throw new Failure(409,'Only the original expired reservation can be renewed within capacity');
  await audit(env,'renew',id,now);return json({instanceId:row.id,url:row.origin,state:row.state,expiresAt:row.expires_at});
 }
 throw new Failure(400,'Unknown operator operation');
}
export default {
 async fetch(request:Request,env:ControlEnv):Promise<Response>{
  const path=new URL(request.url).pathname;
  try{
   if(path==='/health'&&request.method==='GET'){
    const capacity=limit(env),tables=env.CONTROL_DB?await env.CONTROL_DB.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('hosting_slots','hosting_admin_nonce','hosting_audit')").all<{name:string}>():{results:[]};
    const ready=tables.results.length===3&&typeof env.CONTROL_ADMIN_SECRET==='string'&&env.CONTROL_ADMIN_SECRET.length>=43;
    return json({service:'yourfeed-hosting',ready,capacity},ready?200:503);
   }
   if(path==='/operator'&&request.method==='GET')return operatorPage();
   if(!['/admin','/internal/policy','/internal/activate'].includes(path))return json({error:'Not found'},404);
   if(request.method!=='POST')return json({error:'POST required'},405);
   const {raw,data}=await body(request),now=Date.now();
   if(path==='/admin'){await authorizeAdmin(request,env,raw,now);return await admin(env,data,now);}
   return await tenant(request,env,path,data,now);
  }catch(error){return json({error:error instanceof Failure?error.message:'Hosting operation unavailable'},error instanceof Failure?error.status:503);}
 }
};
