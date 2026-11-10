import type {ContentItem,Feedback,Kind,Mode,Source} from '../shared/types';
import type {UserProfile} from '../shared/profile';
import type {Env} from './db';
import {groupNews} from './dedup';
import {feedPage,rankFeed} from './ranking';
import {HttpError} from './security';

export interface FeedBatchOptions {mode:Mode;type:Kind|'all';filter:'all';q:string;cursor:number;excludeIds:string[];seed:string;asOf:string;}
const TYPES=new Set(['all','video','article','news','post','project']);
const UUID=/^[a-f\d]{8}-[a-f\d]{4}-[1-8][a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i;

export async function readFeedBatchRequest(request:Request):Promise<Record<string,unknown>> {
  // 200 IDs of 200 characters fit this limit; the ordinary 32KB API reader does not.
  const limit=65536;if(Number(request.headers.get('content-length')||0)>limit)throw new HttpError(413,'换批请求内容过大。');
  const reader=request.body?.getReader();if(!reader)throw new HttpError(400,'请提供换批参数。');let bytes=0,text='';const decoder=new TextDecoder();
  try{while(true){const chunk=await reader.read();if(chunk.done)break;bytes+=chunk.value.byteLength;if(bytes>limit){await reader.cancel();throw new HttpError(413,'换批请求内容过大。');}text+=decoder.decode(chunk.value,{stream:true});}text+=decoder.decode();}finally{reader.releaseLock();}
  try{const body=JSON.parse(text);if(!body||typeof body!=='object'||Array.isArray(body))throw new Error();return body;}catch{throw new HttpError(400,'换批参数不是有效的 JSON 对象。');}
}

export function validateFeedBatchInput(body:Record<string,unknown>,now=Date.now()):FeedBatchOptions {
  const mode=body.mode??'rest',type=body.type??'all',filter=body.filter??'all',q=body.q??'',cursor=body.cursor??0,excludeIds=body.excludeIds??[];
  if((mode!=='rest'&&mode!=='grow')||typeof type!=='string'||!TYPES.has(type)||filter!=='all')throw new HttpError(400,'换批内容筛选条件无效。');
  if(typeof q!=='string'||q.length>200)throw new HttpError(400,'搜索内容最多 200 个字符。');
  if(!Number.isInteger(cursor)||typeof cursor!=='number'||cursor<0||cursor>1000)throw new HttpError(400,'换批分页位置无效。');
  if(typeof body.seed!=='string'||!UUID.test(body.seed))throw new HttpError(400,'换批标识无效，请重新点击换一批。');
  if(!Array.isArray(excludeIds)||excludeIds.length>200||excludeIds.some(id=>typeof id!=='string'||id.length<1||id.length>200||/[\u0000-\u001f\u007f]/.test(id)))throw new HttpError(400,'每次最多排除 200 条内容，内容标识最多 200 个字符。');
  if(body.asOf!==undefined&&(typeof body.asOf!=='string'||!/^\d{4}-\d{2}-\d{2}T/.test(body.asOf)))throw new HttpError(400,'换批时间无效，请重新点击换一批。');
  const timestamp=body.asOf===undefined?now:Date.parse(body.asOf as string);
  if(!Number.isFinite(timestamp)||timestamp<0||timestamp>now+60000||(cursor>0&&body.asOf===undefined))throw new HttpError(400,'换批时间无效，请重新点击换一批。');
  return {mode,type:type as Kind|'all',filter:'all',q,cursor,excludeIds:[...new Set(excludeIds as string[])],seed:body.seed.toLowerCase(),asOf:new Date(timestamp).toISOString()};
}

/** The cutoff keeps a batch from admitting newly synced/backfilled content mid-page. */
export async function cachedBatchContent(env:Env,asOf:string):Promise<ContentItem[]> {
  const rows=await env.DB.prepare('SELECT json FROM content WHERE updated_at<=? ORDER BY updated_at DESC LIMIT 4000').bind(asOf).all<{json:string}>();
  return rows.results.map(row=>JSON.parse(row.json) as ContentItem);
}

function randomFor(seed:string,id:string):number {
  let hash=2166136261;
  for(const char of seed+'\n'+id){hash^=char.codePointAt(0)!;hash=Math.imul(hash,16777619);}
  hash=Math.imul(hash^(hash>>>16),0x85ebca6b);hash=Math.imul(hash^(hash>>>13),0xc2b2ae35);hash^=hash>>>16;
  return ((hash>>>0)+1)/4294967297;
}

/** Weighted sampling without replacement: higher-ranked content has better odds. */
export function weightedFeedOrder(ranked:readonly ContentItem[],seed:string):ContentItem[] {
  return ranked.map((item,index)=>({item,priority:-Math.log(randomFor(seed,item.id))*Math.pow(1+index/20,1.65)})).sort((a,b)=>a.priority-b.priority||a.item.id.localeCompare(b.item.id)).map(entry=>entry.item);
}

function canonicalFeedUrl(value:string):string|undefined {
  try{
    const url=new URL(value);if(!['http:','https:'].includes(url.protocol)||url.username||url.password)return;
    url.hostname=url.hostname.toLowerCase().replace(/^www\./,'').replace(/\.$/,'');url.hash='';
    if(url.hostname==='youtu.be'){const id=url.pathname.slice(1);return id?'https://youtube.com/watch?v='+encodeURIComponent(id):undefined;}
    if(url.hostname==='youtube.com'&&url.pathname==='/watch')return url.searchParams.get('v')?'https://youtube.com/watch?v='+encodeURIComponent(url.searchParams.get('v')!):undefined;
    for(const key of [...url.searchParams.keys()])if(/^utm_|^(?:spm|spm_id_from|fbclid|gclid|ref_src|ref_url|feature|si|vd_source)$/i.test(key))url.searchParams.delete(key);
    url.searchParams.sort();url.pathname=url.pathname.replace(/\/$/,'')||'/';return url.toString();
  }catch{return;}
}

export function rotatedFeedPage(items:ContentItem[],sources:Source[],feedback:Record<string,Feedback>,options:FeedBatchOptions,profile?:UserProfile) {
  const excluded=new Set(options.excludeIds);
  const ranked=rankFeed(items,sources,feedback,options.mode,options.type,'all',options.q,profile,Date.parse(options.asOf));
  const rankedIds=new Set(ranked.map(item=>item.id));
  // An excluded copy of a news event can already be read/hidden. Include it only
  // as deduplication evidence so another publisher's copy cannot immediately recur.
  const excludedNews=items.filter(item=>item.kind==='news'&&excluded.has(item.id)&&!rankedIds.has(item.id));
  const excludedUrls=new Set(items.filter(item=>excluded.has(item.id)).map(item=>canonicalFeedUrl(item.url)).filter((url):url is string=>url!==undefined));
  const seenUrls=new Set<string>();
  const grouped=groupNews([...ranked,...excludedNews],items).filter(item=>{
    const canonical=canonicalFeedUrl(item.url);
    if(excluded.has(item.id)||(canonical&&excludedUrls.has(canonical))||item.relatedSources?.some(source=>{const url=canonicalFeedUrl(source.url);return url!==undefined&&excludedUrls.has(url);}))return false;
    // Keep the first normal-ranked copy before shuffling. Titles never establish
    // identity, so different releases/events sharing a headline remain distinct.
    if(canonical){if(seenUrls.has(canonical))return false;seenUrls.add(canonical);}return true;
  });
  const page=feedPage(weightedFeedOrder(grouped,options.seed),options.cursor);
  return {...page,total:grouped.length,hasMore:page.nextCursor!==null,exhausted:page.items.length===0,seed:options.seed,asOf:options.asOf};
}
