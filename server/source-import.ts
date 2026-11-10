import {XMLParser,XMLValidator} from 'fast-xml-parser';
import type {Source,Topic} from '../shared/types';
import {listSources,type Env} from './db';
import {normalizeSourceInput,createSource,sourceComparisonKey} from './sources';
import {plainText,fetchSafe,validatePublicUrl} from './fetch-safe';
import {HttpError} from './security';
import {resolvePublicDns,type PublicDnsResolver} from './provider-endpoint';
import {hasSensitiveAiInput} from './ai-input';

const MAX_BYTES=65536,MAX_CANDIDATES=100,MAX_COMMIT=10;
function sensitiveLocator(locator:string):boolean{return hasSensitiveAiInput(plainText(locator));}
function sensitiveDocument(input:string):boolean{
 return hasSensitiveAiInput(input);
}
export interface ImportCandidate {id:string;name:string;platform:Source['platform'];locator:string;topics:Topic[];enabled:boolean;origin:'deterministic'|'ai';error?:string;existingId?:string;}
export interface ImportError {id?:string;index:number;input:string;message:string;}
export interface ImportPreview {candidates:ImportCandidate[];errors:ImportError[];warnings:string[];ai:{status:'not_requested'|'completed'|'needsConfiguration'};total:number;}
export interface SourceDiscoveryMessage {role:'user'|'assistant';content:string;}
export function validateDiscoveryMessages(value:unknown):SourceDiscoveryMessage[]{
 if(!Array.isArray(value)||value.length<1||value.length>12)throw new HttpError(400,'请提供最多 6 轮的来源发现对话。');
 let total=0;const messages=value.map((entry,index)=>{const item=object(entry);if(!item||!['user','assistant'].includes(String(item.role))||typeof item.content!=='string'||!item.content.trim()||item.content.length>2000)throw new HttpError(400,'对话仅支持 user/assistant 消息，每条最多 2000 个字符。');if((index%2===0?'user':'assistant')!==item.role)throw new HttpError(400,'请按用户与助手交替顺序提交对话。');total+=item.content.length;return {role:item.role as SourceDiscoveryMessage['role'],content:item.content.trim()};});
 if(total>12000)throw new HttpError(400,'对话总长度不能超过 12000 个字符。');if(messages[messages.length-1].role!=='user')throw new HttpError(400,'请先填写你的回复。');if(sensitiveDocument(messages.map(message=>message.content).join('\n')))throw new HttpError(400,'请只在 AI 设置填密钥，不要在对话粘贴凭据。');return messages;
}
type RawCandidate={name?:unknown;platform?:unknown;locator?:unknown;topics?:unknown;enabled?:unknown;error?:string};
const object=(value:unknown):Record<string,unknown>|undefined=>value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:undefined;
const text=(value:unknown)=>typeof value==='string'?value:'';
const safeName=(value:unknown)=>plainText(text(value)).slice(0,150);
const safeError=(error:unknown)=>error instanceof HttpError?error.message:'来源格式不正确，请检查后重试。';
const platformNames:Record<string,Source['platform']>={youtube:'youtube',yt:'youtube',bilibili:'bilibili',b站:'bilibili',哔哩哔哩:'bilibili',rss:'rss',feed:'rss',github:'github',x:'x',twitter:'x',web:'web',website:'web'};
const platform=(value:unknown)=>typeof value==='string'?platformNames[value.toLowerCase().trim()]:undefined;

/** Hard bound before parsing either request JSON or the user-supplied document. */
export async function readSourceImportBody(request:Request):Promise<Record<string,unknown>>{
 if(Number(request.headers.get('content-length')||0)>MAX_BYTES)throw new HttpError(413,'批量导入内容不能超过 64KB。');
 const reader=request.body?.getReader();if(!reader)throw new HttpError(400,'请提供批量导入内容。');
 let bytes=0,result='';const decoder=new TextDecoder();
 try{while(true){const part=await reader.read();if(part.done)break;bytes+=part.value.byteLength;if(bytes>MAX_BYTES){await reader.cancel();throw new HttpError(413,'批量导入内容不能超过 64KB。');}result+=decoder.decode(part.value,{stream:true});}result+=decoder.decode();}finally{reader.releaseLock();}
 let parsed:unknown;try{parsed=JSON.parse(result);}catch{throw new HttpError(400,'请提交有效的 JSON 请求。');}const body=object(parsed);if(!body)throw new HttpError(400,'请提交有效的 JSON 请求。');return body;
}
function inferLocator(locator:string,explicit?:Source['platform']):{platform:Source['platform'];locator:string}{
 if(explicit)return {platform:explicit,locator};
 try{const url=new URL(locator);const host=url.hostname.toLowerCase();
  if(host==='youtube.com'||host.endsWith('.youtube.com')){const id=url.pathname==='/feeds/videos.xml'?url.searchParams.get('channel_id'):null;return {platform:'youtube',locator:id||locator};}
  if(host==='space.bilibili.com')return {platform:'bilibili',locator};
  if(host==='github.com'&&/^\/[^/]+\/?$/.test(url.pathname))return {platform:'github',locator};
  if(['x.com','www.x.com','twitter.com','www.twitter.com'].includes(host))return {platform:'x',locator};
  return {platform:/\.(?:rss|xml|atom)\/?$|\/(?:feed|feeds|rss|atom)(?:\/|$)/i.test(url.pathname)?'rss':'web',locator};
 }catch{return {platform:/^UC[A-Za-z0-9_-]{22}$/.test(locator)?'youtube':'web',locator};}
}
function csvRows(input:string):string[][]{
 const rows:string[][]=[];let row:string[]=[],cell='',quoted=false;
 for(let i=0;i<input.length;i++){const char=input[i];if(char==='"'){if(quoted&&input[i+1]==='"'){cell+='"';i++;}else if(quoted||cell==='')quoted=!quoted;else cell+=char;}else if(char===','&&!quoted){row.push(cell);cell='';}else if((char==='\n'||char==='\r')&&!quoted){if(char==='\r'&&input[i+1]==='\n')i++;row.push(cell);if(row.some(value=>value.trim()))rows.push(row);row=[];cell='';}else cell+=char;}
 if(quoted)throw new HttpError(400,'CSV 引号未闭合，请检查导出文件。');row.push(cell);if(row.some(value=>value.trim()))rows.push(row);return rows;
}
function parseDocument(input:string):RawCandidate[]{
 const raw:RawCandidate[]=[];const push=(candidate:RawCandidate)=>{if(raw.length>=MAX_CANDIDATES)throw new HttpError(400,'每次最多预览 100 个来源，请分批导入。');if(sensitiveLocator(text(candidate.locator)))candidate={...candidate,locator:'[已隐藏敏感链接]',error:'此链接含凭据或账号操作，已隐藏且不会导入。'};if(hasSensitiveAiInput(text(candidate.name)))candidate={...candidate,name:'[已隐藏敏感内容]',error:'来源名称疑似包含密钥，请移除后重试。'};raw.push(candidate);};
 const trimmed=input.replace(/^\uFEFF/,'').trim();if(!trimmed)return raw;
 if(trimmed.startsWith('{')||trimmed.startsWith('[')){
  let json:unknown;try{json=JSON.parse(trimmed);}catch{throw new HttpError(400,'JSON 订阅清单格式不正确。');}
  const walk=(value:unknown,hint?:Source['platform'],depth=0):void=>{
   if(depth>8)throw new HttpError(400,'JSON 订阅清单嵌套过深。');
   if(Array.isArray(value)){for(const entry of value)walk(entry,hint,depth+1);return;}
   if(typeof value==='string'){push({locator:value,platform:hint});return;}
   const entry=object(value);if(!entry){push({error:'订阅条目必须是链接或来源对象。'});return;}
   const locator=entry.locator??entry.url??entry.channelUrl??entry.channel_url??entry.channelID??entry.channelId??entry.channel_id??entry.uid??entry.username;
   if(locator!==undefined){const sourcePlatform=entry.platform??hint;const normalizedLocator=platform(sourcePlatform)==='bilibili'&&typeof locator==='number'&&Number.isSafeInteger(locator)&&locator>0?String(locator):locator;push({name:entry.name??entry.title??entry.channelTitle,platform:sourcePlatform,locator:normalizedLocator,topics:entry.topics,enabled:entry.enabled});return;}
   let found=false;for(const [key,child] of Object.entries(entry)){const known=platform(key);if(known||['subscriptions','channels','sources','items'].includes(key)){found=true;walk(child,known??hint,depth+1);}}
   if(!found)push({error:'订阅条目缺少 locator、url 或频道标识。'});
  };walk(json);return raw;
 }
 if(/^<\?xml|^<opml\b/i.test(trimmed)){
  if(/<!DOCTYPE|<!ENTITY/i.test(trimmed)||XMLValidator.validate(trimmed)!==true)throw new HttpError(400,'OPML 文件格式不正确或包含不支持的声明。');
  const parsed=new XMLParser({ignoreAttributes:false,attributeNamePrefix:'',processEntities:false}).parse(trimmed);
  if(!object(parsed)?.opml)throw new HttpError(400,'请提供 OPML 订阅导出文件。');
  const walk=(value:unknown,depth=0):void=>{if(depth>40)throw new HttpError(400,'OPML 目录嵌套过深。');if(Array.isArray(value)){for(const child of value)walk(child,depth+1);return;}const entry=object(value);if(!entry)return;if(entry.xmlUrl||entry.htmlUrl)push({name:entry.title??entry.text,platform:entry.xmlUrl?'rss':'web',locator:entry.xmlUrl??entry.htmlUrl});if(entry.outline)walk(entry.outline,depth+1);};
  walk(parsed.opml.body?.outline);return raw;
 }
 const first=trimmed.split(/\r?\n/,1)[0];
 if(first.includes(',')&&/channel[ _-]*(?:id|url|title)/i.test(first)){
  const rows=csvRows(trimmed);const headers=rows.shift()!.map(header=>header.trim().toLowerCase().replace(/[ _-]/g,''));
  const id=headers.findIndex(header=>header==='channelid'),url=headers.findIndex(header=>['channelurl','url'].includes(header)),name=headers.findIndex(header=>['channeltitle','channelname','name','title'].includes(header));
  if(id<0&&url<0)throw new HttpError(400,'YouTube CSV 需要 Channel Id 或 Channel Url 列。');
  for(const row of rows)push({platform:'youtube',locator:(id>=0?row[id]?.trim():'')||(url>=0?row[url]?.trim():''),name:name>=0?row[name]:undefined});return raw;
 }
 for(const line of trimmed.split(/\r?\n/)){
  const matches=[...line.matchAll(/https?:\/\/[^\s<>"']+/gi)];
  for(const match of matches){const locator=match[0].replace(/[.,;，。；、!?！？)\]}]+$/,'');const prefix=line.slice(0,match.index).replace(/^\s*(?:[-*]|\d+[.)])\s*/, '').replace(/[\s:[（(]+$/,'');push({locator,name:matches.length===1&&prefix.length>0&&prefix.length<=150?prefix:undefined});}
  if(!matches.length&&/^UC[A-Za-z0-9_-]{22}$/.test(line.trim()))push({platform:'youtube',locator:line.trim()});
 }
 return raw;
}
async function normalizeCandidates(raw:RawCandidate[],existing:Source[],resolver?:PublicDnsResolver,ids?:ImportCandidate[]):Promise<ImportCandidate[]>{
 const candidates:ImportCandidate[]=[];const seen=new Map<string,string>();
 for(let index=0;index<raw.length;index++){
  const item=raw[index],explicit=platform(item.platform),inferred=inferLocator(text(item.locator),explicit);
  const candidate:ImportCandidate={id:ids?.[index]?.id||'candidate-'+(index+1),name:safeName(item.name),...inferred,topics:[],enabled:typeof item.enabled==='boolean'?item.enabled:true,origin:ids?.[index]?.origin??'deterministic'};
  try{
   if(item.error)throw new HttpError(400,item.error);if(item.platform!==undefined&&!explicit)throw new HttpError(400,'请选择支持的内容来源类型。');
   const normalized=await normalizeSourceInput({platform:inferred.platform,locator:inferred.locator,...(item.name===undefined?{}:{name:item.name}),topics:item.topics,enabled:item.enabled},undefined,resolver,'url-only');Object.assign(candidate,normalized);
   const key=sourceComparisonKey(normalized);const old=existing.find(source=>sourceComparisonKey(source)===key);if(old)candidate.existingId=old.id;else if(seen.has(key))candidate.error='此清单中已包含相同来源。';
   seen.set(key,candidate.id);
  }catch(error){candidate.error=safeError(error);}
  candidates.push(candidate);
 }
 return candidates;
}
/** Read actual alternate-feed declarations, never guessed paths or AI-generated URLs. */
async function discoverRss(candidates:ImportCandidate[],resolver?:PublicDnsResolver):Promise<{candidates:ImportCandidate[];warnings:string[]}>{
 const result=[...candidates],warnings:{index:number;message:string}[]=[];
 const websites=candidates.map((candidate,index)=>({candidate,index})).filter(({candidate})=>candidate.platform==='web'&&!candidate.error&&!candidate.existingId).slice(0,5);
 await Promise.all(websites.map(async({candidate,index})=>{
  try{
   const page=await fetchSafe(candidate.locator,{maxBytes:262144,timeout:6000,resolver,maxRedirects:1,sameOriginRedirects:true});
   const host=new URL(page.url).hostname;let feedUrl:string|undefined;
   for(const tag of page.text.match(/<link\b[^>]{0,4096}>/gi)||[]){
    const attrs:Record<string,string>={};for(const match of tag.matchAll(/([a-z][\w:-]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi))attrs[match[1].toLowerCase()]=match[2]??match[3]??match[4];
    if(!attrs.rel?.toLowerCase().split(/\s+/).includes('alternate')||!/^application\/(?:rss\+xml|atom\+xml)(?:\s*;|$)/i.test(attrs.type||'')||!attrs.href)continue;
    try{const url=validatePublicUrl(new URL(attrs.href.replace(/&amp;/g,'&'),page.url).toString());if(url.hostname===host){feedUrl=url.toString();break;}}catch{/* Unsafe declarations are ignored without fetching. */}
   }
   if(!feedUrl)throw new Error('No samehost feed');
   const feed=await fetchSafe(feedUrl,{maxBytes:262144,timeout:6000,resolver,maxRedirects:1,sameOriginRedirects:true});
   if(new URL(feed.url).hostname!==host||/<!DOCTYPE|<!ENTITY/i.test(feed.text)||XMLValidator.validate(feed.text)!==true)throw new Error('Invalid feed');
   const parsed=new XMLParser({ignoreAttributes:false,processEntities:false}).parse(feed.text);if(!parsed.rss&&!parsed.feed)throw new Error('Invalid feed');
   const normalized=await normalizeSourceInput({platform:'rss',name:candidate.name,locator:feed.url,topics:candidate.topics,enabled:candidate.enabled},undefined,resolver,'url-only');
   result[index]={...candidate,...normalized,platform:'rss'};
  }catch{warnings.push({index,message:'未发现可验证的同站 RSS，已保留手动来源：'+candidate.name});}
 }));
 return {candidates:result,warnings:warnings.sort((a,b)=>a.index-b.index).map(warning=>warning.message)};
}
function markDiscoveredDuplicates(candidates:ImportCandidate[],existing:Source[]):ImportCandidate[]{
 const seen=new Set<string>();return candidates.map(candidate=>{const item={...candidate};if(item.error)return item;const key=sourceComparisonKey(item);const old=existing.find(source=>sourceComparisonKey(source)===key);if(old)item.existingId=old.id;else if(seen.has(key))item.error='此清单中已包含相同来源。';seen.add(key);return item;});
}
export async function previewSourceImport(env:Env,body:Record<string,unknown>,resolver?:PublicDnsResolver):Promise<ImportPreview>{
 if(typeof body.text!=='string')throw new HttpError(400,'请粘贴订阅清单或文件内容。');
 if(new TextEncoder().encode(body.text).byteLength>MAX_BYTES)throw new HttpError(413,'批量导入内容不能超过 64KB。');
 if(body.useAi!==undefined&&typeof body.useAi!=='boolean')throw new HttpError(400,'AI 辅助选项必须为布尔值。');
 const sensitive=sensitiveDocument(body.text);if(body.useAi===true&&sensitive)throw new HttpError(400,'输入疑似包含密钥、密码或私密链接，未发送给 AI。请移除后重试。');
 const dns=new Map<string,Promise<string[]>>();const realResolver=resolver||resolvePublicDns;const requestResolver:PublicDnsResolver=hostname=>{let result=dns.get(hostname);if(!result){result=realResolver(hostname);dns.set(hostname,result);}return result;};
 const existing=await listSources(env);let candidates=await normalizeCandidates(parseDocument(body.text),existing,resolver);const discovery=await discoverRss(candidates,requestResolver);candidates=markDiscoveredDuplicates(discovery.candidates,existing);const warnings:string[]=['导入仅校验公开 HTTPS 地址格式；能否读取会在首次更新前通过公开 DNS 安全检查。',...discovery.warnings];let status:ImportPreview['ai']['status']='not_requested';
 if(body.useAi===true){const {assistSourceImport}=await import('./ai');const assisted=await assistSourceImport(env,body.text,candidates);status=assisted.status;warnings.push(...assisted.warnings);if(assisted.candidates.length>MAX_CANDIDATES)throw new HttpError(400,'AI 返回了过多候选来源。');candidates=await normalizeCandidates(assisted.candidates.map(({error,...candidate})=>candidate),existing,resolver,assisted.candidates);}
 if(candidates.some(candidate=>candidate.platform==='web'))warnings.push('普通网站保留为手动来源；只有明确的 RSS 地址会自动更新。');
 if(sensitive)warnings.push('请勿粘贴密码、API 密钥或带 token 的私密链接；敏感链接已隐藏，不会导入。');
 const errors=candidates.flatMap((candidate,index)=>candidate.error?[{id:candidate.id,index,input:candidate.locator,message:candidate.error}]:[]);
 return {candidates,errors,warnings,ai:{status},total:candidates.length};
}
export async function commitSourceImport(env:Env,body:Record<string,unknown>,resolver?:PublicDnsResolver){
 if(!Array.isArray(body.candidates)||body.candidates.length<1||body.candidates.length>MAX_COMMIT)throw new HttpError(400,'每次请求最多导入 10 个来源；网页会将所选来源分批提交。');
 const created:(Source&{candidateId?:string;index:number})[]=[],duplicates:{id?:string;index:number;name:string;existingId:string}[]=[],errors:ImportError[]=[];
 const known=[...await listSources(env)];
 for(let index=0;index<body.candidates.length;index++){
  const input=object(body.candidates[index]);const id=typeof input?.id==='string'?input.id.slice(0,100):undefined;
  try{
   if(!input)throw new HttpError(400,'请提交有效的内容来源。');
   if(sensitiveLocator(text(input.locator))||hasSensitiveAiInput(text(input.name)))throw new HttpError(400,'来源包含凭据、私密链接或密钥，请移除后重试。');
   // Explicit whitelist: importing can never alter an existing source, block controls or provider keys.
   const safe={name:input.name,platform:input.platform,locator:input.locator,topics:input.topics,enabled:input.enabled};
   const normalized=await normalizeSourceInput(safe,undefined,resolver,'url-only');const old=known.find(source=>sourceComparisonKey(source)===sourceComparisonKey(normalized));
   if(old){duplicates.push({id,index,name:normalized.name,existingId:old.id});continue;}
   try{const source=await createSource(env,safe,resolver,'url-only');created.push({...source,candidateId:id,index});known.push(source);}catch(error){if(error instanceof HttpError&&error.status===409){const winner=(await listSources(env)).find(source=>sourceComparisonKey(source)===sourceComparisonKey(normalized));if(winner){duplicates.push({id,index,name:normalized.name,existingId:winner.id});known.push(winner);continue;}}throw error;}
  }catch(error){const locator=text(input?.locator);errors.push({id,index,input:sensitiveLocator(locator)?'[已隐藏敏感链接]':locator.slice(0,4096),message:safeError(error)});}
 }
 return {created,duplicates,errors};
}
