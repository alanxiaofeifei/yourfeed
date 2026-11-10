import type { Env } from './db';
import { encryptSecret, decryptSecret, HttpError, checkWriteRequest, readJson } from './security';
import { requireRecentAuth } from './auth';
import { shareableSourceUrl } from '../shared/content-export';

const SCOPE='https://www.googleapis.com/auth/notebook';
const NOTEBOOK_API='https://notebook.googleapis.com/v1';
const TOKEN_URL='https://oauth2.googleapis.com/token';
const HOME='https://notebook.google.com/';
const CONFIG_KEY='integration:notebook:config';
const UUID='[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}';
const NOTEBOOK_NAME=new RegExp('^notebooks/'+UUID+'$','i');
const SOURCE_NAME=new RegExp('^notebooks/'+UUID+'/sources/'+UUID+'$','i');
class NotebookRejected extends HttpError {}
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
type Config={projectId:string;defaultNotebook?:string};
type Credentials={accessToken:string;refreshToken?:string;expiresAt:number;clientId:string};
type State={userId:string;verifier:string;redirectUri:string;createdAt:number;clientId:string};
const purpose=(env:Env,suffix:string)=>(typeof env.SECRET_NAMESPACE==='string'?env.SECRET_NAMESPACE:'yourfeed')+':notebook:'+suffix;
async function hash(value:string){const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value));return [...new Uint8Array(bytes)].map(byte=>byte.toString(16).padStart(2,'0')).join('');}
const b64url=(bytes:Uint8Array)=>btoa(String.fromCharCode(...bytes)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
function client(env:Env){
 const independent=env.NOTEBOOK_GOOGLE_CLIENT_ID!==undefined||env.NOTEBOOK_GOOGLE_CLIENT_SECRET!==undefined;
 const clientId=String((independent?env.NOTEBOOK_GOOGLE_CLIENT_ID:env.GOOGLE_CLIENT_ID)||'');
 const secret=String((independent?env.NOTEBOOK_GOOGLE_CLIENT_SECRET:env.GOOGLE_CLIENT_SECRET)||'');
 return /^[a-z0-9._-]{10,240}\.apps\.googleusercontent\.com$/i.test(clientId)&&secret.length>=8&&secret.length<=1024&&!/[\r\n]/.test(secret)?{clientId,secret}:null;
}
async function loadConfig(env:Env):Promise<Config>{const row=await env.DB.prepare('SELECT json FROM settings WHERE id=?').bind(CONFIG_KEY).first<{json:string}>();if(!row)return {projectId:''};try{const value=JSON.parse(row.json);return {projectId:typeof value.projectId==='string'?value.projectId:'',...(typeof value.defaultNotebook==='string'&&NOTEBOOK_NAME.test(value.defaultNotebook)?{defaultNotebook:value.defaultNotebook}:{})};}catch{return {projectId:''};}}
async function storeConfig(env:Env,value:Config){await env.DB.prepare('INSERT INTO settings(id,json) VALUES (?,?) ON CONFLICT(id) DO UPDATE SET json=excluded.json').bind(CONFIG_KEY,JSON.stringify(value)).run();}
async function tokenKey(userId:string){return 'integration:notebook:tokens:'+await hash(userId);}
async function loadCredentials(env:Env,userId:string):Promise<Credentials|null>{
 const row=await env.DB.prepare('SELECT json FROM settings WHERE id=?').bind(await tokenKey(userId)).first<{json:string}>();if(!row)return null;
 try{const value=JSON.parse(await decryptSecret(row.json,env.APP_ENCRYPTION_KEY,purpose(env,userId)));if(value.clientId!==client(env)?.clientId||typeof value.accessToken!=='string'||typeof value.expiresAt!=='number')return null;return value;}catch{return null;}
}
async function storeCredentials(env:Env,userId:string,value:Credentials){const cipher=await encryptSecret(JSON.stringify(value),env.APP_ENCRYPTION_KEY,purpose(env,userId));await env.DB.prepare('INSERT INTO settings(id,json) VALUES (?,?) ON CONFLICT(id) DO UPDATE SET json=excluded.json').bind(await tokenKey(userId),cipher).run();}
async function boundedJson(response:Response,max=65536):Promise<Record<string,unknown>>{
 if(!response.ok){await response.body?.cancel();const ErrorType=response.status>=400&&response.status<500&&response.status!==408?NotebookRejected:HttpError;throw new ErrorType(response.status===401?401:response.status===429?429:502,response.status===401?'Google 授权已过期，请重新连接 Notebook。':response.status===429?'Google Notebook 请求过于频繁，请稍后重试。':'Google Notebook 请求未完成，请检查授权、API 启用状态与个人账号资格。');}
 if(Number(response.headers.get('content-length')||0)>max){await response.body?.cancel();throw new HttpError(502,'Google Notebook 返回的内容过大。');}
 const reader=response.body?.getReader();if(!reader)throw new HttpError(502,'Google Notebook 返回了无效结果。');const decoder=new TextDecoder();let result='',size=0;
 try{while(true){const chunk=await reader.read();if(chunk.done)break;size+=chunk.value.byteLength;if(size>max){await reader.cancel();throw new HttpError(502,'Google Notebook 返回的内容过大。');}result+=decoder.decode(chunk.value,{stream:true});}result+=decoder.decode();}finally{reader.releaseLock();}
 try{const value=JSON.parse(result);if(value&&typeof value==='object'&&!Array.isArray(value))return value;}catch{}throw new HttpError(502,'Google Notebook 返回了无效结果。');
}
async function exchange(env:Env,fields:Record<string,string>):Promise<Record<string,unknown>>{
 const app=client(env);if(!app)throw new HttpError(503,'请先在部署环境配置 Google Notebook OAuth 客户端。');
 return boundedJson(await fetch(TOKEN_URL,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({...fields,client_id:app.clientId,client_secret:app.secret}),redirect:'manual',signal:AbortSignal.timeout(15000)}),16384);
}
function tokenResult(value:Record<string,unknown>,clientId:string,previous?:Credentials):Credentials{
 if(typeof value.access_token!=='string'||value.access_token.length<8||value.access_token.length>8192||/[\s\x00-\x1f]/.test(value.access_token)||!Number.isFinite(Number(value.expires_in))||Number(value.expires_in)<=0||Number(value.expires_in)>86400||value.token_type!=='Bearer')throw new HttpError(502,'Google Notebook 返回了无效授权。');
 if((typeof value.scope==='string'&&!value.scope.split(' ').includes(SCOPE))||(!previous&&typeof value.scope!=='string'))throw new HttpError(403,'尚未授予 Notebook 读写权限，请重新连接。');
 const refreshToken=typeof value.refresh_token==='string'&&value.refresh_token.length>=8&&value.refresh_token.length<=8192?value.refresh_token:previous?.refreshToken;
 return {accessToken:value.access_token,refreshToken,expiresAt:Date.now()+Number(value.expires_in)*1000,clientId};
}
async function accessToken(env:Env,userId:string):Promise<string>{
 const credentials=await loadCredentials(env,userId);if(!credentials)throw new HttpError(409,'请先连接 Google Notebook，Google 登录本身不包含 Notebook 写入授权。');
 if(credentials.expiresAt>Date.now()+60000)return credentials.accessToken;
 if(!credentials.refreshToken)throw new HttpError(401,'Google 授权已过期，请重新连接 Notebook。');
 const next=tokenResult(await exchange(env,{grant_type:'refresh_token',refresh_token:credentials.refreshToken}),credentials.clientId,credentials);await storeCredentials(env,userId,next);return next.accessToken;
}
async function googleRequest(env:Env,userId:string,path:string,body?:unknown){
 const config=await loadConfig(env),token=await accessToken(env,userId);
 return boundedJson(await fetch(NOTEBOOK_API+path,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+token,...(config.projectId?{'x-goog-user-project':config.projectId}:{}),...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined,redirect:'manual',signal:AbortSignal.timeout(20000)}));
}
function redirect(origin:string,status:'connected'|'failed'){return new Response(null,{status:303,headers:{Location:origin+'/?notebook='+status,'Cache-Control':'no-store','Referrer-Policy':'no-referrer'}});}
async function connect(request:Request,env:Env,userId:string){
 await requireRecentAuth(request,env);const app=client(env);if(!app)throw new HttpError(503,'请先在部署环境配置 Google Notebook OAuth 客户端。');if(!env.APP_ENCRYPTION_KEY)throw new HttpError(503,'服务器密钥保护尚未配置。');
 const state=b64url(crypto.getRandomValues(new Uint8Array(32))),verifier=b64url(crypto.getRandomValues(new Uint8Array(32))),redirectUri=new URL('/api/notebook/callback',request.url).toString();
 // Expired one-time states are purged without touching any active consent flow.
 await env.DB.prepare("DELETE FROM meta WHERE key LIKE 'notebook:state:%' AND CAST(substr(value,1,13) AS INTEGER) < ?").bind(Date.now()-600000).run();
 const cipher=await encryptSecret(JSON.stringify({userId,verifier,redirectUri,createdAt:Date.now(),clientId:app.clientId} satisfies State),env.APP_ENCRYPTION_KEY,purpose(env,'state'));
 await env.DB.prepare('INSERT INTO meta(key,value) VALUES (?,?)').bind('notebook:state:'+await hash(state),Date.now().toString().padStart(13,'0')+cipher).run();
 const authorization=new URL('https://accounts.google.com/o/oauth2/v2/auth');authorization.search=new URLSearchParams({client_id:app.clientId,redirect_uri:redirectUri,response_type:'code',scope:SCOPE,access_type:'offline',prompt:'consent',state,code_challenge:b64url(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(verifier)))),code_challenge_method:'S256'}).toString();return json({url:authorization.toString()});
}
async function callback(request:Request,env:Env,userId:string){
 const url=new URL(request.url),state=url.searchParams.get('state'),code=url.searchParams.get('code');
 try{
  if(!state||!/[A-Za-z0-9_-]{43}/.test(state)||state.length!==43)throw new Error();
  // Consume exactly once, atomically. A callback under a different owner cannot consume a valid owner's state.
  const key='notebook:state:'+await hash(state),stored=await env.DB.prepare('SELECT value FROM meta WHERE key=?').bind(key).first<{value:string}>();if(!stored)throw new Error();
  const data:State=JSON.parse(await decryptSecret(stored.value.slice(13),env.APP_ENCRYPTION_KEY,purpose(env,'state')));
  if(data.userId!==userId||data.createdAt<Date.now()-600000||data.createdAt>Date.now()+30000||data.clientId!==client(env)?.clientId||data.redirectUri!==url.origin+'/api/notebook/callback')throw new Error();
  const consumed=await env.DB.prepare('DELETE FROM meta WHERE key=? AND value=? RETURNING key').bind(key,stored.value).first();if(!consumed||url.searchParams.has('error')||!code||code.length>4096)throw new Error();
  const app=client(env)!;const next=tokenResult(await exchange(env,{grant_type:'authorization_code',code,redirect_uri:data.redirectUri,code_verifier:data.verifier}),app.clientId);await storeCredentials(env,userId,next);return redirect(url.origin,'connected');
 }catch{return redirect(url.origin,'failed');}
}
async function share(env:Env,userId:string,body:Record<string,unknown>,origin:string){
 if(typeof body.itemId!=='string'||body.itemId.length>200||typeof body.notebook!=='string'||!NOTEBOOK_NAME.test(body.notebook))throw new HttpError(400,'请选择内容与有效的 Notebook。');
 const row=await env.DB.prepare('SELECT json FROM content WHERE id=?').bind(body.itemId).first<{json:string}>();if(!row)throw new HttpError(404,'这条内容不存在。');
 let item:Record<string,unknown>;try{item=JSON.parse(row.json);}catch{throw new HttpError(404,'这条内容不存在。');}
 const url=typeof item.url==='string'?shareableSourceUrl(item.url,origin):null;if(!url)throw new HttpError(400,'此内容没有可分享的公开源链接。');
 const title=typeof item.title==='string'?item.title.slice(0,500):'Shared source';
 // Idempotence is scoped to the owner, notebook and exact source URL. Never auto-replay an uncertain external write.
 const key='notebook:share:'+await hash([userId,body.notebook,url].join('\n'));
 const previous=await env.DB.prepare('SELECT value FROM meta WHERE key=?').bind(key).first<{value:string}>();if(previous){try{const value=JSON.parse(previous.value);if(value.source&&SOURCE_NAME.test(value.source))return json({ok:value.state!=='FAILED',state:value.state,duplicate:true,notebookUrl:HOME});}catch{}throw new HttpError(409,'这条内容正在发送或上次结果待确认，请先到 Notebook 检查，避免重复添加。');}
 // Ensure credentials and selected notebook access before reserving the write.
 await googleRequest(env,userId,'/'+body.notebook);
 const lock=await env.DB.prepare('INSERT OR IGNORE INTO meta(key,value) VALUES (?,?)').bind(key,JSON.stringify({pending:true,createdAt:new Date().toISOString()})).run();if(lock.meta.changes!==1)throw new HttpError(409,'这条内容正在发送，请稍候。');
 let result:Record<string,unknown>;
 try{result=await googleRequest(env,userId,'/'+body.notebook+'/sources',{display_name:title,web_content:{url}});}catch(error){
  // Explicit HTTP failures never accepted a source; transport failures remain pending because the write may have succeeded.
  if(error instanceof NotebookRejected)await env.DB.prepare('DELETE FROM meta WHERE key=?').bind(key).run();
  throw error;
 }
 if(typeof result.name!=='string'||!SOURCE_NAME.test(result.name)||!result.name.startsWith(body.notebook+'/sources/'))throw new HttpError(502,'Google Notebook 返回了无效结果，请到 Notebook 检查是否已添加。');
 const state=['PROCESSING','ACTIVE','FAILED'].includes(String(result.state))?String(result.state):'PROCESSING';
 await env.DB.prepare('UPDATE meta SET value=? WHERE key=?').bind(JSON.stringify({source:result.name,state}),key).run();
 const config=await loadConfig(env);await storeConfig(env,{...config,defaultNotebook:body.notebook});return json({ok:state!=='FAILED',state,notebookUrl:HOME});
}
/** Caller supplies the authenticated owner ID. All credential-changing operations also require recent authentication. */
export async function handleNotebookApi(request:Request,env:Env,userId:string):Promise<Response>{
 const path=new URL(request.url).pathname;
 if(!['GET','HEAD'].includes(request.method))checkWriteRequest(request);
 if(path==='/api/notebook/callback'&&request.method==='GET')return callback(request,env,userId);
 if(path==='/api/notebook/status'&&request.method==='GET'){const [config,tokens]=await Promise.all([loadConfig(env),loadCredentials(env,userId)]);return json({clientConfigured:!!client(env),connected:!!tokens&&(tokens.expiresAt>Date.now()||!!tokens.refreshToken),projectId:config.projectId,defaultNotebook:config.defaultNotebook,callbackUrl:new URL('/api/notebook/callback',request.url).toString()});}
 if(path==='/api/notebook/connect'&&request.method==='POST'){await readJson(request);return connect(request,env,userId);}
 if(path==='/api/notebook/config'&&request.method==='PUT'){await requireRecentAuth(request,env);const body=await readJson(request);if(typeof body.projectId!=='string'||(body.projectId!==''&&!/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(body.projectId)))throw new HttpError(400,'请填写有效的 Google Cloud 项目 ID，或留空使用 OAuth 客户端项目。');const old=await loadConfig(env);await storeConfig(env,{...old,projectId:body.projectId});return json({ok:true});}
 if(path==='/api/notebook/connection'&&request.method==='DELETE'){await requireRecentAuth(request,env);await readJson(request);await env.DB.prepare('DELETE FROM settings WHERE id=?').bind(await tokenKey(userId)).run();return json({ok:true});}
 if(path==='/api/notebook/notebooks'&&request.method==='GET'){
  const token=new URL(request.url).searchParams.get('pageToken');if(token&&(token.length>4096||/[\x00-\x1f]/.test(token)))throw new HttpError(400,'分页参数无效。');
  const query=new URLSearchParams({pageSize:'50',filter:'notebook.is_owner = true',...(token?{pageToken:token}:{})});const value=await googleRequest(env,userId,'/notebooks?'+query);
  const notebooks=Array.isArray(value.notebooks)?value.notebooks.flatMap(entry=>{if(!entry||typeof entry!=='object')return [];const item=entry as Record<string,unknown>;return typeof item.name==='string'&&NOTEBOOK_NAME.test(item.name)?[{name:item.name,displayName:typeof item.displayName==='string'?item.displayName.slice(0,500):item.name}]:[];}):[];
  return json({notebooks,...(typeof value.nextPageToken==='string'&&value.nextPageToken.length<=4096?{nextPageToken:value.nextPageToken}:{})});
 }
 if(path==='/api/notebook/share'&&request.method==='POST')return share(env,userId,await readJson(request),new URL(request.url).origin);
 return json({error:'Notebook 接口不存在。'},404);
}
