import type { Env } from './db';
import { getState, setState } from './db';
import { HttpError } from './security';
import { validateProviderBaseUrl, resolvePublicDns, isPublicAddress } from './provider-endpoint';

const STATE_KEY='deployment-v1';
const encoder=new TextEncoder();
export interface DomainCheck { checkedAt:string; dns:'public'|'unavailable'|'unsafe'; https:'reachable'|'unavailable'|'authentication-required'; instance:'matched'|'unverified'; message:string; }
export interface DeploymentState {hostingMode:'sites'|'cloudflare';authMode:string;hostname:string;currentOrigin:string;configuredOrigin:string|null;lastCheck:DomainCheck|null;}
export function normalizeDomain(input:unknown):string {
 if(typeof input!=='string'||input.length>253)throw new HttpError(400,'请输入有效的域名。 / Enter a valid hostname.');
 const value=input.trim();if(!value)return '';
 const url=new URL(validateProviderBaseUrl(value.includes('://')?value:'https://'+value));
 if(url.pathname!=='/'||url.search||url.hash)throw new HttpError(400,'只填写域名，不含路径。 / Enter a hostname without a path.');
 return url.hostname;
}
async function stored(env:Env):Promise<{hostname:string;lastCheck:DomainCheck|null}>{
 if(!env.DB)return {hostname:'',lastCheck:null};
 const raw=await getState(env,STATE_KEY);if(!raw)return {hostname:'',lastCheck:null};
 try{return {...{hostname:'',lastCheck:null},...JSON.parse(raw)};}catch{return {hostname:'',lastCheck:null};}
}
export async function getDeployment(env:Env,request:Request):Promise<DeploymentState>{
 const config=await stored(env);const authMode=String(env.AUTH_MODE||'unconfigured');
 return {hostingMode:authMode==='sites'?'sites':'cloudflare',authMode,hostname:config.hostname,currentOrigin:new URL(request.url).origin,configuredOrigin:typeof env.AUTH_BASE_URL==='string'?env.AUTH_BASE_URL:typeof env.APP_ORIGIN==='string'?env.APP_ORIGIN:null,lastCheck:config.lastCheck};
}
export async function saveDeployment(env:Env,request:Request,input:Record<string,unknown>):Promise<DeploymentState>{
 if(!env.DB)throw new HttpError(503,'Database is not configured.');
 const hostname=normalizeDomain(input.hostname);await setState(env,STATE_KEY,JSON.stringify({hostname,lastCheck:null}));return getDeployment(env,request);
}
function hex(bytes:ArrayBuffer):string{return Array.from(new Uint8Array(bytes),n=>n.toString(16).padStart(2,'0')).join('');}
async function challengeSignature(env:Env,challenge:string):Promise<string>{
 if(!/^[a-f0-9]{64}$/.test(challenge))throw new HttpError(400,'Invalid verification challenge.');
 if(typeof env.APP_ENCRYPTION_KEY!=='string'||env.APP_ENCRYPTION_KEY.length<32)throw new HttpError(503,'Instance verification is not configured.');
 const key=await crypto.subtle.importKey('raw',encoder.encode(env.APP_ENCRYPTION_KEY),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 return hex(await crypto.subtle.sign('HMAC',key,encoder.encode('yourfeed-domain-v1:'+challenge)));
}
export async function verifyDeploymentChallenge(env:Env,challenge:string):Promise<Response>{
 try{return Response.json({version:1,proof:await challengeSignature(env,challenge)},{headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});}catch(error){return Response.json({error:error instanceof HttpError?error.message:'Verification unavailable'},{status:error instanceof HttpError?error.status:503,headers:{'Cache-Control':'no-store'}});}
}
export interface DomainProbeDeps {resolve:(hostname:string)=>Promise<string[]>;fetch:typeof fetch;}
async function boundedText(response:Response):Promise<string>{
 const reader=response.body?.getReader();if(!reader)return '';let count=0,text='';const decoder=new TextDecoder();
 try{for(;;){const value=await reader.read();if(value.done)break;count+=value.value.byteLength;if(count>4096){await reader.cancel();throw new Error('Oversized verification response');}text+=decoder.decode(value.value,{stream:true});}return text+decoder.decode();}finally{reader.releaseLock();}
}
export async function checkDeployment(env:Env,request:Request,deps:DomainProbeDeps={resolve:resolvePublicDns,fetch}):Promise<DeploymentState>{
 if(!env.DB)throw new HttpError(503,'Database is not configured.');
 const config=await stored(env);const hostname=normalizeDomain(config.hostname);if(!hostname)throw new HttpError(400,'请先保存目标域名。 / Save a target hostname first.');
 const result:DomainCheck={checkedAt:new Date().toISOString(),dns:'unavailable',https:'unavailable',instance:'unverified',message:''};
 try{
  const addresses=await deps.resolve(hostname);
  if(!addresses.length){result.message='No public DNS address was found.';}
  else if(addresses.some(value=>!isPublicAddress(value))){result.dns='unsafe';result.message='The hostname resolves to a private or reserved address. No HTTPS request was sent.';}
  else{
   result.dns='public';const challenge=hex(crypto.getRandomValues(new Uint8Array(32)).buffer);
   const response=await deps.fetch(`https://${hostname}/.well-known/yourfeed-instance/${challenge}`,{method:'GET',redirect:'manual',credentials:'omit',headers:{Accept:'application/json'},signal:AbortSignal.timeout(8000)});
   if([301,302,303,307,308,401,403].includes(response.status)){result.https='authentication-required';result.message='HTTPS responded, but sign-in or a redirect prevents instance verification. No redirect was followed.';await response.body?.cancel();}
   else{
    result.https='reachable';const body=await boundedText(response);let value:any;try{value=JSON.parse(body);}catch{value=null;}
    if(response.ok&&value?.version===1&&value.proof===await challengeSignature(env,challenge)){result.instance='matched';result.message='DNS and HTTPS reached this YourFeed instance. This check did not change its canonical origin.';}
    else result.message='HTTPS responded, but this YourFeed instance could not be verified.';
   }
  }
 }catch{result.message='Verification could not complete. Check DNS propagation, TLS and access settings.';}
 await setState(env,STATE_KEY,JSON.stringify({hostname,lastCheck:result}));return getDeployment(env,request);
}
