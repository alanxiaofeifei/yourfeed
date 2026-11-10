import { XMLParser } from 'fast-xml-parser';
import type { ContentItem, Source, Topic } from '../shared/types';
import { listSources, upsertContent, getState, setState, getSecret } from './db';
import type { Env } from './db';
import { canonicalUrl, fetchSafe, plainText, validatePublicUrl, resolveContentUrl } from './fetch-safe';

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
function date(input:unknown):string{const d=new Date(String(input||''));return Number.isFinite(d.getTime())?d.toISOString():new Date().toISOString();}
function imgFromHtml(html:string):string|undefined{const u=html.match(/<img\b[^>]*\bsrc=["']([^"']+)["']/i)?.[1];return u?safeReference(u):undefined;}
export async function parseRssFeed(xml:string,source:Source):Promise<ContentItem[]>{
 if(/<!DOCTYPE|<!ENTITY/i.test(xml))throw new Error('RSS 包含不支持的实体声明。');
 const parser=new XMLParser({ignoreAttributes:false,processEntities:true,trimValues:true,parseTagValue:false});
 const feed=parser.parse(xml);const channel=feed?.rss?.channel;const entries=array<any>(channel?.item??feed?.feed?.entry??feed?.['rdf:RDF']?.item);
 if(!entries.length)throw new Error('RSS 没有可读取的文章条目。');
 const out:ContentItem[]=[];const seen=new Set<string>();
 for(const entry of entries.slice(0,10)){
  const links=array<any>(entry.link);const linked=links.find(link=>typeof link==='object'&&link['@_href']&&(!link['@_rel']||link['@_rel']==='alternate'));const rawUrl=linked?.['@_href']||textValue(links.find(link=>typeof link==='string'))||textValue(entry.guid);
  let url:string|undefined;try{url=safeReference(new URL(rawUrl,source.locator).toString());}catch{}if(!url)continue;
  const id=await idFromUrl(url,'rss');
  const html=textValue(entry['content:encoded']??entry.content??entry.description??entry.summary);
  const title=plainText(textValue(entry.title)||'未命名文章');
  const summary=plainText(textValue(entry.description??entry.summary))||trim(plainText(html),280);
  const categories=array<any>(entry.category).map(category=>category?.['@_term']||textValue(category)).join(' ');
  const item:ContentItem={id,kind:'article',platform:'RSS',sourceId:source.id,sourceName:source.name,title,url,summary:trim(summary,450),body:plainText(html).slice(0,100000),image:imgFromHtml(html),publishedAt:date(entry.pubDate??entry.published??entry.updated),topics:inferTopics(title+' '+summary+' '+categories,source.topics)};
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
   const storyText=plainText(segment);if(!headline||storyText.length<20||seen.has(storyUrl))continue;
   const quote=segment.match(/<blockquote\b[^>]*>([\s\S]*?)<\/blockquote>/i)?.[1];
   const story:ContentItem={id:await idFromUrl(storyUrl,'news'),kind:'news',platform:'RSS',sourceId:source.id,sourceName:source.name,title:headline,url:storyUrl,parentId:id,summary:trim(plainText(quote||segment),450),body:`来源：${source.name}，${url}。以下是该来源对事件的整理，不代表已独立核验原始报道。\n\n${storyText}`.slice(0,60000),image:imgFromHtml(segment),publishedAt:item.publishedAt,topics:inferTopics(headline+' '+storyText.slice(0,500),source.topics)};
   out.push(story);seen.add(storyUrl);
  }
 }
 return out;
}
async function youtube(source:Source,env:Env):Promise<ContentItem[]>{
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
 const q=new URLSearchParams({part:'snippet,contentDetails',playlistId:uploads,maxResults:'12'});
 const r=await fetchSafe('https://www.googleapis.com/youtube/v3/playlistItems?'+q,{headers});
 const records=JSON.parse(r.text).items||[];const ids=records.map((x:any)=>x.contentDetails?.videoId).filter(Boolean);
 let details:any[]=[];
 if(ids.length){const q2=new URLSearchParams({part:'snippet,contentDetails,status',id:ids.join(',')});const v=await fetchSafe('https://www.googleapis.com/youtube/v3/videos?'+q2,{headers});details=JSON.parse(v.text).items||[];}
 return details.map((v:any)=>({id:'youtube-'+v.id,kind:'video',platform:'YouTube',sourceId:source.id,sourceName:source.name,title:v.snippet.title,url:'https://www.youtube.com/watch?v='+v.id,summary:trim(v.snippet.description||'',450),image:v.snippet.thumbnails?.high?.url||v.snippet.thumbnails?.medium?.url,publishedAt:date(v.snippet.publishedAt),duration:isoDuration(v.contentDetails?.duration),topics:inferTopics(v.snippet.title+' '+(v.snippet.description||'').slice(0,500),source.topics),externalId:v.id}));
}
export function isoDuration(value:string=''):number{const m=value.match(/P(?:(\d+)D)?T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);return m?(Number(m[1]||0)*86400+Number(m[2]||0)*3600+Number(m[3]||0)*60+Number(m[4]||0)):0;}
async function bilibili(source:Source):Promise<ContentItem[]>{
 const r=await fetchSafe(`https://api.bilibili.com/x/space/arc/search?mid=${encodeURIComponent(source.locator)}&ps=10&pn=1`,{headers:{Referer:'https://www.bilibili.com/'}});
 const data=JSON.parse(r.text);if(data.code!==0)throw new Error(data.code===-352||data.code===-412?'B站要求验证，稍后重试或手动添加视频链接。':'B站暂时无法读取该来源。');
 return (data.data?.list?.vlist||[]).map((v:any)=>{const parts=String(v.length||'0:0').split(':').map(Number);const duration=parts.reduce((a:number,n:number)=>a*60+n,0);return {id:'bilibili-'+v.bvid,kind:'video' as const,platform:'哔哩哔哩',sourceId:source.id,sourceName:source.name,title:plainText(v.title),url:'https://www.bilibili.com/video/'+v.bvid,summary:trim(plainText(v.description||''),450),image:String(v.pic||'').replace(/^http:/,'https:'),publishedAt:new Date(Number(v.created)*1000).toISOString(),duration,topics:inferTopics(v.title+' '+v.description,source.topics),externalId:v.bvid};});
}
async function github(source:Source,env:Env):Promise<ContentItem[]>{
 const page=Math.max(1,Number(await getState(env,'github-star-page:'+source.id)||'1'));
 const r=await fetchSafe(`https://api.github.com/users/${encodeURIComponent(source.locator)}/starred?per_page=100&page=${page}`,{headers:{Accept:'application/vnd.github.star+json','X-GitHub-Api-Version':'2022-11-28'}});
 const entries=JSON.parse(r.text);if(!Array.isArray(entries))throw new Error('GitHub 返回了无效项目列表。');
 await setState(env,'github-star-page:'+source.id,entries.length===100?String(page+1):'1');
 return entries.map((entry:any)=>{const v=entry.repo||entry;return {id:'github-'+v.id,kind:'project',platform:'GitHub',sourceId:source.id,sourceName:source.name,title:v.full_name,url:v.html_url,summary:trim(v.description||'该项目暂无简介。',450),publishedAt:date(entry.starred_at||v.updated_at),topics:inferTopics([v.description,...(v.topics||[])].join(' '),['tools']),externalId:String(v.id)};});
}
/** Updating an in-flight request must not undo current owner controls or recreate a
 * deleted source. Only operational metadata changes, on the same active locator. */
async function sourceStatus(env:Env,source:Source,patch:Record<string,unknown>):Promise<boolean>{
 const result=await env.DB.prepare("UPDATE sources SET json=json_patch(json,?) WHERE id=? AND json_extract(json,'$.locator')=? AND json_extract(json,'$.platform')=? AND json_extract(json,'$.enabled')=1 AND COALESCE(json_extract(json,'$.blocked'),0)=0").bind(JSON.stringify(patch),source.id,source.locator,source.platform).run();
 return result.meta.changes===1;
}
export async function syncSources(env:Env,opts:{force?:boolean;limit?:number}={}):Promise<{processed:number;pending:number;results:{id:string;name:string;ok:boolean;count:number;error?:string}[];lastUpdated:string}>{
 const all=await listSources(env);const now=Date.now();
 const eligible=all.filter((s:any)=>s.enabled&&!s.blocked&&['rss','github','youtube','bilibili'].includes(s.platform));
 const byId=new Map(eligible.map(s=>[s.id,s]));
 let queue:string[]=[];try{queue=JSON.parse(await getState(env,'sync-queue')||'[]').filter((id:string)=>byId.has(id));}catch{}
 const lastSuccess=await getState(env,'last-sync')||'';
 const locked=await env.DB.prepare("INSERT INTO meta(key,value) VALUES ('sync-lock',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value WHERE CAST(meta.value AS INTEGER) < ?").bind(String(now+60000),now).run();
 if(!locked.meta.changes)return {processed:0,pending:queue.length,results:[],lastUpdated:lastSuccess};
 try{
  if(!queue.length){
   const lastRound=Number(await getState(env,'sync-round-started')||'0');
   if(now-lastRound<300000)return {processed:0,pending:0,results:[],lastUpdated:lastSuccess};
   const due=eligible.filter(s=>opts.force||!s.lastSuccess||now-Date.parse(s.lastSuccess)>6*3600_000);
   due.sort((a:any,b:any)=>Number(a.lastAttempt||0)-Number(b.lastAttempt||0));
   queue=due.map(s=>s.id);await setState(env,'sync-round-started',String(now));
  }
  const selected=queue.slice(0,Math.max(1,Math.min(4,opts.limit||3)));
  const remaining=queue.slice(selected.length);const results=[];
  for(const id of selected){
   const source=byId.get(id)!;const lastAttempt=Date.now();
   try{
    let items:ContentItem[]=[];
    if(source.platform==='rss'){const r=await fetchSafe(source.locator);items=await parseRssFeed(r.text,source);}
    if(source.platform==='youtube')items=await youtube(source,env);
    if(source.platform==='bilibili')items=await bilibili(source);
    if(source.platform==='github')items=await github(source,env);
    // Re-check after network I/O. Edited, paused, blocked or deleted sources
    // do not add the stale response to the cache. A deletion immediately after
    // this check may retain in-flight cache items, but can never restore a source.
    if(!await sourceStatus(env,source,{lastAttempt})){results.push({id:source.id,name:source.name,ok:true,count:0});continue;}
    await upsertContent(env,items);
    await sourceStatus(env,source,{lastAttempt,status:'ok',lastSuccess:new Date().toISOString(),error:null});
    results.push({id:source.id,name:source.name,ok:true,count:items.length});
   }catch(e){const error=e instanceof Error?e.message:'内容来源暂时无法更新。';await sourceStatus(env,source,{lastAttempt,status:'error',error});results.push({id:source.id,name:source.name,ok:false,count:0,error});}
  }
  await setState(env,'sync-queue',JSON.stringify(remaining));
  if(results.some(r=>r.ok))await setState(env,'last-sync',new Date().toISOString());
  return {processed:selected.length,pending:remaining.length,results,lastUpdated:await getState(env,'last-sync')||''};
 }finally{await setState(env,'sync-lock','0');}
}

function meta(html:string,name:string):string|undefined{
 const tags=html.match(/<meta\b[^>]*>/gi)||[];for(const tag of tags){const attrs:Record<string,string>={};for(const m of tag.matchAll(/([\w:-]+)\s*=\s*["']([^"']*)["']/g))attrs[m[1].toLowerCase()]=m[2];if((attrs.property||attrs.name)?.toLowerCase()===name.toLowerCase())return plainText(attrs.content||'');}return;
}
export async function importUrl(input:string,env:Env):Promise<ContentItem>{
 const normalized=canonicalUrl(input);const u=await resolveContentUrl(normalized);const h=u.hostname;
 const now=new Date().toISOString();const base:ContentItem={id:await idFromUrl(normalized),kind:'article',platform:'网页',sourceId:'manual',sourceName:'手动收藏',title:'已保存的内容',url:normalized,summary:'已保存原始链接，内容暂未读取。',publishedAt:now,topics:['tools']};
 const ytId=h.endsWith('youtube.com')?(u.searchParams.get('v')||u.pathname.match(/\/(?:shorts|embed)\/([\w-]+)/)?.[1]):undefined;
 const biliId=h.endsWith('bilibili.com')?u.pathname.match(/\/video\/(BV[\w]+)/i)?.[1]:undefined;
 if(ytId){if(!/^[\w-]{11}$/.test(ytId))throw new Error('YouTube 视频 ID 格式不正确。');base.id='youtube-'+ytId;base.kind='video';base.platform='YouTube';base.title='YouTube 视频 '+ytId;base.externalId=ytId;}
 if(biliId){base.id='bilibili-'+biliId;base.kind='video';base.platform='哔哩哔哩';base.title='B站视频 '+biliId;base.externalId=biliId;}
 if(h==='github.com'){
  const parts=u.pathname.split('/').filter(Boolean);if(parts.length<2)throw new Error('请提供具体 GitHub 项目链接。');
  const r=await fetchSafe('https://api.github.com/repos/'+encodeURIComponent(parts[0])+'/'+encodeURIComponent(parts[1]));const repo=JSON.parse(r.text);
  return {...base,id:'github-'+repo.id,kind:'project',platform:'GitHub',sourceId:'github-stars',sourceName:'GitHub',title:repo.full_name,url:repo.html_url,summary:repo.description||'该项目暂无简介。',publishedAt:date(repo.updated_at),topics:inferTopics([repo.description,...(repo.topics||[])].join(' '),['tools']),externalId:String(repo.id)};
 }
 if(h==='x.com'||h.endsWith('.x.com')||h==='twitter.com'){
  if(!/^\/[^/]+\/status\/\d+/.test(u.pathname))throw new Error('请提供某一条 X 帖子的链接。');
  const m=u.pathname.match(/^\/([^/]+)\/status\/(\d+)/)!;base.id='x-'+m[2];base.kind='post';base.platform='X';base.title='@'+m[1]+' 的帖子';base.sourceName='@'+m[1];base.sourceId='manual-x-'+m[1];base.externalId=m[2];base.topics=['ai'];
 }
 // Link saving remains useful when a platform requires login or disallows embeds.
 try{
  if(ytId){
   const key=await getSecret(env,'youtube');if(key){const q=new URLSearchParams({part:'snippet,contentDetails',id:ytId});const r=await fetchSafe('https://www.googleapis.com/youtube/v3/videos?'+q,{headers:{'X-Goog-Api-Key':key}});const video=JSON.parse(r.text).items?.[0];if(video){base.title=video.snippet.title;base.summary=trim(video.snippet.description||'',450);base.image=video.snippet.thumbnails?.high?.url;base.duration=isoDuration(video.contentDetails?.duration);base.publishedAt=date(video.snippet.publishedAt);base.sourceName=video.snippet.channelTitle;base.topics=inferTopics(base.title+' '+base.summary,['tools']);return base;}}
   return base;
  }
  if(biliId){const r=await fetchSafe('https://api.bilibili.com/x/web-interface/view?bvid='+biliId,{headers:{Referer:'https://www.bilibili.com/'}});const v=JSON.parse(r.text);if(v.code===0){base.title=v.data.title;base.summary=trim(plainText(v.data.desc||''),450);base.image=v.data.pic;base.duration=v.data.duration;base.sourceName=v.data.owner?.name||base.sourceName;base.publishedAt=new Date(v.data.pubdate*1000).toISOString();base.topics=inferTopics(base.title+' '+base.summary,['tools']);}return base;}
  const r=await fetchSafe(normalized);const html=r.text;
  base.title=meta(html,'og:title')||plainText(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]||base.title);
  base.summary=trim(meta(html,'og:description')||meta(html,'description')||base.summary,450);
  base.image=meta(html,'og:image');if(base.image&&!base.image.startsWith('https://'))base.image=undefined;
  if(base.kind!=='post'){const article=html.match(/<article\b[^>]*>([\s\S]*?)<\/article>/i)?.[1]||html.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i)?.[1];if(article)base.body=plainText(article).slice(0,60000);}
  base.topics=inferTopics(base.title+' '+base.summary,base.topics);return base;
 }catch(error){if(error instanceof Error&&/^(不支持|仅支持|此链接|请输入|暂时无法验证|内容请求|带凭据)/.test(error.message))throw error;return base;}
}
