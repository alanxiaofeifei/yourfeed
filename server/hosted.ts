import type {Env} from './db';
import {HttpError} from './security';

interface HostedPolicy {instanceId:string;origin:string;state:'reserved'|'active';ownerEmail:string;memberId:string;epoch:number;}
interface FetchService {fetch(input:Request):Promise<Response>;}
const text=(env:Env,key:string)=>typeof env[key]==='string'?String(env[key]).trim():'';
export const isHosted=(env:Env)=>text(env,'HOSTING_MODE')==='hosted';
/** A hosted tenant is one owner in one database, never a selector for several databases. */
function configuration(env:Env){
 const id=text(env,'INSTANCE_ID'),token=text(env,'HOSTED_INSTANCE_TOKEN'),base=text(env,'AUTH_BASE_URL');
 const service=env.HOSTED_CONTROL_SERVICE as FetchService|undefined;
 if(text(env,'AUTH_MODE')==='sites'||!/^yf-[a-z0-9-]{3,60}$/.test(id)||!/^\S{43,256}$/.test(token)||!service||typeof service.fetch!=='function')throw new HttpError(503,'受邀实例尚未完成独立配置。');
 let origin:string;try{const url=new URL(base);if(url.protocol!=='https:'||url.username||url.password||url.pathname!=='/'||url.search||url.hash)throw new Error();origin=url.origin;}catch{throw new HttpError(503,'受邀实例地址配置无效。');}
 return {id,token,service,origin};
}
async function control(env:Env,action:'policy'|'activate',email?:string):Promise<HostedPolicy>{
 const {id,token,service,origin}=configuration(env);
 // An incorrectly bound database must never be silently claimed or initialized.
 const marker=await env.DB.prepare('SELECT value FROM meta WHERE key=?').bind('hosted:instance').first<{value:string}>();
 if(marker?.value!==id)throw new HttpError(503,'受邀实例数据库身份不匹配，请联系管理员。');
 let response:Response;
 try{response=await service.fetch(new Request(`https://hosted-control.internal/internal/${action}`,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify({instanceId:id,origin,...(email?{email}:{})}),signal:AbortSignal.timeout(5000)}));}catch{throw new HttpError(503,'受邀访问验证暂时不可用。');}
 if(!response.ok)throw new HttpError(response.status===403?403:503,response.status===403?'此邀请尚未生效、已过期或访问已撤销。':'受邀访问验证暂时不可用。');
 let policy:HostedPolicy;
 try{
  const reader=response.body?.getReader();if(!reader)throw new Error();let length=0;const chunks:Uint8Array[]=[];
  try{while(true){const part=await reader.read();if(part.done)break;length+=part.value.byteLength;if(length>2048)throw new Error();chunks.push(part.value);}}finally{await reader.cancel().catch(()=>{});}
  const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}policy=JSON.parse(new TextDecoder().decode(bytes));
 }catch{throw new HttpError(503,'受邀访问验证暂时不可用。');}
 if(policy.instanceId!==id||policy.origin!==origin||!['reserved','active'].includes(policy.state)||typeof policy.ownerEmail!=='string'||!/^\S+@[^@\s]+\.[^@\s]+$/.test(policy.ownerEmail)||typeof policy.memberId!=='string'||!Number.isSafeInteger(policy.epoch))throw new HttpError(503,'受邀访问验证暂时不可用。');
 return policy;
}
/** No cache: revocation applies on the next protected request, including an existing cookie. */
export async function hostedEnvironment(env:Env):Promise<Env>{
 if(!isHosted(env))return env;
 const policy=await control(env,'policy');
 return {...env,OWNER_EMAIL:policy.ownerEmail};
}
export async function assertHostedAdmission(env:Env):Promise<void>{if(isHosted(env))await control(env,'policy');}
/** Called only after local authentication proves ownership of the assigned mailbox. */
export async function activateHostedIdentity(env:Env,email:string):Promise<void>{
 if(!isHosted(env))return;
 const policy=await control(env,'activate',email.trim().toLowerCase());
 if(policy.state!=='active'||policy.ownerEmail!==email.trim().toLowerCase())throw new HttpError(403,'此邮箱无法激活受邀实例。');
}
