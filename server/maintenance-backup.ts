import type {Env} from './db';
import {HttpError} from './security';

const TABLES=new Set(['analysis_cache','auth_account','auth_rate','auth_session','auth_user','auth_verification','content','feedback','meta','reservations','settings','sources','content_sources','content_aliases']);
const encoder=new TextEncoder();
const MAX_BYTES=1024*1024;
/** Short maintenance window; expiry also releases the lock after interruption. */
export function backupWriteLocked(env:Env):boolean {
 if(env.AUTH_MODE!=='sites'||env.HOSTING_MODE==='hosted'||env.PRIVATE_BACKUP_LOCK!=='true')return false;
 const grant=typeof env.PRIVATE_BACKUP_GRANT==='string'?env.PRIVATE_BACKUP_GRANT:'';
 const expiry=Number(/^(\d{13}):[A-Za-z0-9_-]{43,86}$/.exec(grant)?.[1]);
 return expiry>Date.now()&&expiry-Date.now()<=2*3600000;
}
function reply(value:unknown,status=200){return new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','Pragma':'no-cache','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'}});}
async function authenticated(request:Request,env:Env){
 if(env.AUTH_MODE!=='sites'||env.HOSTING_MODE==='hosted')throw new HttpError(404,'Backup service is unavailable.');
 const grant=typeof env.PRIVATE_BACKUP_GRANT==='string'?env.PRIVATE_BACKUP_GRANT:'';
 const match=/^(\d{13}):([A-Za-z0-9_-]{43,86})$/.exec(grant),now=Date.now();
 if(!match||Number(match[1])<=now||Number(match[1])-now>2*3600000)throw new HttpError(401,'Backup authorization is unavailable or expired.');
 const supplied=/^Bearer (.+)$/.exec(request.headers.get('authorization')||'')?.[1]||'';
 if(supplied.length>128||!/^\d{13}:[A-Za-z0-9_-]{43,86}$/.test(supplied))throw new HttpError(401,'Backup authorization failed.');
 const algorithm={name:'HMAC',hash:'SHA-256'},probe=encoder.encode('yourfeed:private-read-only-backup:v1');
 const [expected,candidate]=await Promise.all([crypto.subtle.importKey('raw',encoder.encode(grant),algorithm,false,['verify']),crypto.subtle.importKey('raw',encoder.encode(supplied),algorithm,false,['sign'])]);
 const signature=await crypto.subtle.sign('HMAC',candidate,probe);
 if(!await crypto.subtle.verify('HMAC',expected,signature,probe))throw new HttpError(401,'Backup authorization failed.');
}
async function readBounded(request:Request):Promise<Record<string,unknown>>{
 const limit=32768;if(Number(request.headers.get('content-length')||0)>limit)throw new HttpError(413,'Backup request is too large.');
 const reader=request.body?.getReader();if(!reader)throw new HttpError(400,'Backup request is missing.');let bytes=0,text='';const decoder=new TextDecoder();
 try{while(true){const chunk=await reader.read();if(chunk.done)break;bytes+=chunk.value.byteLength;if(bytes>limit){await reader.cancel();throw new HttpError(413,'Backup request is too large.');}text+=decoder.decode(chunk.value,{stream:true});}text+=decoder.decode();}finally{reader.releaseLock();}
 try{const value=JSON.parse(text);if(!value||typeof value!=='object'||Array.isArray(value))throw Error();return value;}catch{throw new HttpError(400,'Backup request is invalid.');}
}
const b64=(bytes:ArrayBuffer|Uint8Array)=>btoa(String.fromCharCode(...(bytes instanceof Uint8Array?bytes:new Uint8Array(bytes))));
async function keyEnvelope(request:Request,env:Env){
 const origin=request.headers.get('origin');if(origin&&origin!==new URL(request.url).origin)throw new HttpError(403,'Backup request origin mismatch.');
 if(!request.headers.get('content-type')?.includes('application/json'))throw new HttpError(415,'Use JSON for key escrow.');
 const body=await readBounded(request),jwk=body.publicKey as JsonWebKey|undefined;
 if(!jwk||jwk.kty!=='RSA'||typeof jwk.n!=='string'||typeof jwk.e!=='string'||jwk.d||jwk.p||jwk.q||jwk.dp||jwk.dq||jwk.qi||jwk.oth||jwk.e!=='AQAB'||!jwk.n.match(/^[A-Za-z0-9_-]{342,1366}$/)||jwk.alg&&jwk.alg!=='RSA-OAEP-256')throw new HttpError(400,'Provide an RSA-OAEP public key of at least 2048 bits.');
 let recipient:CryptoKey;try{recipient=await crypto.subtle.importKey('jwk',{kty:'RSA',n:jwk.n,e:jwk.e,alg:'RSA-OAEP-256',ext:true,key_ops:['encrypt']},{name:'RSA-OAEP',hash:'SHA-256'},false,['encrypt']);if((recipient.algorithm as RsaHashedKeyAlgorithm).modulusLength<2048)throw Error();}catch{throw new HttpError(400,'Backup public key is invalid.');}
 if(typeof env.APP_ENCRYPTION_KEY!=='string'||!env.APP_ENCRYPTION_KEY)throw new HttpError(503,'The current encryption key is unavailable.');
 const payload:Record<string,string>={APP_ENCRYPTION_KEY:env.APP_ENCRYPTION_KEY,SECRET_NAMESPACE:typeof env.SECRET_NAMESPACE==='string'?env.SECRET_NAMESPACE:'yourfeed'};
 if(typeof env.AUTH_SECRET==='string'&&env.AUTH_SECRET)payload.AUTH_SECRET=env.AUTH_SECRET;
 const aes=await crypto.subtle.generateKey({name:'AES-GCM',length:256},true,['encrypt']),iv=crypto.getRandomValues(new Uint8Array(12));
 const context='yourfeed-private-key-envelope-v1';
 const ciphertext=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:encoder.encode(context)},aes,encoder.encode(JSON.stringify(payload)));
 const wrappedKey=await crypto.subtle.encrypt({name:'RSA-OAEP'},recipient,await crypto.subtle.exportKey('raw',aes));
 return reply({format:context,version:1,algorithm:'RSA-OAEP-256+A256GCM',iv:b64(iv),wrappedKey:b64(wrappedKey),ciphertext:b64(ciphertext)});
}
/** Explicit short-lived machine capability, in addition to the platform's private
 * Site gate. Never accepts an impersonated owner header or executes writes. */
export async function handleMaintenanceBackup(request:Request,env:Env):Promise<Response>{
 try{
  await authenticated(request,env);
  const url=new URL(request.url);
  if(url.pathname==='/api/maintenance-backup/key-envelope'&&request.method==='POST')return await keyEnvelope(request,env);
  if(url.pathname!=='/api/maintenance-backup'||request.method!=='GET')throw new HttpError(405,'This backup service is read-only.');
  const table=url.searchParams.get('table')||'';
  if(!TABLES.has(table))throw new HttpError(400,'Unsupported backup table.');
  const rawOffset=url.searchParams.get('offset')||'0',rawLimit=url.searchParams.get('limit')||'5';
  if(!/^\d{1,7}$/.test(rawOffset)||!/^\d{1,2}$/.test(rawLimit))throw new HttpError(400,'Invalid backup pagination.');
  const offset=Number(rawOffset),limit=Number(rawLimit);if(offset>1000000||limit<1||limit>10)throw new HttpError(400,'Invalid backup pagination.');
  const info=await env.DB.prepare(`PRAGMA table_info("${table}")`).all<{name:string;pk:number}>();
  if(!info.results.length||info.results.some(column=>!/^[A-Za-z_][A-Za-z0-9_]*$/.test(column.name)))throw new HttpError(503,'Backup table schema is unavailable.');
  const columns=info.results.map(column=>column.name),keys=info.results.filter(column=>column.pk>0).sort((a,b)=>a.pk-b.pk).map(column=>'"'+column.name+'"');
  const order=keys.length?keys.join(','):'rowid';
  const result=await env.DB.prepare(`SELECT * FROM "${table}" ORDER BY ${order} LIMIT ? OFFSET ?`).bind(limit+1,offset).all<Record<string,unknown>>();
  let rows=result.results.slice(0,limit);let hasMore=result.results.length>limit;
  while(rows.length&&encoder.encode(JSON.stringify(rows)).byteLength>MAX_BYTES){rows=rows.slice(0,-1);hasMore=true;}
  if(!rows.length&&result.results.length)throw new HttpError(413,'A backup row exceeds the response limit; no cells were truncated.');
  return reply({project_id:'',binding_name:'DB',table_name:table,columns,rows,offset,limit,has_more:hasMore,model_projection:{truncated:false,truncated_values:0,omitted_columns:0,omitted_rows:0,next_offset:hasMore?offset+rows.length:null}});
 }catch(error){return reply({error:error instanceof HttpError?error.message:'Backup request could not be completed.'},error instanceof HttpError?error.status:500);}
}
