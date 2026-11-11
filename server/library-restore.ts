import type {ContentItem,Feedback,Source,Topic} from '../shared/types';
import {type Env,getContentById,listSources,upsertContent,saveFeedback} from './db';
import {normalizeSourceInput,sourceComparisonKey} from './sources';
import {getProfile,normalizeProfile,saveProfile} from './profile';
import {TOPIC_LABELS} from '../shared/profile';
import {validatePublicUrl} from './fetch-safe';
import {HttpError} from './security';
import {isHosted} from './hosted';

const object=(value:unknown):Record<string,unknown>=>{if(!value||typeof value!=='object'||Array.isArray(value))throw new HttpError(400,'归档格式无效。');return value as Record<string,unknown>;};
function text(value:unknown,max:number,required=false):string {if(value===undefined&&!required)return '';if(typeof value!=='string'||value.length>max||(required&&!value.trim())||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value))throw new HttpError(400,'归档文字或内容标识无效。');return value;}
function safeUrl(value:unknown):string {return validatePublicUrl(text(value,4096,true)).toString();}
function validTopics(value:unknown):Topic[] {if(!Array.isArray(value)||value.length>12||value.some(topic=>typeof topic!=='string'||!Object.hasOwn(TOPIC_LABELS,topic)))throw new HttpError(400,'归档主题无效。');return [...new Set(value)] as Topic[];}
function normalizeItem(value:unknown):ContentItem {
 const item=object(value);if(!['video','article','news','post','project'].includes(String(item.kind)))throw new HttpError(400,'归档内容类型无效。');
 const date=text(item.publishedAt,80,true);if(!Number.isFinite(Date.parse(date)))throw new HttpError(400,'归档日期无效。');
 const result:ContentItem={id:text(item.id,200,true),kind:item.kind as ContentItem['kind'],platform:text(item.platform,80,true),sourceId:text(item.sourceId,200,true),sourceName:text(item.sourceName,150,true),title:text(item.title,2000,true),url:safeUrl(item.url),summary:text(item.summary,20000),publishedAt:date,topics:validTopics(item.topics)};
 if(item.body!==undefined)result.body=text(item.body,100000);
 for(const key of ['externalId','parentId'] as const)if(item[key]!==undefined)result[key]=text(item[key],200);
 if(item.contentCoverage!==undefined&&['metadata','excerpt','full','unknown'].includes(String(item.contentCoverage)))result.contentCoverage=item.contentCoverage as ContentItem['contentCoverage'];
 // Imported coverage is a claim from an untrusted file, not newly verified full text.
 if(result.contentCoverage==='full')result.contentCoverage='unknown';
 if(typeof item.truncated==='boolean')result.truncated=item.truncated;
 if(typeof item.retrievedAt==='string'&&Number.isFinite(Date.parse(item.retrievedAt)))result.retrievedAt=item.retrievedAt;
 if(Array.isArray(item.relatedSources)&&item.relatedSources.length<=30)result.relatedSources=item.relatedSources.map(value=>{const source=object(value);return {name:text(source.name,150,true),url:safeUrl(source.url)};});
 if(item.analysis!==undefined){const a=object(item.analysis);if(!Array.isArray(a.bullets)||a.bullets.length>20||!Array.isArray(a.references)||a.references.length>30||!['full_text','excerpt','metadata'].includes(String(a.coverage)))throw new HttpError(400,'归档 AI 摘要格式无效。');result.analysis={bullets:a.bullets.map(value=>text(value,4000,true)),relevance:text(a.relevance,10000),topics:validTopics(a.topics),coverage:a.coverage==='full_text'?'excerpt':a.coverage as 'excerpt'|'metadata',references:a.references.map(safeUrl),model:text(a.model,120,true)};}
 return result;
}
export async function readLibraryArchiveBody(request:Request):Promise<Record<string,unknown>> {
 const limit=8*1024*1024;if(Number(request.headers.get('content-length')||0)>limit)throw new HttpError(413,'归档单批最大 8 MB，请分批导入。');
 const reader=request.body?.getReader();if(!reader)throw new HttpError(400,'请选择归档文件。');const chunks:Uint8Array[]=[];let size=0;
 try{while(true){const chunk=await reader.read();if(chunk.done)break;size+=chunk.value.length;if(size>limit){await reader.cancel();throw new HttpError(413,'归档单批最大 8 MB，请分批导入。');}chunks.push(chunk.value);}}finally{reader.releaseLock();}
 const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
 try{return object(JSON.parse(new TextDecoder().decode(bytes)));}catch(error){if(error instanceof HttpError)throw error;throw new HttpError(400,'归档不是有效 JSON。');}
}
/** Files cannot restore server settings, authentication, secrets or reservations.
 * Existing IDs are skipped. Source/profile restoration always needs opt-in. */
export async function restoreLibrary(env:Env,userId:string,input:Record<string,unknown>,commit=false) {
 const archive=object(input.archive);if(archive.format!=='yourfeed-archive'||archive.version!==1||!Array.isArray(archive.items)||archive.items.length>3)throw new HttpError(400,'请选择 YourFeed v1 归档，每批最多 3 条。');
 const items=archive.items.map(normalizeItem);if(new Set(items.map(item=>item.id)).size!==items.length)throw new HttpError(400,'归档包含重复内容标识。');
 const existingIds=new Set<string>();for(const item of items)if(await getContentById(env,item.id))existingIds.add(item.id);
 const sources:Source[]=[];
 if(input.importSources===true&&archive.sources!==undefined){if(!Array.isArray(archive.sources)||archive.sources.length>3)throw new HttpError(400,'归档来源数量无效。');for(const value of archive.sources){const source=object(value);sources.push({id:text(source.id,200,true),...await normalizeSourceInput(source,undefined,undefined,'url-only')});}}
 const sourceReferences:Source[]=[];
 if(archive.sourceReferences!==undefined){if(!Array.isArray(archive.sourceReferences)||archive.sourceReferences.length>3)throw new HttpError(400,'归档来源引用数量无效。');for(const value of archive.sourceReferences){const source=object(value);sourceReferences.push({id:text(source.id,200,true),...await normalizeSourceInput(source,undefined,undefined,'url-only')});}}
 const profile=input.importProfile===true&&archive.profile?normalizeProfile(object(archive.profile),await getProfile(env)):undefined;
 const feedback=archive.feedback===undefined?{}:object(archive.feedback);const patches=new Map<string,Feedback>();
 for(const item of items){const patch=feedback[item.id];if(patch!==undefined){const raw=object(patch),value:Feedback={};for(const key of ['liked','saved','read','dismissed'] as const)if(typeof raw[key]==='boolean')value[key]=raw[key];patches.set(item.id,value);}}
 const existingSources=await listSources(env),keys=new Set(existingSources.map(sourceComparisonKey)),ids=new Set(existingSources.map(source=>source.id));const newSources=sources.filter(source=>{const key=sourceComparisonKey(source);if(ids.has(source.id)||keys.has(key))return false;ids.add(source.id);keys.add(key);return true;});
 if(existingSources.length+newSources.length>200)throw new HttpError(400,'来源总数超过 200，请减少导入来源。');
 if(isHosted(env)&&[...existingSources,...newSources].filter(source=>source.enabled&&!(source as Source&{blocked?:boolean}).blocked).length>30)throw new HttpError(400,'免费托管最多启用 30 个来源，请先暂停部分来源。');
 const result={newItems:items.length-existingIds.size,existingItems:existingIds.size,newSources:newSources.length,profileWillChange:!!profile,imported:0};
 if(!commit)return result;if(input.confirmed!==true)throw new HttpError(400,'请先预览并确认归档导入。');
 // New source IDs from the file are preserved; existing identities are never replaced.
 for(const source of newSources){const identity=sourceComparisonKey(source);const saved=await env.DB.prepare("INSERT INTO sources(id,json) SELECT ?,? WHERE NOT EXISTS(SELECT 1 FROM sources WHERE id=? OR json_extract(json,'$._identityKey')=?) AND (SELECT COUNT(*) FROM sources)<200 AND (?=0 OR ?=0 OR (SELECT COUNT(*) FROM sources WHERE json_extract(json,'$.enabled')=1 AND COALESCE(json_extract(json,'$.blocked'),0)=0)<30)").bind(source.id,JSON.stringify({...source,_identityKey:identity}),source.id,identity,isHosted(env)?1:0,source.enabled?1:0).run();if(!saved.meta.changes&&!await env.DB.prepare('SELECT id FROM sources WHERE id=? OR json_extract(json,\'$._identityKey\')=?').bind(source.id,identity).first())throw new HttpError(409,'来源容量已变化，请重新预览。');}
 for(const item of items){if(existingIds.has(item.id))continue;const same=[...sources,...sourceReferences].find(source=>source.id===item.sourceId);if(same){const known=existingSources.find(source=>sourceComparisonKey(source)===sourceComparisonKey(same));if(known){item.sourceId=known.id;item.sourceName=known.name;}}await upsertContent(env,[item]);if(patches.has(item.id))await saveFeedback(env,userId,item.id,patches.get(item.id)!);result.imported++;}
 if(profile)await saveProfile(env,profile as unknown as Record<string,unknown>);
 return result;
}
