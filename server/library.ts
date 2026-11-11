import type {ContentItem,Feedback,Kind} from '../shared/types';
import {type Env,getContentById,listSources} from './db';
import {getProfile} from './profile';
import {HttpError} from './security';
import {honestContent} from '../shared/content-coverage';

export {getContentById};
type Filter='all'|'liked'|'saved'|'read';
export interface LibraryOptions {userId:string;filter?:Filter;q?:string;type?:Kind|'all';cursor?:string;limit?:number;asOf?:string;}
interface Cursor {time:string;id:string;asOf:string;scope:string;}
function encodeCursor(cursor:Cursor):string {return btoa(unescape(encodeURIComponent(JSON.stringify(cursor))));}
function decodeCursor(value:string):Cursor {try{if(value.length>2048)throw new Error();const c=JSON.parse(decodeURIComponent(escape(atob(value)))) as Cursor;if(!c||typeof c.time!=='string'||!Number.isFinite(Date.parse(c.time))||typeof c.asOf!=='string'||!Number.isFinite(Date.parse(c.asOf))||typeof c.id!=='string'||c.id.length>200||typeof c.scope!=='string')throw new Error();return c;}catch{throw new HttpError(400,'内容分页位置无效，请重新打开列表。');}}
function like(value:string):string {return '%'+value.replace(/[\\%_]/g,'\\$&')+'%';}

/** Database pagination has no recommendation candidate window. Old saved IDs
 * and absent search-index rows remain reachable during an interrupted backfill. */
export async function queryLibrary(env:Env,options:LibraryOptions) {
  const filter=options.filter||'all',kind=options.type||'all',q=(options.q||'').trim();
  if(!['all','liked','saved','read'].includes(filter)||!['all','video','article','news','post','project'].includes(kind)||q.length>200)throw new HttpError(400,'内容筛选条件无效。');
  const limit=Math.min(100,Math.max(1,Math.floor(options.limit||20))),scope=JSON.stringify([filter,kind,q]);
  const cursor=options.cursor?decodeCursor(options.cursor):undefined;
  if(cursor&&cursor.scope!==scope)throw new HttpError(400,'筛选条件已改变，请从第一页开始。');
  const asOf=cursor?.asOf||options.asOf||new Date().toISOString();
  if(!Number.isFinite(Date.parse(asOf))||Date.parse(asOf)>Date.now()+60000)throw new HttpError(400,'内容分页时间无效。');
  const clauses=['c.updated_at<=?'];const values:unknown[]=[asOf];
  if(kind!=='all'){clauses.push('c.kind=?');values.push(kind);}
  if(filter!=='all'){clauses.push(`json_extract(f.json,'$.${filter}')=1`);}
  const shortQueryLimited=!!q&&Array.from(q).length<3;
  if(q&&shortQueryLimited){
    // Trigram indexes cannot answer one/two-character searches. Bound the scan
    // explicitly and tell clients to ask for 3+ characters for complete history.
    clauses.push("c.rowid IN (SELECT rowid FROM content WHERE updated_at<=? ORDER BY updated_at DESC,id DESC LIMIT 1000) AND c.json LIKE ? ESCAPE '\\'");values.push(asOf,like(q));
  }else if(q){
    // MATCH literal phrases use the trigram index. LIKE ... ESCAPE disables its
    // optimizer; never concatenate query syntax supplied by the reader.
    const phrase='"'+q.replace(/"/g,'""')+'"';
    clauses.push("(c.rowid IN (SELECT rowid FROM content_search WHERE content_search MATCH ?) OR (NOT EXISTS(SELECT 1 FROM content_search WHERE rowid=c.rowid) AND c.json LIKE ? ESCAPE '\\'))");values.push(phrase,like(q));
  }
  const join=' FROM content c LEFT JOIN feedback f ON f.item_id=c.id AND f.user_id=?';
  const totalRow=await env.DB.prepare('SELECT COUNT(*) count'+join+' WHERE '+clauses.join(' AND ')).bind(options.userId,...values).first<{count:number}>();
  const pageClauses=[...clauses],pageValues=[...values];
  if(cursor){pageClauses.push('(c.updated_at<? OR (c.updated_at=? AND c.id<?))');pageValues.push(cursor.time,cursor.time,cursor.id);}
  const result=await env.DB.prepare('SELECT c.id,c.json,c.updated_at,f.json feedback'+join+' WHERE '+pageClauses.join(' AND ')+' ORDER BY c.updated_at DESC,c.id DESC LIMIT ?').bind(options.userId,...pageValues,limit+1).all<{id:string;json:string;updated_at:string;feedback:string|null}>();
  const hasMore=result.results.length>limit,rows=result.results.slice(0,limit);
  const items=rows.map(row=>honestContent({...JSON.parse(row.json),...(row.feedback?JSON.parse(row.feedback):{})}) as ContentItem);
  if(items.length){
    const provenance=await env.DB.prepare('SELECT content_id,name,url FROM content_sources WHERE content_id IN ('+items.map(()=>'?').join(',')+') ORDER BY first_seen_at,source_id').bind(...items.map(item=>item.id)).all<{content_id:string;name:string;url:string}>();
    for(const item of items){const found=provenance.results.filter(row=>row.content_id===item.id);item.relatedSources=[...new Map([...(item.relatedSources||[]),...found.map(({name,url})=>({name,url}))].map(value=>[value.name+'\n'+value.url,value])).values()];}
  }
  const last=rows.at(-1);
  return {items,total:totalRow?.count||0,nextCursor:hasMore&&last?encodeCursor({time:last.updated_at,id:last.id,asOf,scope}):null,asOf,...(shortQueryLimited?{shortQueryLimited:true,searchWindow:1000,minimumFullSearchCharacters:3}:{})};
}

/** Bounded, resumable and safe to repeat. No authoritative rows are rewritten. */
export async function rebuildSearchIndex(env:Env,limit=25) {
  limit=Math.min(100,Math.max(1,Math.floor(limit)));
  const rows=await env.DB.prepare('SELECT c.rowid,c.id,c.json FROM content c WHERE NOT EXISTS(SELECT 1 FROM content_search WHERE rowid=c.rowid) ORDER BY c.rowid LIMIT ?').bind(limit).all<{rowid:number;id:string;json:string}>();
  const statements=rows.results.map(row=>{const item=JSON.parse(row.json) as ContentItem;const text=[item.title,item.summary,item.body||'',item.sourceName,JSON.stringify(item.analysis||{})].join('\n');return env.DB.prepare('INSERT OR IGNORE INTO content_search(rowid,content_id,text) VALUES (?,?,?)').bind(row.rowid,row.id,text);});
  for(let i=0;i<statements.length;i+=25)await env.DB.batch(statements.slice(i,i+25));
  return {indexed:rows.results.length,hasMore:!!await env.DB.prepare('SELECT 1 missing FROM content c WHERE NOT EXISTS(SELECT 1 FROM content_search WHERE rowid=c.rowid) LIMIT 1').first()};
}

export async function exportLibraryPage(env:Env,userId:string,{cursor,limit=50,filter='all',q,type}:{cursor?:string;limit?:number;filter?:Filter;q?:string;type?:Kind|'all'}={}) {
  const page=await queryLibrary(env,{userId,cursor,limit,filter,q,type});
  const feedback:Record<string,Feedback>={};
  for(const item of page.items){const value:Feedback={};for(const key of ['liked','saved','read','dismissed'] as const)if(typeof item[key]==='boolean')value[key]=item[key];if(Object.keys(value).length)feedback[item.id]=value;}
  return {format:'yourfeed-archive' as const,version:1,exportedAt:new Date().toISOString(),items:page.items,feedback,...(!cursor?{sources:await listSources(env),profile:await getProfile(env)}:{}),nextCursor:page.nextCursor};
}
