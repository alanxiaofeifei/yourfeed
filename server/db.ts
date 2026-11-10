import type { D1Database } from '@cloudflare/workers-types';
import type { Analysis, ContentItem, Feedback, Provider, ProviderConfig, Source, Usage } from '../shared/types';
import { encryptSecret, decryptSecret, HttpError, providerName } from './security';
import { validateProviderBaseUrl } from './provider-endpoint';
import { getProfile } from './profile';
import { profileDate } from '../shared/profile';
export interface Env { DB:D1Database; APP_ENCRYPTION_KEY?:string; OPENAI_API_KEY?:string; DEEPSEEK_API_KEY?:string; GLM_API_KEY?:string; ZHIPUAI_API_KEY?:string; YOUTUBE_API_KEY?:string; [key:string]:unknown; }
export const DEFAULT_MODELS: Record<Provider,string> = {openai:'gpt-6.1-sol',deepseek:'deepseek-flash',glm:'glm-5.3',custom:''};
export const defaultConfig: ProviderConfig = {provider:'openai',model:DEFAULT_MODELS.openai,protocol:'responses',responseFormat:'json_schema',reasoningEffort:'low',maxOutputTokens:2048,timeoutSeconds:25,enabled:false,monthlyBudget:20,dailyLimit:20};
export const PROVIDERS:Provider[]=['openai','deepseek','glm','custom'];
export const PRESET_BASE_URLS={openai:'https://api.openai.com/v1',deepseek:'https://api.deepseek.com',glm:'https://open.bigmodel.cn/api/paas/v4'};
function profileDefaults(provider:Provider):ProviderConfig {return {...defaultConfig,provider,model:DEFAULT_MODELS[provider],providerName:provider==='custom'?'自定义兼容接口':provider==='openai'?'OpenAI':provider==='deepseek'?'DeepSeek':'GLM',baseUrl:provider==='custom'?'':PRESET_BASE_URLS[provider],protocol:provider==='openai'?'responses':'chat-completions',responseFormat:provider==='openai'?'json_schema':'json_object',reasoningEffort:provider==='openai'?'low':undefined};}
export function usagePeriod(timezone='Asia/Taipei') { const day = profileDate(new Date(),timezone);return {day,month:day.slice(0,7)}; }
export async function getState(env:Env,key:string):Promise<string|null> {return (await env.DB.prepare('SELECT value FROM meta WHERE key=?').bind(key).first<{value:string}>())?.value ?? null;}
export async function setState(env:Env,key:string,value:string):Promise<void> {await env.DB.prepare('INSERT INTO meta (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').bind(key,value).run();}
export async function initialize(env:Env):Promise<void> {
  if(await getState(env,'seeded-v1'))return;
  // Fresh deployments start empty; owners add sources or import content explicitly.
  await setState(env,'seeded-v1',new Date().toISOString());
}
export async function listContent(env:Env):Promise<ContentItem[]> { const r=await env.DB.prepare('SELECT json FROM content ORDER BY updated_at DESC LIMIT 4000').all<{json:string}>();return r.results.map(r=>JSON.parse(r.json)); }
export async function upsertContent(env:Env,items:ContentItem[]):Promise<void> {
  for(let i=0;i<items.length;i+=75)await env.DB.batch(items.slice(i,i+75).map(item=>env.DB.prepare("INSERT INTO content(id,source_id,kind,url,json,updated_at) VALUES (?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET source_id=excluded.source_id,kind=excluded.kind,url=excluded.url,json=CASE WHEN json_extract(content.json,'$.title') IS json_extract(excluded.json,'$.title') AND json_extract(content.json,'$.summary') IS json_extract(excluded.json,'$.summary') AND json_extract(content.json,'$.body') IS json_extract(excluded.json,'$.body') THEN json_patch(content.json,excluded.json) ELSE excluded.json END,updated_at=excluded.updated_at").bind(item.id,item.sourceId,item.kind,item.url,JSON.stringify(item),new Date().toISOString())));
}
export async function listSources(env:Env):Promise<Source[]> {const r=await env.DB.prepare('SELECT json FROM sources').all<{json:string}>();return r.results.map(r=>JSON.parse(r.json));}
export async function updateSource(env:Env,source:Source):Promise<void> {await env.DB.prepare('INSERT INTO sources(id,json) VALUES (?,?) ON CONFLICT(id) DO UPDATE SET json=excluded.json').bind(source.id,JSON.stringify(source)).run();}
export async function readFeedback(env:Env,userId:string):Promise<Record<string,Feedback>> {const r=await env.DB.prepare('SELECT item_id,json FROM feedback WHERE user_id=?').bind(userId).all<{item_id:string,json:string}>();return Object.fromEntries(r.results.map(r=>[r.item_id,JSON.parse(r.json)]));}
export async function saveFeedback(env:Env,userId:string,itemId:string,patch:Feedback):Promise<Feedback> {const old=await env.DB.prepare('SELECT json FROM feedback WHERE user_id=? AND item_id=?').bind(userId,itemId).first<{json:string}>();const value={...(old?JSON.parse(old.json):{}),...patch};await env.DB.prepare('INSERT INTO feedback(user_id,item_id,json) VALUES (?,?,?) ON CONFLICT(user_id,item_id) DO UPDATE SET json=excluded.json').bind(userId,itemId,JSON.stringify(value)).run();return value;}
export async function getConfig(env:Env,forProvider?:Provider):Promise<ProviderConfig> {
  const row=await env.DB.prepare('SELECT json FROM settings WHERE id=?').bind('config').first<{json:string}>();
  const active=row?JSON.parse(row.json):defaultConfig;const provider=forProvider??active.provider;
  const stored=await env.DB.prepare('SELECT json FROM settings WHERE id=?').bind('profile:'+provider).first<{json:string}>();
  const profile=stored?JSON.parse(stored.json):active.provider===provider?active:{};
  return {...profileDefaults(provider),...profile,provider,monthlyBudget:active.monthlyBudget??20,dailyLimit:active.dailyLimit??20};
}
export async function getSecret(env:Env,id:string):Promise<string|undefined> {
  const row=await env.DB.prepare('SELECT json FROM settings WHERE id=?').bind('key:'+id).first<{json:string}>();
  if(row){const data=JSON.parse(row.json);if(id==='custom'&&data.boundBaseUrl!==(await getConfig(env,'custom')).baseUrl)throw new HttpError(400,'自定义地址已变化，请重新保存用于该地址的密钥。');return decryptSecret(data.cipher,env.APP_ENCRYPTION_KEY,(typeof env.SECRET_NAMESPACE==='string'?env.SECRET_NAMESPACE:'yourfeed')+':'+id);}
  const name:Record<string,string>={openai:'OPENAI_API_KEY',deepseek:'DEEPSEEK_API_KEY',glm:'GLM_API_KEY',youtube:'YOUTUBE_API_KEY'};
  return typeof env[name[id]]==='string'?String(env[name[id]]):id==='glm'&&typeof env.ZHIPUAI_API_KEY==='string'?env.ZHIPUAI_API_KEY:undefined;
}
export async function getProviderKey(env:Env,provider?:Provider):Promise<string|undefined> {return getSecret(env,provider??(await getConfig(env)).provider);}
async function secretStatus(env:Env,id:string) {
  const row=await env.DB.prepare('SELECT json FROM settings WHERE id=?').bind('key:'+id).first<{json:string}>();
  if(row){const s=JSON.parse(row.json);const configured=id!=='custom'||s.boundBaseUrl===(await getConfig(env,'custom')).baseUrl;return {configured,keyLast4:configured?s.last4:undefined};}
  const value=await getSecret(env,id);return {configured:!!value,keyLast4:value?.slice(-4)};
}
export async function publicConfig(env:Env) {
  const config=await getConfig(env);const status=await secretStatus(env,config.provider);const youtube=await secretStatus(env,'youtube');
  const providers=await Promise.all(PROVIDERS.map(async provider=>({provider,...await secretStatus(env,provider)})));
  const profiles=Object.fromEntries(await Promise.all(PROVIDERS.map(async provider=>[provider,{...await getConfig(env,provider),...await secretStatus(env,provider)}])));
  return {...config,...status,youtubeConfigured:youtube.configured,youtubeKeyLast4:youtube.keyLast4,providers,profiles};
}
async function secretStatement(env:Env,id:string,value:string,boundBaseUrl?:string) {
  if(value.length<8||value.length>1024||/[\r\n]/.test(value))throw new HttpError(400,'密钥格式不正确。');
  const cipher=await encryptSecret(value,env.APP_ENCRYPTION_KEY,(typeof env.SECRET_NAMESPACE==='string'?env.SECRET_NAMESPACE:'yourfeed')+':'+id);
  return env.DB.prepare('INSERT INTO settings(id,json) VALUES (?,?) ON CONFLICT(id) DO UPDATE SET json=excluded.json').bind('key:'+id,JSON.stringify({cipher,last4:value.slice(-4),...(boundBaseUrl?{boundBaseUrl}:{})}));
}
function optionalNumber(input:Record<string,unknown>,name:string,old:number|undefined,min:number,max:number,integer=false):number|undefined {
  if(input[name]===null||input[name]==='')return undefined;
  if(input[name]===undefined)return old;
  const value=Number(input[name]);if(!Number.isFinite(value)||value<min||value>max||(integer&&!Number.isInteger(value)))throw new HttpError(400,'高级参数 '+name+' 超出允许范围。');return value;
}
export async function saveConfig(env:Env,input:Record<string,unknown>) {
  const active=await getConfig(env);const provider=input.provider===undefined?active.provider:providerName(input.provider);const old=await getConfig(env,provider);
  const model=typeof input.model==='string'?input.model.trim():old.model;
  if(!model||model.length>120||/[\u0000-\u001f\u007f]/.test(model))throw new HttpError(400,'请填写有效的模型名称。');
  const monthlyBudget=input.monthlyBudget===undefined?active.monthlyBudget:Number(input.monthlyBudget);const dailyLimit=input.dailyLimit===undefined?active.dailyLimit:Number(input.dailyLimit);
  if(!Number.isFinite(monthlyBudget)||monthlyBudget<0||monthlyBudget>1000||!Number.isInteger(dailyLimit)||dailyLimit<0||dailyLimit>500)throw new HttpError(400,'预算应为 0–1000 美元，每日分析数量应为 0–500 条。');
  const enabled=typeof input.enabled==='boolean'?input.enabled:old.enabled;
  let baseUrl=provider==='custom'?(typeof input.baseUrl==='string'?input.baseUrl.trim():old.baseUrl||''):PRESET_BASE_URLS[provider];
  if(provider==='custom')baseUrl=validateProviderBaseUrl(baseUrl);
  else if(typeof input.baseUrl==='string'&&input.baseUrl.replace(/\/$/,'')!==baseUrl)throw new HttpError(400,'预设服务商使用固定官方地址；其他地址请使用自定义接口。');
  const protocol=input.protocol===undefined?old.protocol:input.protocol;
  if(protocol!=='responses'&&protocol!=='chat-completions')throw new HttpError(400,'请选择支持的 API 协议。');
  if(provider!=='custom'&&protocol!==profileDefaults(provider).protocol)throw new HttpError(400,'预设服务商使用固定官方协议。');
  const responseFormat=input.responseFormat===undefined?old.responseFormat:input.responseFormat;
  if(!['json_schema','json_object','none'].includes(String(responseFormat)))throw new HttpError(400,'请选择支持的输出格式。');
  const reasoning=input.reasoningEffort===null||input.reasoningEffort===''?'':input.reasoningEffort===undefined?old.reasoningEffort:String(input.reasoningEffort);
  if(reasoning!==undefined&&reasoning!==''&&!['none','minimal','low','medium','high','xhigh','max'].includes(reasoning))throw new HttpError(400,'推理强度设置无效。');
  const modelChanged=model!==old.model;
  const inputPricePerMillion=optionalNumber(input,'inputPricePerMillion',provider==='custom'&&modelChanged?undefined:old.inputPricePerMillion,0,1000000);
  const outputPricePerMillion=optionalNumber(input,'outputPricePerMillion',provider==='custom'&&modelChanged?undefined:old.outputPricePerMillion,0,1000000);
  if(provider==='custom'&&enabled&&(inputPricePerMillion===undefined||outputPricePerMillion===undefined))throw new HttpError(400,'启用自定义模型前，请填写输入与输出的每百万 token 价格。');
  const key=typeof input.key==='string'?input.key.trim():'';const existing=await secretStatus(env,provider);
  if(provider==='custom'&&existing.configured&&baseUrl!==old.baseUrl&&!key&&input.clearKey!==true)throw new HttpError(400,'自定义地址已变化，请输入用于新地址的密钥后再保存。');
  const config:ProviderConfig={provider,model,baseUrl,protocol:protocol as ProviderConfig['protocol'],responseFormat:responseFormat as ProviderConfig['responseFormat'],reasoningEffort:reasoning,providerName:typeof input.providerName==='string'?input.providerName.replace(/[\u0000-\u001f]/g,'').trim().slice(0,80):old.providerName,temperature:optionalNumber(input,'temperature',old.temperature,0,2),maxOutputTokens:optionalNumber(input,'maxOutputTokens',old.maxOutputTokens,128,32768,true)??2048,timeoutSeconds:optionalNumber(input,'timeoutSeconds',old.timeoutSeconds,5,120,true)??25,inputPricePerMillion,outputPricePerMillion,monthlyBudget,dailyLimit,enabled};
  const statements=[];
  if(key)statements.push(await secretStatement(env,provider,key,provider==='custom'?baseUrl:undefined));
  if(typeof input.youtubeKey==='string'&&input.youtubeKey.trim())statements.push(await secretStatement(env,'youtube',input.youtubeKey.trim()));
  if(input.clearKey===true)statements.push(env.DB.prepare('DELETE FROM settings WHERE id=?').bind('key:'+provider));
  if(input.clearYoutubeKey===true)statements.push(env.DB.prepare('DELETE FROM settings WHERE id=?').bind('key:youtube'));
  statements.push(env.DB.prepare('INSERT INTO settings(id,json) VALUES (?,?) ON CONFLICT(id) DO UPDATE SET json=excluded.json').bind('profile:'+provider,JSON.stringify(config)),env.DB.prepare('INSERT INTO settings(id,json) VALUES (?,?) ON CONFLICT(id) DO UPDATE SET json=excluded.json').bind('config',JSON.stringify(config)));
  await env.DB.batch(statements);return publicConfig(env);
}
export interface Reservation {reservationId:string;day:string;month:string;maxCost:number;dailyLimit:number;monthlyBudget:number;contentId:string;isTest?:boolean;}
export async function reserveUsage(env:Env,r:Reservation):Promise<boolean> {
  if(!Number.isFinite(r.maxCost)||r.maxCost<0)return false;
  const result=await env.DB.prepare("INSERT OR IGNORE INTO reservations(id,day,month,content_id,reserved_cost,cost,input_tokens,output_tokens,is_test,status,created_at) SELECT ?,?,?,?,?,0,0,0,?,'reserved',? WHERE COALESCE((SELECT SUM(reserved_cost) FROM reservations WHERE month=?),0)+? <= ? AND (?=1 OR (SELECT COUNT(*) FROM reservations WHERE day=? AND is_test=0 AND (status IN ('reserved','settled') OR cost>0)) < ?) AND (?=1 OR NOT EXISTS (SELECT 1 FROM reservations WHERE content_id=? AND status='reserved' AND created_at>?)) AND (?=0 OR (SELECT COUNT(*) FROM reservations WHERE is_test=1 AND created_at>?)<5)").bind(r.reservationId,r.day,r.month,r.contentId,r.maxCost,r.isTest?1:0,new Date().toISOString(),r.month,r.maxCost,r.monthlyBudget,r.isTest?1:0,r.day,r.dailyLimit,r.isTest?1:0,r.contentId,new Date(Date.now()-10*60000).toISOString(),r.isTest?1:0,new Date(Date.now()-10*60000).toISOString()).run();return result.meta.changes===1;
}
export async function settleUsage(env:Env,r:{reservationId:string;cost:number;inputTokens:number;outputTokens:number;success:boolean;uncertain?:boolean}):Promise<void> {
  if(r.uncertain)return;
  const cost=Math.max(0,r.cost||0);await env.DB.prepare('UPDATE reservations SET reserved_cost=?,cost=?,input_tokens=?,output_tokens=?,status=? WHERE id=? AND status=?').bind(cost,cost,Math.max(0,r.inputTokens||0),Math.max(0,r.outputTokens||0),r.success?'settled':'failed',r.reservationId,'reserved').run();
}
export async function getUsage(env:Env):Promise<Usage> {const {day,month}=usagePeriod((await getProfile(env)).timezone);const row=await env.DB.prepare("SELECT COALESCE(SUM(cost),0) AS cost,COALESCE(SUM(input_tokens),0) AS inputTokens,COALESCE(SUM(output_tokens),0) AS outputTokens,COALESCE(SUM(CASE WHEN status='reserved' THEN reserved_cost ELSE 0 END),0) AS reserved FROM reservations WHERE month=?").bind(month).first<{cost:number;inputTokens:number;outputTokens:number;reserved:number}>();const today=await env.DB.prepare("SELECT COUNT(*) AS count FROM reservations WHERE day=? AND is_test=0 AND (status IN ('settled','reserved') OR cost>0)").bind(day).first<{count:number}>();return {month,cost:row?.cost??0,inputTokens:row?.inputTokens??0,outputTokens:row?.outputTokens??0,reserved:row?.reserved??0,analyzedToday:today?.count??0};}
export async function getAnalysisCache(env:Env,id:string,fingerprint:string,provider:Provider,model:string):Promise<Analysis|null> {const row=await env.DB.prepare('SELECT json FROM analysis_cache WHERE content_id=? AND fingerprint=? AND provider=? AND model=?').bind(id,fingerprint,provider,model).first<{json:string}>();return row?JSON.parse(row.json):null;}
export async function saveAnalysisCache(env:Env,id:string,fingerprint:string,provider:Provider,model:string,analysis:Analysis):Promise<void> {await env.DB.prepare('INSERT INTO analysis_cache(content_id,fingerprint,provider,model,json) VALUES (?,?,?,?,?) ON CONFLICT(content_id,fingerprint,provider,model) DO UPDATE SET json=excluded.json').bind(id,fingerprint,provider,model,JSON.stringify(analysis)).run();}
