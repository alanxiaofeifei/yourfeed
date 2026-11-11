import type {ContentItem,Topic} from './types';
import {honestContent} from './content-coverage';
import {shareableSourceUrl} from './content-export';
import {isLanguage} from './language';

export const BROWSER_CACHE_LIMIT = 100 * 1024 * 1024;
export interface CachedReading {key:string;scope:string;item:ContentItem;bytes:number;storedAt:number;touchedAt:number;}
export interface ReadingCacheStore {mutate<T>(scope:string,change:(rows:CachedReading[])=>{rows:CachedReading[];result:T}):Promise<T>;}
export interface CachePreferences {getItem(key:string):string|null;setItem(key:string,value:string):void;removeItem(key:string):void;}
export interface ReadingCacheStatus {enabled:boolean;available:boolean;bytes:number;count:number;limitBytes:number;}
const topics=new Set<Topic>(['ai','automation','network','linux','it','code','making','cooking','science','humanities','english','tools']);
const text=(value:unknown,max:number)=>typeof value==='string'?value.slice(0,max):'';
const list=(value:unknown)=>Array.isArray(value)?value.filter((v):v is Topic=>topics.has(v)).slice(0,12):[];

/** An explicit allowlist prevents session/config fields from entering device storage. */
export function readingSnapshot(input:ContentItem):ContentItem {
 input=honestContent(input);
 const item:ContentItem={id:text(input.id,240),kind:['video','article','news','post','project'].includes(input.kind)?input.kind:'article',platform:text(input.platform,80),sourceId:text(input.sourceId,240),sourceName:text(input.sourceName,240),title:text(input.title,1000),url:shareableSourceUrl(input.url)||'',summary:text(input.summary,12000),publishedAt:text(input.publishedAt,80),topics:list(input.topics)};
 if(input.body)item.body=text(input.body,100000);
 if(input.analysis){item.analysis={bullets:(input.analysis.bullets||[]).slice(0,12).map(v=>text(v,2000)),relevance:text(input.analysis.relevance,4000),topics:list(input.analysis.topics),coverage:['full_text','excerpt','metadata'].includes(input.analysis.coverage)?input.analysis.coverage:'metadata',references:(input.analysis.references||[]).slice(0,20).map(v=>shareableSourceUrl(v)).filter((v):v is string=>!!v),model:text(input.analysis.model,200)};
  if(isLanguage(input.analysis.summaryLanguage))item.analysis.summaryLanguage=input.analysis.summaryLanguage;
  if(Number.isSafeInteger(input.analysis.profileVersion))item.analysis.profileVersion=input.analysis.profileVersion;
 }
 if(input.externalId)item.externalId=text(input.externalId,240);if(input.parentId)item.parentId=text(input.parentId,240);
 if(typeof input.duration==='number'&&Number.isFinite(input.duration)&&input.duration>=0)item.duration=input.duration;
 if(input.relatedSources)item.relatedSources=input.relatedSources.slice(0,30).flatMap(source=>{const url=shareableSourceUrl(source.url);return url?[{name:text(source.name,240),url}]:[];});
 const fields=input as unknown as Record<string,unknown>,snapshot=item as unknown as Record<string,unknown>;
 if(['metadata','excerpt','full','unknown'].includes(String(fields.contentCoverage)))snapshot.contentCoverage=fields.contentCoverage;
 if(['rss-content','rss-summary','platform-metadata','html-extraction','manual-link'].includes(String(fields.retrievalMethod)))snapshot.retrievalMethod=fields.retrievalMethod;
 if(typeof fields.truncated==='boolean')snapshot.truncated=fields.truncated;
 if(typeof fields.originalLength==='number'&&Number.isSafeInteger(fields.originalLength)&&fields.originalLength>=0)snapshot.originalLength=fields.originalLength;
 if(typeof fields.retrievedAt==='string')snapshot.retrievedAt=fields.retrievedAt.slice(0,80);
 if(['published','updated','dc-date','missing','imported'].includes(String(fields.dateSource)))snapshot.dateSource=fields.dateSource;
 if(input.body&&input.body.length>100000){snapshot.truncated=true;snapshot.originalLength=input.body.length;}
 return item;
}

export function createReadingCache(scope:string,store:ReadingCacheStore,preferences:CachePreferences,limitBytes=BROWSER_CACHE_LIMIT) {
 if(!scope||scope.length>400)throw Error('CACHE_SCOPE_REQUIRED');
 const preferenceKey='yourfeed-reading-cache:'+encodeURIComponent(scope);
 const enabled=()=>{try{return preferences.getItem(preferenceKey)==='enabled';}catch{return false;}};
 const change=<T>(fn:(rows:CachedReading[])=>{rows:CachedReading[];result:T})=>store.mutate(scope,fn);
 return {
  enabled,
  enable(){preferences.setItem(preferenceKey,'enabled');},
  async disable(){preferences.removeItem(preferenceKey);await change(()=>({rows:[],result:undefined}));},
  async status():Promise<ReadingCacheStatus>{const active=enabled();if(!active)return {enabled:false,available:true,bytes:0,count:0,limitBytes};return change(rows=>({rows,result:{enabled:true,available:true,bytes:rows.reduce((sum,row)=>sum+row.bytes,0),count:rows.length,limitBytes}}));},
  async write(input:ContentItem):Promise<boolean>{
   if(!enabled())return false;
   const item=readingSnapshot(input);if(!item.id)return false;
   const bytes=new TextEncoder().encode(JSON.stringify(item)).byteLength;if(bytes>limitBytes)return false;
   return change(rows=>{
    // Recheck consent inside the transaction, in case another tab signed out.
    if(!enabled())return {rows:[],result:false};
    const now=Date.now(),key=scope+':'+item.id;let next=rows.filter(row=>row.key!==key).sort((a,b)=>a.touchedAt-b.touchedAt);
    let used=next.reduce((sum,row)=>sum+row.bytes,0);while(next.length&&used+bytes>limitBytes)used-=next.shift()!.bytes;
    next.push({key,scope,item,bytes,storedAt:now,touchedAt:now});return {rows:next,result:true};
   });
  },
  async read(id:string):Promise<ContentItem|null>{if(!enabled())return null;return change(rows=>{const row=rows.find(value=>value.item.id===id);if(row)row.touchedAt=Date.now();return {rows,result:row?readingSnapshot(row.item):null};});},
  async clear(){await change(()=>({rows:[],result:undefined}));},
  async signOut(){preferences.removeItem(preferenceKey);await change(()=>({rows:[],result:undefined}));},
 };
}

let database:Promise<IDBDatabase>|undefined;
function openDatabase():Promise<IDBDatabase>{
 if(!database)database=new Promise((resolve,reject)=>{
  const request=indexedDB.open('yourfeed-reading-cache',1);
  request.onupgradeneeded=()=>{const store=request.result.createObjectStore('reading',{keyPath:'key'});store.createIndex('scope','scope');};
  request.onsuccess=()=>{const db=request.result;db.onversionchange=()=>{db.close();database=undefined;};resolve(db);};
  request.onerror=()=>{database=undefined;reject(Error('CACHE_UNAVAILABLE'));};
  request.onblocked=()=>{database=undefined;reject(Error('CACHE_UNAVAILABLE'));};
 });return database;
}
const indexedStore:ReadingCacheStore={async mutate<T>(scope:string,change:(rows:CachedReading[])=>{rows:CachedReading[];result:T}){
 const db=await openDatabase();return new Promise<T>((resolve,reject)=>{
  const transaction=db.transaction('reading','readwrite'),store=transaction.objectStore('reading');let result:T;
  const request=store.index('scope').getAll(IDBKeyRange.only(scope));
  request.onsuccess=()=>{try{const before=request.result as CachedReading[],previous=new Map(before.map(row=>[row.key,{touchedAt:row.touchedAt,storedAt:row.storedAt,bytes:row.bytes,item:row.item}])),next=change(before);result=next.result;const keep=new Set(next.rows.map(row=>row.key));for(const row of before)if(!keep.has(row.key))store.delete(row.key);for(const row of next.rows){const old=previous.get(row.key);if(!old||old.touchedAt!==row.touchedAt||old.storedAt!==row.storedAt||old.bytes!==row.bytes||old.item!==row.item)store.put(row);}}catch{transaction.abort();}};
  transaction.oncomplete=()=>resolve(result!);
  transaction.onerror=transaction.onabort=()=>reject(Error(transaction.error?.name==='QuotaExceededError'?'CACHE_QUOTA_EXCEEDED':'CACHE_UNAVAILABLE'));
 });
}};
/** Origin partitioning is supplied by IndexedDB; the owner ID separates local accounts. */
export function browserReadingCache(userId:string){
 if(typeof window==='undefined'||!userId||!window.indexedDB)return null;
 try{return createReadingCache(window.location.origin+'|'+userId,indexedStore,window.localStorage);}catch{return null;}
}
export async function cacheReadContent(userId:string,item:ContentItem):Promise<boolean>{try{return await browserReadingCache(userId)?.write(item)||false;}catch{return false;}}
export async function readCachedContent(userId:string,id:string):Promise<ContentItem|null>{try{return await browserReadingCache(userId)?.read(id)||null;}catch{return null;}}
export async function clearCacheOnSignOut(userId:string):Promise<void>{await browserReadingCache(userId)?.signOut();}
