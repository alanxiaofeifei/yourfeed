import { XMLParser, XMLValidator } from 'fast-xml-parser';
import type { ContentItem, Source, Topic } from '../shared/types';
import { listSources, upsertContent, getState, setState, getSecret } from './db';
import type { Env } from './db';
import { canonicalUrl, fetchSafe, plainText, validatePublicUrl, resolveContentUrl, plainTextBlocks, SourceHttpError } from './fetch-safe';

const array = <T>(v:T|T[]|undefined):T[] => v===undefined?[]:Array.isArray(v)?v:[v];
const trim = (s:string,n:number) => s.length>n?s.slice(0,n)+'…':s;
export async function idFromUrl(url:string,prefix='item'):Promise<string>{
 const data=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(url));
 return prefix+'-'+Array.from(new Uint8Array(data)).map(v=>v.toString(16).padStart(2,'0')).join('').slice(0,24);
}
export function inferTopics(text:string,fallback:Topic[]=[]):Topic[]{
 const map:Record<Topic,RegExp>={ai:/\bai\b|agent|claude|gemini|gpt|大模型|人工智能|智能体|deepseek|glm/i,automation:/automat|工作流|自动化|powershell|脚本/i,network:/network|网络|交换机|路由|tcp|dns|vpn|防火墙|负载均衡|nginx/i,linux:/linux|ubuntu|debian|docker|容器/i,it:/windows|microsoft|office|运维|排障|it\b|打印机|服务器/i,code:/\bcode\b|coding|python|编程|开发|工程师|github|javascript/i,making:/diy|维修|制作|建造|手工|修复|组装/i,cooking:/cook|烹饪|厨房|美食|做饭|料理|咖啡/i,science:/science|科学|科普|医学|物理|化学|生物|地理/i,humanities:/history|历史|人文|哲学|文化|纪实|移民/i,english:/english|英语|语言学习/i,tools:/tool|软件|工具|效率|数码|app\b|桌面/i};
 const hits=(Object.entries(map) as [Topic,RegExp][]).filter(([,r])=>r.test(text)).map(([t])=>t);
 return [...new Set([...hits,...fallback])].slice(0,5);
}
function safeReference(input:string):string|undefined{
 try{const u=validatePublicUrl(input);for(const k of [...u.searchParams.keys()])if(/^utm_|^spm/.test(k))u.searchParams.delete(k);return u.toString();}catch{return;}
}
function textValue(value:any):string{
 if(typeof value==='string'||typeof value==='number')return String(value);
 if(Array.isArray(value))return value.map(textValue).join(' ');
 if(value&&typeof value==='object')return value['#text']!==undefined?textValue(value['#text']):Object.entries(value).filter(([key])=>!key.startsWith('@_')).map(([,part])=>textValue(part)).join(' ');
 return '';
}
const UNKNOWN_DATE='1970-01-01T00:00:00.000Z';
function date(input:unknown):string{const d=new Date(typeof input==='number'?input:String(input||''));return Number.isFinite(d.getTime())?d.toISOString():UNKNOWN_DATE;}
function feedDate(entry:any):{publishedAt:string;dateSource:ContentItem['dateSource']}{for(const [field,dateSource] of [['pubDate','published'],['published','published'],['dc:date','dc-date'],['updated','updated']] as const){const value=date(textValue(entry[field]));if(value!==UNKNOWN_DATE)return {publishedAt:value,dateSource};}return {publishedAt:UNKNOWN_DATE,dateSource:'missing'};}
export interface RssPage {items:ContentItem[];totalEntries:number;nextOffset:number;remaining:number;skippedEntries:number;headKey:string;lastKey:string;}
function entryLocator(entry:any):string{const links=array<any>(entry.link);const linked=links.find(link=>typeof link==='object'&&link['@_href']&&(!link['@_rel']||link['@_rel']==='alternate'));return String(linked?.['@_href']||textValue(links.find(link=>typeof link==='string'))||textValue(entry.guid));}
const RSS_PAGE_SIZE=5;
const MAX_RSS_ENTRIES=10000;
async function rssReference(raw:string,source:Source):Promise<string|undefined>{
 if(!raw.trim())return;
 let input:URL;try{input=new URL(raw,source.locator);}catch{return;}
 if(input.protocol!=='http:')return safeReference(input.toString());
 // Only upgrade a publisher's own same-host permalink, and verify HTTPS first.
 // Never make an HTTP request or weaken DNS, credential, port or redirect checks.
 if(input.hostname!==new URL(source.locator).hostname||input.username||input.password||(input.port&&input.port!=='80'))return;
 input.protocol='https:';input.port='';const candidate=safeReference(input.toString());if(!candidate)return;
 try{const checked=await fetchSafe(candidate,{method:'HEAD',sameOriginRedirects:true,maxRedirects:1,timeout:2000});const final=new URL(checked.url);return final.pathname===input.pathname?candidate:undefined;}catch{return;}
}
function imgFromHtml(html:string):string|undefined{const u=html.match(/<img\b[^>]*\bsrc=["']([^"']+)["']/i)?.[1];return u?safeReference(u):undefined;}
export async function parseRssFeed(xml:string,source:Source):Promise<ContentItem[]>{return (await parseRssPage(xml,source,{limit:MAX_RSS_ENTRIES})).items;}
export async function parseRssPage(xml:string,source:Source,options:{offset?:number;limit?:number;after?:{head:string;last:string}}={}):Promise<RssPage>{
 if(new TextEncoder().encode(xml).byteLength>4_000_000)throw new Error('来源内容过大，暂不导入。');
 if(/<!DOCTYPE|<!ENTITY/i.test(xml))throw new Error('RSS 包含不支持的实体声明。');
 if(XMLValidator.validate(xml)!==true)throw new Error('RSS XML 格式无效。');
 const parser=new XMLParser({ignoreAttributes:false,processEntities:true,trimValues:true,parseTagValue:false});
 const feed=parser.parse(xml);const channel=feed?.rss?.channel;const entries=array<any>(channel?.item??feed?.feed?.entry??feed?.['rdf:RDF']?.item);
 if(entries.length>MAX_RSS_ENTRIES)throw new Error('来源条目过多，请使用较小的 feed 或分页端点。');
 if(!entries.length)throw new Error('RSS 没有可读取的文章条目。');
 const out:ContentItem[]=[];const seen=new Set<string>();
 let offset=Math.min(entries.length,Math.max(0,Math.floor(options.offset||0)));
 if(options.after?.head&&options.after.last&&entryLocator(entries[0])===options.after.head){const last=entries.findIndex(entry=>entryLocator(entry)===options.after!.last);if(last>=0)offset=last+1;}
 const limit=Math.max(1,Math.min(MAX_RSS_ENTRIES,Math.floor(options.limit||RSS_PAGE_SIZE)));const nextOffset=Math.min(entries.length,offset+limit);let skippedEntries=0;const retrievedAt=new Date().toISOString();
 for(const entry of entries.slice(offset,nextOffset)){
  const rawUrl=entryLocator(entry);
  const url=await rssReference(rawUrl,source);if(!url){skippedEntries++;continue;}
  const id=await idFromUrl(url,'rss');
  const html=textValue(entry['content:encoded']??entry.content??entry.description??entry.summary);
  const title=trim(plainText(textValue(entry.title)),1000)||trim(plainText(html),100)||'未命名文章';
  const body=plainTextBlocks(html);const hasContent=entry['content:encoded']!==undefined||entry.content!==undefined;
  const summary=plainText(textValue(entry.description??entry.summary))||trim(plainText(html),280);
  const categories=array<any>(entry.category).map(category=>category?.['@_term']||textValue(category)).join(' ');
  const item:ContentItem={id,kind:'article',platform:'RSS',sourceId:source.id,sourceName:source.name,title,url,summary:trim(summary,450),body:body.slice(0,100000),contentCoverage:body?(hasContent?'unknown':'excerpt'):'metadata',retrievalMethod:hasContent?'rss-content':'rss-summary',truncated:body.length>100000,originalLength:body.length,retrievedAt,image:imgFromHtml(html),...feedDate(entry),topics:inferTopics(title+' '+summary+' '+categories,source.topics)};
  if(!seen.has(url)){out.push(item);seen.add(url);}
  if(source.id!=='rss-juya'&&new URL(source.locator).hostname!=='daily.juya.uk')continue;
  const headings=[...html.matchAll(/<h3\b([^>]*)>([\s\S]*?)<\/h3>/gi)];
  for(let i=0;i<headings.length;i++){
   const h=headings[i];const href=h[2].match(/<a\b[^>]*href=["']([^"']+)["']/i)?.[1];
   if(!href)continue; // Overview category headings have no primary link.
   const end=headings[i+1]?.index??html.length;
   const segment=html.slice((h.index||0)+h[0].length,end).split(/<h2\b/i)[0];
   const headline=plainText(h[2]).replace(/\s*#\d+\s*$/,'').trim();
   const storyUrl=safeReference(href.replace(/&amp;/g,'&'))||url+'#'+(h[1].match(/\bid=["']([^"']+)/i)?.[1]||'story-'+i);
   const storyText=plainTextBlocks(segment);if(!headline||storyText.length<20||seen.has(storyUrl))continue;
   const quote=segment.match(/<blockquote\b[^>]*>([\s\S]*?)<\/blockquote>/i)?.[1];
   const storyBody=`来源：${source.name}，${url}。以下是该来源对事件的整理，不代表已独立核验原始报道。\n\n${storyText}`;
   const story:ContentItem={id:await idFromUrl(storyUrl,'news'),kind:'news',platform:'RSS',sourceId:source.id,sourceName:source.name,title:headline,url:storyUrl,parentId:id,summary:trim(plainText(quote||segment),450),body:storyBody.slice(0,60000),image:imgFromHtml(segment),publishedAt:item.publishedAt,dateSource:item.dateSource,contentCoverage:'excerpt',retrievalMethod:'rss-summary',truncated:storyBody.length>60000,originalLength:storyBody.length,retrievedAt,topics:inferTopics(headline+' '+storyText.slice(0,500),source.topics)};
   out.push(story);seen.add(storyUrl);
  }
 }
 return {items:out,totalEntries:entries.length,nextOffset,remaining:entries.length-nextOffset,skippedEntries,headKey:entryLocator(entries[0]),lastKey:entryLocator(entries[nextOffset-1])};
}
interface AdapterBatch {items:ContentItem[];pending:number;checkpointKey?:string;checkpoint?:string;patch?:Record<string,unknown>;}
async function adapterCursor(env:Env,key:string,source:Source):Promise<any>{try{const value=JSON.parse(await getState(env,key)||'null');if(value?.locator===source.locator)return value;}catch{}return {};}
async function youtube(source:Source,env:Env):Promise<AdapterBatch>{
 const key=await getSecret(env,'youtube');if(!key)throw new Error('请先在设置中配置 YouTube Data API Key。');
 const headers={'X-Goog-Api-Key':key};const cacheKey='yt-channel:'+source.locator;
 let channel:any;const stored=await getState(env,cacheKey);if(stored){try{channel=JSON.parse(stored);}catch{}}
 if(!channel){
  const q=new URLSearchParams({part:'snippet,contentDetails',...(/^UC[A-Za-z0-9_-]{22}$/.test(source.locator)?{id:source.locator}:{forHandle:source.locator})});
  const r=await fetchSafe('https://www.googleapis.com/youtube/v3/channels?'+q,{headers});
  channel=JSON.parse(r.text).items?.[0];if(!channel)throw new Error('未找到这个 YouTube 频道。');
  await setState(env,cacheKey,JSON.stringify(channel));
 }
 const uploads=channel.contentDetails?.relatedPlaylists?.uploads;if(!uploads)throw new Error('频道暂时没有可读取的上传列表。');
 const checkpointKey='youtube-upload-cursor:'+source.id;const cursor=await adapterCursor(env,checkpointKey,source);
 const q=new URLSearchParams({part:'snippet,contentDetails',playlistId:uploads,maxResults:'5',...(cursor.pageToken?{pageToken:cursor.pageToken}:{})});
 const r=await fetchSafe('https://www.googleapis.com/youtube/v3/playlistItems?'+q,{headers});
 const payload=JSON.parse(r.text);const records=Array.isArray(payload.items)?payload.items:[];
 const stop=cursor.watermark?records.findIndex((x:any)=>x.contentDetails?.videoId===cursor.watermark):-1;const selected=stop<0?records:records.slice(0,stop);const ids=selected.map((x:any)=>x.contentDetails?.videoId).filter(Boolean);
 const newest=cursor.pendingHead||records[0]?.contentDetails?.videoId||cursor.watermark;const nextToken=stop<0?payload.nextPageToken:undefined;
 let details:any[]=[];
 if(ids.length){const q2=new URLSearchParams({part:'snippet,contentDetails,status',id:ids.join(',')});const v=await fetchSafe('https://www.googleapis.com/youtube/v3/videos?'+q2,{headers});details=JSON.parse(v.text).items||[];}
 const items:ContentItem[]=details.map((v:any)=>({id:'youtube-'+v.id,kind:'video',platform:'YouTube',sourceId:source.id,sourceName:source.name,title:v.snippet.title,url:'https://www.youtube.com/watch?v='+v.id,summary:trim(v.snippet.description||'',450),image:v.snippet.thumbnails?.high?.url||v.snippet.thumbnails?.medium?.url,publishedAt:date(v.snippet.publishedAt),dateSource:v.snippet.publishedAt?'published':'missing',contentCoverage:'metadata',retrievalMethod:'platform-metadata',retrievedAt:new Date().toISOString(),duration:isoDuration(v.contentDetails?.duration),topics:inferTopics(v.snippet.title+' '+(v.snippet.description||'').slice(0,500),source.topics),externalId:v.id}));
 return {items,pending:nextToken?1:0,checkpointKey,checkpoint:JSON.stringify({locator:source.locator,...(nextToken?{pageToken:nextToken,watermark:cursor.watermark,pendingHead:newest}:{watermark:newest})})};
}
export function isoDuration(value:string=''):number{const m=value.match(/P(?:(\d+)D)?T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);return m?(Number(m[1]||0)*86400+Number(m[2]||0)*3600+Number(m[3]||0)*60+Number(m[4]||0)):0;}
async function bilibili(source:Source,env:Env):Promise<AdapterBatch>{
 const checkpointKey='bilibili-upload-cursor:'+source.id;const cursor=await adapterCursor(env,checkpointKey,source);const page=Math.max(1,Number(cursor.page)||1);
 const r=await fetchSafe(`https://api.bilibili.com/x/space/arc/search?mid=${encodeURIComponent(source.locator)}&ps=5&pn=${page}`,{headers:{Referer:'https://www.bilibili.com/'}});
 const data=JSON.parse(r.text);if(data.code!==0)throw new Error(data.code===-352||data.code===-412?'B站要求验证，稍后重试或手动添加视频链接。':'B站暂时无法读取该来源。');
 const records=Array.isArray(data.data?.list?.vlist)?data.data.list.vlist:[];const stop=cursor.watermark?records.findIndex((v:any)=>v.bvid===cursor.watermark):-1;const newest=cursor.pendingHead||records[0]?.bvid||cursor.watermark;const total=Number(data.data?.page?.count);const more=stop<0&&records.length>0&&(Number.isFinite(total)?page*5<total:records.length===5);
 const items:ContentItem[]=(stop<0?records:records.slice(0,stop)).map((v:any)=>{const parts=String(v.length||'0:0').split(':').map(Number);const duration=parts.reduce((a:number,n:number)=>a*60+n,0);return {id:'bilibili-'+v.bvid,kind:'video' as const,platform:'哔哩哔哩',sourceId:source.id,sourceName:source.name,title:plainText(v.title),url:'https://www.bilibili.com/video/'+v.bvid,summary:trim(plainText(v.description||''),450),image:String(v.pic||'').replace(/^http:/,'https:'),publishedAt:date(Number(v.created)*1000),dateSource:v.created?'published':'missing',contentCoverage:'metadata',retrievalMethod:'platform-metadata',retrievedAt:new Date().toISOString(),duration,topics:inferTopics(v.title+' '+v.description,source.topics),externalId:v.bvid};});
 return {items,pending:more?1:0,checkpointKey,checkpoint:JSON.stringify({locator:source.locator,...(more?{page:page+1,watermark:cursor.watermark,pendingHead:newest}:{watermark:newest})})};
}
async function github(source:Source,env:Env):Promise<AdapterBatch>{
 const checkpointKey='github-star-cursor-v2:'+source.id;const cursor=await adapterCursor(env,checkpointKey,source);const page=Math.max(1,Number(cursor.page)||1);
 const r=await fetchSafe(`https://api.github.com/users/${encodeURIComponent(source.locator)}/starred?per_page=5&page=${page}`,{headers:{Accept:'application/vnd.github.star+json','X-GitHub-Api-Version':'2022-11-28'}});
 const entries=JSON.parse(r.text);if(!Array.isArray(entries))throw new Error('GitHub 返回了无效项目列表。');
 const items:ContentItem[]=entries.map((entry:any)=>{const v=entry.repo||entry;return {id:'github-'+v.id,kind:'project',platform:'GitHub',sourceId:source.id,sourceName:source.name,title:v.full_name,url:v.html_url,summary:trim(v.description||'该项目暂无简介。',450),publishedAt:date(entry.starred_at||v.updated_at),dateSource:entry.starred_at?'published':'updated',contentCoverage:'metadata',retrievalMethod:'platform-metadata',retrievedAt:new Date().toISOString(),topics:inferTopics([v.description,...(v.topics||[])].join(' '),['tools']),externalId:String(v.id)};});
 return {items,pending:entries.length===5?1:0,checkpointKey,checkpoint:JSON.stringify({locator:source.locator,page:entries.length===5?page+1:1})};
}
interface RssCursor {locator:string;signature:string;offset:number;headKey?:string;lastKey?:string;}
async function readRssBatch(source:Source,env:Env):Promise<{items:ContentItem[];pending:number;patch:Record<string,unknown>;checkpoint:string}>{
 let cursor:RssCursor|undefined;try{const stored=JSON.parse(await getState(env,'rss-cursor:'+source.id)||'null');if(stored?.locator===source.locator&&Number.isInteger(stored.offset)&&stored.offset>0)cursor=stored;}catch{}
 const headers:Record<string,string>={};if(!cursor){if(source.etag)headers['If-None-Match']=source.etag;if(source.lastModified)headers['If-Modified-Since']=source.lastModified;}
 const result=await fetchSafe(source.locator,{headers,maxBytes:4_000_000,allowNotModified:true});
 if(result.response.status===304){if(!Object.keys(headers).length)throw new Error('来源未提供内容且没有可验证的缓存。');return {items:[],pending:0,patch:{pendingEntries:0},checkpoint:''};}
 const signature=await idFromUrl(result.text,'feed');const offset=cursor?.signature===signature?cursor.offset:0;
 const page=await parseRssPage(result.text,source,{offset,limit:RSS_PAGE_SIZE,...(cursor?.headKey&&cursor.lastKey?{after:{head:cursor.headKey,last:cursor.lastKey}}:{})});
 if(!page.items.length&&!page.remaining&&page.skippedEntries===page.totalEntries)throw new Error('RSS 条目没有可用的安全链接。');
 return {items:page.items,pending:page.remaining,patch:{pendingEntries:page.remaining,skippedEntries:page.skippedEntries,lastWarning:page.skippedEntries?'部分条目没有可用的安全链接，已跳过。':null,etag:result.response.headers.get('etag')||null,lastModified:result.response.headers.get('last-modified')||null},checkpoint:page.remaining?JSON.stringify({locator:source.locator,signature,offset:page.nextOffset,headKey:page.headKey,lastKey:page.lastKey}):''};
}
/** Checkpoints follow the same ownership/locator guard as source status updates. */
async function setSourceState(env:Env,source:Source,key:string,value:string):Promise<void>{
 await env.DB.prepare("INSERT INTO meta (key,value) SELECT ?,? WHERE EXISTS (SELECT 1 FROM sources WHERE id=? AND json_extract(json,'$.locator')=? AND json_extract(json,'$.platform')=? AND json_extract(json,'$.enabled')=1 AND COALESCE(json_extract(json,'$.blocked'),0)=0) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(key,value,source.id,source.locator,source.platform).run();
}
interface BufferManifest {locator:string;index:number;chunks:number;count:number;resumeSource:boolean;}
const BUFFER_PREFIX='ingest-buffer-v1:';
/** A newsletter issue may expand into many stories. Persist them before advancing
 * the feed cursor so one invocation never has to upsert an unbounded issue. */
async function bufferedBatch(env:Env,source:Source):Promise<{items:ContentItem[];pending:number;commit:()=>Promise<void>}|undefined>{
 const key=BUFFER_PREFIX+source.id;let manifest:BufferManifest;try{manifest=JSON.parse(await getState(env,key)||'null');}catch{return;}
 if(!manifest||manifest.locator!==source.locator||!Number.isInteger(manifest.chunks)||manifest.chunks<1||manifest.chunks>16||!Number.isInteger(manifest.index)||manifest.index<0)return;
 let index=manifest.index;let records:ContentItem[]=[];
 for(;index<manifest.chunks;index++){try{const value=JSON.parse(await getState(env,key+':'+index)||'[]');if(Array.isArray(value)&&value.length){records=value;break;}}catch{throw new Error('更新检查点损坏，请联系实例管理员。');}}
 const items=records.slice(0,5);const rest=records.slice(5);const remaining=index>=manifest.chunks?0:Math.max(0,manifest.count-items.length);const pending=remaining+(manifest.resumeSource?1:0);
 return {items,pending,commit:async()=>{
  if(index<manifest.chunks)await setSourceState(env,source,key+':'+index,rest.length?JSON.stringify(rest):'');
  if(!remaining)await env.DB.prepare('DELETE FROM meta WHERE substr(key,1,?)=?').bind((key+':').length,key+':').run();
  await setSourceState(env,source,key,remaining?JSON.stringify({...manifest,index:rest.length?index:index+1,count:remaining}):'');
 }};
}
async function stageBuffer(env:Env,source:Source,items:ContentItem[],resumeSource:boolean):Promise<void>{
 const key=BUFFER_PREFIX+source.id;const chunks:ContentItem[][]=[];let current:ContentItem[]=[];let bytes=2;
 for(const item of items){const size=new TextEncoder().encode(JSON.stringify(item)).byteLength+1;if(size>750000)throw new Error('单条来源内容过大，无法建立更新检查点。');if(bytes+size>750000&&current.length){chunks.push(current);current=[];bytes=2;}current.push(item);bytes+=size;}
 if(current.length)chunks.push(current);if(chunks.length>16)throw new Error('来源拆分内容过多，请使用更小的订阅源。');
 await env.DB.prepare('DELETE FROM meta WHERE substr(key,1,?)=?').bind((key+':').length,key+':').run();
 for(let i=0;i<chunks.length;i++)await setSourceState(env,source,key+':'+i,JSON.stringify(chunks[i]));
 // Publish the manifest last: an interrupted stage replays the old feed page.
 await setSourceState(env,source,key,JSON.stringify({locator:source.locator,index:0,chunks:chunks.length,count:items.length,resumeSource}));
}
/** Retry-After takes precedence, and manual refresh never bypasses an upstream pause. */
export function retryDelay(error:unknown,failures:number,now=Date.now(),random=Math.random):number{
 let retry=0;if(error instanceof SourceHttpError&&error.retryAfter){const seconds=Number(error.retryAfter);retry=Number.isFinite(seconds)?Math.max(0,seconds*1000):Math.max(0,Date.parse(error.retryAfter)-now)||0;}
 const exponential=Math.min(6*3600_000,60000*2**Math.min(8,Math.max(0,failures-1)))*(1+random()*0.2);
 return Math.max(retry,exponential);
}
/** Updating an in-flight request must not undo current owner controls or recreate a
 * deleted source. Only operational metadata changes, on the same active locator. */
async function sourceStatus(env:Env,source:Source,patch:Record<string,unknown>):Promise<boolean>{
 const result=await env.DB.prepare("UPDATE sources SET json=json_patch(json,?) WHERE id=? AND json_extract(json,'$.locator')=? AND json_extract(json,'$.platform')=? AND json_extract(json,'$.enabled')=1 AND COALESCE(json_extract(json,'$.blocked'),0)=0").bind(JSON.stringify(patch),source.id,source.locator,source.platform).run();
 return result.meta.changes===1;
}
export async function syncSources(env:Env,opts:{force?:boolean;limit?:number}={}):Promise<{processed:number;pending:number;results:{id:string;name:string;ok:boolean;count:number;error?:string}[];lastUpdated:string}>{
 const all=await listSources(env);const now=Date.now();
 const eligible=all.filter((s:any)=>s.enabled&&!s.blocked&&['rss','github','youtube','bilibili'].includes(s.platform)&&(!s.nextRetryAt||Date.parse(s.nextRetryAt)<=now));
 const byId=new Map(eligible.map(s=>[s.id,s]));
 let queue:string[]=[];try{queue=JSON.parse(await getState(env,'sync-queue')||'[]').filter((id:string)=>byId.has(id));}catch{}
 const lastSuccess=await getState(env,'last-sync')||'';
 const locked=await env.DB.prepare("INSERT INTO meta(key,value) VALUES ('sync-lock',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value WHERE CAST(meta.value AS INTEGER) < ?").bind(String(now+60000),now).run();
 if(!locked.meta.changes)return {processed:0,pending:queue.length,results:[],lastUpdated:lastSuccess};
 try{
  if(!queue.length){
   const lastRound=Number(await getState(env,'sync-round-started')||'0');
   if(now-lastRound<300000)return {processed:0,pending:0,results:[],lastUpdated:lastSuccess};
   const due=eligible.filter(s=>opts.force||s.pendingEntries||!s.lastSuccess||now-Date.parse(s.lastSuccess)>6*3600_000);
   due.sort((a:any,b:any)=>Number(a.lastAttempt||0)-Number(b.lastAttempt||0));
   queue=due.map(s=>s.id);await setState(env,'sync-round-started',String(now));
  }
  // One source per invocation preserves Free D1 query headroom, including provenance writes.
  const selected=queue.slice(0,1);
  const remaining=queue.slice(selected.length);const results=[];
  for(const id of selected){
   const source=byId.get(id)!;const lastAttempt=Date.now();
   try{
    let items:ContentItem[]=[];let rssBatch:Awaited<ReturnType<typeof readRssBatch>>|undefined;let adapterBatch:AdapterBatch|undefined;
    const buffered=await bufferedBatch(env,source);
    if(buffered)items=buffered.items;
    if(!buffered&&source.platform==='rss'){rssBatch=await readRssBatch(source,env);items=rssBatch.items;}
    if(!buffered&&source.platform==='youtube')adapterBatch=await youtube(source,env);
    if(!buffered&&source.platform==='bilibili')adapterBatch=await bilibili(source,env);
    if(!buffered&&source.platform==='github')adapterBatch=await github(source,env);
    if(adapterBatch)items=adapterBatch.items;
    // Re-check after network I/O. Edited, paused, blocked or deleted sources
    // do not add the stale response to the cache. A deletion immediately after
    // this check may retain in-flight cache items, but can never restore a source.
    if(!await sourceStatus(env,source,{lastAttempt,pendingEntries:1,status:'updating'})){results.push({id:source.id,name:source.name,ok:true,count:0});continue;}
    const spill=items.slice(5);items=items.slice(0,5);
    await upsertContent(env,items);
    if(buffered)await buffered.commit();
    if(spill.length)await stageBuffer(env,source,spill,!!rssBatch?.pending);
    if(rssBatch)await setSourceState(env,source,'rss-cursor:'+source.id,rssBatch.checkpoint);
    if(adapterBatch?.checkpointKey)await setSourceState(env,source,adapterBatch.checkpointKey,adapterBatch.checkpoint||'');
    const pending=buffered?.pending||spill.length+(rssBatch?.pending||adapterBatch?.pending||0);if(pending)remaining.push(source.id);
    await sourceStatus(env,source,{lastAttempt,status:pending?'updating':'ok',...(!pending?{lastSuccess:new Date().toISOString()}:{}),failureCount:0,nextRetryAt:null,error:null,...rssBatch?.patch,pendingEntries:pending});
    results.push({id:source.id,name:source.name,ok:true,count:items.length});
   }catch(e){const error=e instanceof Error?e.message:'内容来源暂时无法更新。';const failureCount=(source.failureCount||0)+1;await sourceStatus(env,source,{lastAttempt,status:'error',error,failureCount,nextRetryAt:new Date(Date.now()+retryDelay(e,failureCount)).toISOString()});results.push({id:source.id,name:source.name,ok:false,count:0,error});}
  }
  await setState(env,'sync-queue',JSON.stringify(remaining));
  if(results.some(r=>r.ok)&&!remaining.length)await setState(env,'last-sync',new Date().toISOString());
  return {processed:selected.length,pending:remaining.length,results,lastUpdated:await getState(env,'last-sync')||''};
 }finally{await setState(env,'sync-lock','0');}
}

function meta(html:string,name:string):string|undefined{
 const tags=html.match(/<meta\b[^>]*>/gi)||[];for(const tag of tags){const attrs:Record<string,string>={};for(const m of tag.matchAll(/([\w:-]+)\s*=\s*["']([^"']*)["']/g))attrs[m[1].toLowerCase()]=m[2];if((attrs.property||attrs.name)?.toLowerCase()===name.toLowerCase())return plainText(attrs.content||'');}return;
}
export async function importUrl(input:string,env:Env):Promise<ContentItem>{
 const normalized=canonicalUrl(input);const u=await resolveContentUrl(normalized);const h=u.hostname;
 const now=new Date().toISOString();const base:ContentItem={id:await idFromUrl(normalized),kind:'article',platform:'网页',sourceId:'manual',sourceName:'手动收藏',title:'已保存的内容',url:normalized,summary:'已保存原始链接，内容暂未读取。',publishedAt:now,dateSource:'imported',contentCoverage:'metadata',retrievalMethod:'manual-link',retrievedAt:now,topics:['tools']};
 const ytId=h.endsWith('youtube.com')?(u.searchParams.get('v')||u.pathname.match(/\/(?:shorts|embed)\/([\w-]+)/)?.[1]):undefined;
 const biliId=h.endsWith('bilibili.com')?u.pathname.match(/\/video\/(BV[\w]+)/i)?.[1]:undefined;
 if(ytId){if(!/^[\w-]{11}$/.test(ytId))throw new Error('YouTube 视频 ID 格式不正确。');base.id='youtube-'+ytId;base.kind='video';base.platform='YouTube';base.title='YouTube 视频 '+ytId;base.externalId=ytId;}
 if(biliId){base.id='bilibili-'+biliId;base.kind='video';base.platform='哔哩哔哩';base.title='B站视频 '+biliId;base.externalId=biliId;}
 if(h==='github.com'){
  const parts=u.pathname.split('/').filter(Boolean);if(parts.length<2)throw new Error('请提供具体 GitHub 项目链接。');
  const r=await fetchSafe('https://api.github.com/repos/'+encodeURIComponent(parts[0])+'/'+encodeURIComponent(parts[1]));const repo=JSON.parse(r.text);
  return {...base,id:'github-'+repo.id,kind:'project',platform:'GitHub',sourceId:'github-stars',sourceName:'GitHub',title:repo.full_name,url:repo.html_url,summary:repo.description||'该项目暂无简介。',publishedAt:date(repo.updated_at),dateSource:'updated',contentCoverage:'metadata',retrievalMethod:'platform-metadata',topics:inferTopics([repo.description,...(repo.topics||[])].join(' '),['tools']),externalId:String(repo.id)};
 }
 if(h==='x.com'||h.endsWith('.x.com')||h==='twitter.com'){
  if(!/^\/[^/]+\/status\/\d+/.test(u.pathname))throw new Error('请提供某一条 X 帖子的链接。');
  const m=u.pathname.match(/^\/([^/]+)\/status\/(\d+)/)!;base.id='x-'+m[2];base.kind='post';base.platform='X';base.title='@'+m[1]+' 的帖子';base.sourceName='@'+m[1];base.sourceId='manual-x-'+m[1];base.externalId=m[2];base.topics=['ai'];
 }
 // Link saving remains useful when a platform requires login or disallows embeds.
 try{
  if(ytId){
   const key=await getSecret(env,'youtube');if(key){const q=new URLSearchParams({part:'snippet,contentDetails',id:ytId});const r=await fetchSafe('https://www.googleapis.com/youtube/v3/videos?'+q,{headers:{'X-Goog-Api-Key':key}});const video=JSON.parse(r.text).items?.[0];if(video){base.title=video.snippet.title;base.summary=trim(video.snippet.description||'',450);base.image=video.snippet.thumbnails?.high?.url;base.duration=isoDuration(video.contentDetails?.duration);base.publishedAt=date(video.snippet.publishedAt);base.dateSource='published';base.retrievalMethod='platform-metadata';base.sourceName=video.snippet.channelTitle;base.topics=inferTopics(base.title+' '+base.summary,['tools']);return base;}}
   return base;
  }
  if(biliId){const r=await fetchSafe('https://api.bilibili.com/x/web-interface/view?bvid='+biliId,{headers:{Referer:'https://www.bilibili.com/'}});const v=JSON.parse(r.text);if(v.code===0){base.title=v.data.title;base.summary=trim(plainText(v.data.desc||''),450);base.image=v.data.pic;base.duration=v.data.duration;base.sourceName=v.data.owner?.name||base.sourceName;base.publishedAt=date(v.data.pubdate*1000);base.dateSource='published';base.retrievalMethod='platform-metadata';base.topics=inferTopics(base.title+' '+base.summary,['tools']);}return base;}
  const r=await fetchSafe(normalized);const html=r.text;
  base.title=meta(html,'og:title')||plainText(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]||base.title);
  base.summary=trim(meta(html,'og:description')||meta(html,'description')||base.summary,450);
  base.image=meta(html,'og:image');if(base.image&&!base.image.startsWith('https://'))base.image=undefined;
  if(base.kind!=='post'){const article=html.match(/<article\b[^>]*>([\s\S]*?)<\/article>/i)?.[1]||html.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i)?.[1];if(article){const body=plainTextBlocks(article);base.body=body.slice(0,60000);base.contentCoverage='unknown';base.retrievalMethod='html-extraction';base.truncated=body.length>60000;base.originalLength=body.length;}}
  base.topics=inferTopics(base.title+' '+base.summary,base.topics);return base;
 }catch(error){if(error instanceof Error&&/^(不支持|仅支持|此链接|请输入|暂时无法验证|内容请求|带凭据)/.test(error.message))throw error;return base;}
}
