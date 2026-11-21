import type {Env} from './db';
export async function tenantEnvironment(base:Env,DB:Env['DB'],user:{id:string;email?:string}):Promise<Env>{
 if(!user.email||typeof base.APP_ENCRYPTION_KEY!=='string'||base.APP_ENCRYPTION_KEY.length<32)throw new Error('Tenant encryption unavailable');
 const material=await crypto.subtle.importKey('raw',new TextEncoder().encode(base.APP_ENCRYPTION_KEY),'HKDF',false,['deriveBits']);
 const bits=await crypto.subtle.deriveBits({name:'HKDF',hash:'SHA-256',salt:new TextEncoder().encode('yourfeed-multi-v1'),info:new TextEncoder().encode(user.id)},material,256);
 const key=[...new Uint8Array(bits)].map(n=>n.toString(16).padStart(2,'0')).join('');
 // Explicit allowlist: no management tokens, login secrets, operator AI/YouTube
 // credentials, auth DB or DO binding can reach business code or exports.
 return {DB,APP_ENCRYPTION_KEY:key,AUTH_MODE:'standalone',HOSTING_MODE:'multi',OWNER_EMAIL:user.email,AUTH_BASE_URL:base.AUTH_BASE_URL,SECRET_NAMESPACE:'yourfeed:tenant:'+user.id,BACKGROUND_SCHEDULE_CONFIGURED:base.BACKGROUND_SCHEDULE_CONFIGURED};
}
