import {buildContentMarkdown,shareableSourceUrl,type ExportTranslate} from './content-export';
import {readingSnapshot} from './browser-cache';
import {isLanguage} from './language';
import {TOPIC_LABELS} from './profile';
import type {ContentItem,Feedback,Source,Topic} from './types';

export interface ArchivePage {format:'yourfeed-archive';version:1;exportedAt:string;items:ContentItem[];feedback?:Record<string,Feedback>;sources?:Source[];sourceReferences?:Source[];profile?:unknown;nextCursor:string|null;}
export interface ArchiveFile {name:string;text:string;}
export const MAX_ARCHIVE_BYTES=50*1024*1024;
export function archiveSourceLocator(source:Source):string{
 const publicUrl=shareableSourceUrl(source.locator);if(publicUrl)return publicUrl;
 if(source.platform==='youtube'&&/^(?:UC[A-Za-z0-9_-]{22}|@?[A-Za-z0-9_.-]{1,100})$/.test(source.locator))return source.locator;
 if(source.platform==='bilibili'&&/^\d{1,25}$/.test(source.locator))return source.locator;
 if(source.platform==='github'&&/^[A-Za-z0-9][A-Za-z0-9-]{0,38}(?:\/[A-Za-z0-9_.-]{1,100})?$/.test(source.locator))return source.locator;
 return '';
}

/** Export only the known reading fields, never a server response spread. */
export function archiveFiles(pages:ArchivePage[],translate:ExportTranslate,origin?:string):ArchiveFile[]{
 const items=[...new Map(pages.flatMap(page=>page.items).map(item=>[item.id,readingSnapshot(item)])).values()];
 const first=pages[0],feedback:Record<string,Feedback>={};for(const page of pages)for(const [id,row]of Object.entries(page.feedback||{})){const flags:Feedback={};for(const flag of ['liked','saved','read','dismissed'] as const)if(typeof row[flag]==='boolean')flags[flag]=row[flag];feedback[id]=flags;}
 const sources=(first?.sources||[]).map(source=>({id:source.id,name:source.name,platform:source.platform,locator:archiveSourceLocator(source),topics:source.topics,enabled:source.enabled}));
 const inputProfile=first?.profile&&typeof first.profile==='object'?first.profile as Record<string,unknown>:{};
 const profile:Record<string,unknown>={};
 if(typeof inputProfile.displayName==='string')profile.displayName=inputProfile.displayName.slice(0,80);
 if(['explorer','creator','it-ai'].includes(String(inputProfile.preset)))profile.preset=inputProfile.preset;
 for(const key of ['language','summaryLanguage'])if(isLanguage(inputProfile[key]))profile[key]=inputProfile[key];
 if(typeof inputProfile.timezone==='string')profile.timezone=inputProfile.timezone.slice(0,100);
 if(Array.isArray(inputProfile.goals))profile.goals=inputProfile.goals.filter((value):value is string=>typeof value==='string').slice(0,8).map(value=>value.slice(0,240));
 if(Number.isSafeInteger(inputProfile.version))profile.version=inputProfile.version;
 if(inputProfile.topicWeights&&typeof inputProfile.topicWeights==='object'){const weights:Partial<Record<Topic,number>>={};for(const [topic,weight]of Object.entries(inputProfile.topicWeights))if(topic in TOPIC_LABELS&&typeof weight==='number'&&Number.isFinite(weight))weights[topic as Topic]=Math.max(0,Math.min(1,weight));profile.topicWeights=weights;}
 const files:ArchiveFile[]=[{name:'archive.json',text:JSON.stringify({format:'yourfeed-archive',version:1,exportedAt:first?.exportedAt||new Date().toISOString(),items,feedback,sources,profile},null,2)},{name:'README.txt',text:'YourFeed personal reading archive\n\narchive.json contains reading records, feedback, sources and preferences. Authentication sessions, API keys and OAuth credentials are excluded. Sensitive source URLs are omitted. Markdown contains only cached text, which may be an excerpt or metadata. Keep this archive private. Downloaded copies cannot be remotely revoked.\n'}];
 for(let index=0;index<items.length;index++){
  const item=items[index],stem=`content/${String(index+1).padStart(6,'0')}`;
  files.push({name:stem+'-source.md',text:buildContentMarkdown(item,'original',translate,origin).markdown});
  if(item.analysis)files.push({name:stem+'-ai.md',text:buildContentMarkdown(item,'ai-summary',translate,origin).markdown});
 }
 return files;
}

/** Portable uncompressed POSIX tar: ordinary browser download, no filesystem permission or new dependency. */
export function buildTarArchive(files:ArchiveFile[]):Uint8Array{
 const encoder=new TextEncoder(),blocks:Uint8Array[]=[];let total=1024;
 for(const file of files){
  if(!/^[a-zA-Z0-9][a-zA-Z0-9/._-]{0,99}$/.test(file.name)||file.name.split('/').includes('..'))throw Error('ARCHIVE_FILENAME_INVALID');
  const content=encoder.encode(file.text),header=new Uint8Array(512);
  total+=512+Math.ceil(content.byteLength/512)*512;if(total>MAX_ARCHIVE_BYTES)throw Error('ARCHIVE_TOO_LARGE');
  const put=(offset:number,length:number,value:string)=>header.set(encoder.encode(value).slice(0,length),offset);
  const octal=(offset:number,length:number,value:number)=>put(offset,length,value.toString(8).padStart(length-1,'0')+'\0');
  put(0,100,file.name);octal(100,8,0o600);octal(108,8,0);octal(116,8,0);octal(124,12,content.byteLength);octal(136,12,0);put(148,8,'        ');put(156,1,'0');put(257,6,'ustar\0');put(263,2,'00');
  const sum=header.reduce((value,byte)=>value+byte,0);put(148,8,sum.toString(8).padStart(6,'0')+'\0 ');
  blocks.push(header,content);const padding=(512-content.byteLength%512)%512;if(padding)blocks.push(new Uint8Array(padding));
 }
 blocks.push(new Uint8Array(1024));const result=new Uint8Array(total);let offset=0;for(const block of blocks){result.set(block,offset);offset+=block.byteLength;}return result;
}

export async function fetchArchivePages(signal:AbortSignal,onProgress:(count:number)=>void,scope:'all'|'liked'|'saved'='all'):Promise<ArchivePage[]>{
 const pages:ArchivePage[]=[],seen=new Set<string>();let cursor:string|null=null,totalBytes=0,count=0;
 do{
  const url=new URL('/api/export',window.location.origin);url.searchParams.set('limit','100');url.searchParams.set('filter',scope);if(cursor)url.searchParams.set('cursor',cursor);
  const response=await fetch(url.pathname+url.search,{signal,cache:'no-store',credentials:'same-origin'});
  if(!response.ok)throw Error('ARCHIVE_FETCH_FAILED');
  const body=await response.text();totalBytes+=new TextEncoder().encode(body).byteLength;if(totalBytes>MAX_ARCHIVE_BYTES/2)throw Error('ARCHIVE_TOO_LARGE');
  const page=JSON.parse(body) as ArchivePage;if(page.format!=='yourfeed-archive'||page.version!==1||!Array.isArray(page.items)||!(page.nextCursor===null||typeof page.nextCursor==='string'))throw Error('ARCHIVE_INVALID');
  if(page.nextCursor&&seen.has(page.nextCursor))throw Error('ARCHIVE_INVALID');if(page.nextCursor)seen.add(page.nextCursor);
  pages.push(page);count+=page.items.length;onProgress(count);cursor=page.nextCursor;
  if(pages.length>1000)throw Error('ARCHIVE_TOO_LARGE');
 }while(cursor&&!signal.aborted);
 if(signal.aborted)throw new DOMException('Aborted','AbortError');return pages;
}

/** Three records per request leave room for auth, indexing and feedback inside Free D1's 50-query limit. */
export function archiveImportChunks(input:unknown):ArchivePage[]{
 if(!input||typeof input!=='object')throw Error('ARCHIVE_INVALID');const archive=input as ArchivePage;
 if(archive.format!=='yourfeed-archive'||archive.version!==1||!Array.isArray(archive.items)||archive.items.length>20000)throw Error('ARCHIVE_INVALID');
 if(archive.feedback&&(!archive.feedback||typeof archive.feedback!=='object'||Array.isArray(archive.feedback)))throw Error('ARCHIVE_INVALID');
 if(archive.sources!==undefined&&(!Array.isArray(archive.sources)||archive.sources.length>200))throw Error('ARCHIVE_INVALID');
 const encoder=new TextEncoder(),result:ArchivePage[]=[],sourceIndex=new Map((archive.sources||[]).map(source=>[source.id,source]));let items:ContentItem[]=[],bytes=0;
 const append=(page:ArchivePage)=>{if(!result.length&&archive.profile!==undefined)page.profile=archive.profile;result.push(page);};
 for(let index=0;index<(archive.sources?.length||0);index+=3)append({format:'yourfeed-archive',version:1,exportedAt:archive.exportedAt,items:[],feedback:{},sources:archive.sources!.slice(index,index+3),nextCursor:null});
 const flush=()=>{const feedback:Record<string,Feedback>={};for(const item of items){const value=archive.feedback?.[item.id];if(value)feedback[item.id]=value;}
  const sourceReferences=[...new Set(items.map(item=>item.sourceId))].flatMap(id=>{const source=sourceIndex.get(id);return source?[source]:[];});
  append({format:'yourfeed-archive',version:1,exportedAt:archive.exportedAt,items,feedback,...(sourceReferences.length?{sourceReferences}:{}),nextCursor:null});items=[];bytes=0;};
 for(const item of archive.items){if(!item||typeof item!=='object'||typeof item.id!=='string')throw Error('ARCHIVE_INVALID');const size=encoder.encode(JSON.stringify(item)).byteLength;if(size>7*1024*1024)throw Error('ARCHIVE_TOO_LARGE');if(items.length&&(items.length>=3||bytes+size>7*1024*1024))flush();items.push(item);bytes+=size;}
 if(items.length||!result.length)flush();
 for(const chunk of result)if(encoder.encode(JSON.stringify(chunk)).byteLength>=8*1024*1024)throw Error('ARCHIVE_TOO_LARGE');
 return result;
}
