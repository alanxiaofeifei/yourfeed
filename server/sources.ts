import type {Source,Topic} from '../shared/types';
import {listSources,listContent,getState,setState,type Env} from './db';
import {HttpError} from './security';
import {canonicalUrl,plainText,resolveContentUrl,validatePublicUrl} from './fetch-safe';
import type {PublicDnsResolver} from './provider-endpoint';
const PLATFORMS=new Set<Source['platform']>(['youtube','bilibili','rss','github','x','web']);
const TOPICS=new Set<Topic>(['ai','automation','network','linux','it','code','making','cooking','science','humanities','english','tools']);
type SourceInput=Record<string,unknown>;
export type SourceValidationMode='resolve-dns'|'url-only';
function object(value:unknown):SourceInput{if(!value||typeof value!=='object'||Array.isArray(value))throw new HttpError(400,'请提交有效的内容来源。');return value as SourceInput;}
function sourceError(error:unknown):never{throw new HttpError(400,error instanceof Error?error.message:'内容来源格式不正确。');}
function topics(value:unknown,old:Topic[]=[]):Topic[]{if(value===undefined)return old;if(!Array.isArray(value)||value.length>12||value.some(x=>typeof x!=='string'||!TOPICS.has(x as Topic)))throw new HttpError(400,'请选择有效的兴趣主题。');return [...new Set(value)] as Topic[];}
/** Platform account identity is case-insensitive; channel IDs and feed paths are not. */
export function sourceComparisonKey(source:Pick<Source,'platform'|'locator'>):string{
 let locator=source.locator;
 if(source.platform==='youtube'&&!/^UC[A-Za-z0-9_-]{22}$/.test(locator))locator=locator.normalize('NFC').replace(/^@/,'').toLowerCase();
 if(source.platform==='github')locator=locator.toLowerCase();
 if(source.platform==='x'){try{const url=new URL(locator);url.hostname='x.com';const account=url.pathname.match(/^\/([a-z\d_]{1,15})\/?$/i);if(account){url.pathname='/'+account[1].toLowerCase();url.search='';}else{url.pathname=url.pathname.replace(/^\/([a-z\d_]{1,15})(\/)/i,(_match,name:string,slash:string)=>'/'+name.toLowerCase()+slash);}locator=url.toString();}catch{if(/^@?[a-z\d_]{1,15}$/i.test(locator))locator='https://x.com/'+locator.replace(/^@/,'').toLowerCase();}}
 return source.platform+'\n'+locator;
}
export async function normalizeSourceInput(value:unknown,existing?:Source,resolver?:PublicDnsResolver,validation:SourceValidationMode='resolve-dns'):Promise<Omit<Source,'id'>>{
 const input=object(value);const platform=input.platform===undefined?existing?.platform:input.platform;
 if(typeof platform!=='string'||!PLATFORMS.has(platform as Source['platform']))throw new HttpError(400,'请选择支持的内容来源类型。');
 if(input.enabled!==undefined&&typeof input.enabled!=='boolean')throw new HttpError(400,'来源启用状态必须为布尔值。');
 if(input.blocked!==undefined&&typeof input.blocked!=='boolean')throw new HttpError(400,'来源屏蔽状态必须为布尔值。');
 const rawLocator=input.locator===undefined?existing?.locator:input.locator;
 if(typeof rawLocator!=='string'||!rawLocator.trim()||rawLocator.length>4096)throw new HttpError(400,'请填写来源地址或账号标识。');
 let locator:string=rawLocator.trim();
 try{
  if(platform==='youtube'){
   if(locator.startsWith('https://')){const u=validatePublicUrl(locator);if(!(u.hostname==='youtube.com'||u.hostname.endsWith('.youtube.com')))throw new Error('请填写 YouTube 频道 ID、@用户名或频道链接。');const m=u.pathname.match(/^\/(?:channel\/(UC[A-Za-z0-9_-]{22})|(@[^/]+))\/?$/);if(!m)throw new Error('请填写 YouTube 频道链接，而不是某条视频链接。');locator=m[1]||m[2];}
   if(!/^UC[A-Za-z0-9_-]{22}$/.test(locator)){locator=locator.replace(/^@/,'');if(!/^[\p{L}\p{N}\p{M}_.-]{1,50}$/u.test(locator))throw new Error('YouTube 频道标识格式不正确。');}
  }else if(platform==='bilibili'){
   if(locator.startsWith('https://')){const u=validatePublicUrl(locator);if(u.hostname!=='space.bilibili.com'||!/^\/\d+\/?$/.test(u.pathname))throw new Error('请填写 B 站 UP 主空间链接或 UID。');locator=u.pathname.replace(/\//g,'');}
   if(!/^[1-9]\d{0,19}$/.test(locator)||BigInt(locator)>18446744073709551615n)throw new Error('B 站 UID 格式不正确，请使用数字字符串。');
  }else if(platform==='github'){
   if(locator.startsWith('https://')){const u=validatePublicUrl(locator);if(u.hostname!=='github.com'||!/^\/[^/]+\/?$/.test(u.pathname))throw new Error('请填写 GitHub 用户名或用户主页链接。');locator=u.pathname.replace(/\//g,'');}
   if(!/^[a-z\d](?:[a-z\d-]{0,37}[a-z\d])?$/i.test(locator)||locator.includes('--'))throw new Error('GitHub 用户名格式不正确。');locator=locator.toLowerCase();
  }else{
   if(platform==='x'&&!locator.startsWith('https://')){if(!/^@?[a-z\d_]{1,15}$/i.test(locator))throw new Error('请填写 X 用户名或帖子链接。');locator='https://x.com/'+locator.replace(/^@/,'');}
   // Bulk drafts/storage may defer DNS; every actual content request still goes
   // through fetchSafe's public DNS validation, never through a fake resolver.
   const u=validation==='url-only'||existing?.platform===platform&&existing.locator===locator?validatePublicUrl(locator):await resolveContentUrl(locator,resolver);
   if(platform==='x'&&!['x.com','www.x.com','twitter.com','www.twitter.com'].includes(u.hostname))throw new Error('X 来源需要使用 x.com 或 twitter.com 链接。');
   locator=canonicalUrl(u.toString());
  }
 }catch(error){sourceError(error);}
 const fallbackName=platform==='github'?`${locator} 的 GitHub Stars`:platform==='youtube'?`YouTube · ${locator}`:platform==='bilibili'?`B站 · ${locator}`:new URL(locator).hostname;
 const rawName=input.name===undefined?existing?.name||fallbackName:input.name;
 if(typeof rawName!=='string'||!rawName.trim()||rawName.length>150)throw new HttpError(400,'来源名称应为 1–150 个字符。');
 const name=plainText(rawName).trim();if(!name)throw new HttpError(400,'请填写来源名称。');
 const result:Omit<Source,'id'>={name,platform:platform as Source['platform'],locator,topics:topics(input.topics,existing?.topics),enabled:input.enabled===undefined?existing?.enabled??true:input.enabled};
 if(platform==='x'||platform==='web')result.status='manual';
 return result;
}
export async function createSource(env:Env,value:unknown,resolver?:PublicDnsResolver,validation:SourceValidationMode='resolve-dns'):Promise<Source>{
 const input=object(value);const normalized=await normalizeSourceInput(input,undefined,resolver,validation);const existing=await listSources(env);
 const identity=sourceComparisonKey(normalized);if(existing.some(s=>sourceComparisonKey(s)===identity))throw new HttpError(409,'这个内容来源已经添加。');
 if(existing.length>=200)throw new HttpError(400,'最多添加 200 个内容来源。');
 const source:Source={id:'source-'+crypto.randomUUID(),...normalized};if(typeof input.blocked==='boolean')(source as Source&{blocked?:boolean}).blocked=input.blocked;
 // D1 serializes the check and insert. Identity is independent from mutable
 // source IDs; legacy rows were compared above and are never overwritten.
 const inserted=await env.DB.prepare("INSERT INTO sources(id,json) SELECT ?,? WHERE (SELECT COUNT(*) FROM sources)<200 AND NOT EXISTS (SELECT 1 FROM sources WHERE json_extract(json,'$._identityKey')=?)").bind(source.id,JSON.stringify({...source,_identityKey:identity}),identity).run();
 if(inserted.meta.changes!==1){if((await listSources(env)).some(s=>sourceComparisonKey(s)===identity))throw new HttpError(409,'这个内容来源已经添加。');throw new HttpError(400,'最多添加 200 个内容来源。');}
 await setState(env,'sync-round-started','0');return source;
}
export async function updateSourceInput(env:Env,value:unknown,resolver?:PublicDnsResolver):Promise<Source>{
 const input=object(value);if(typeof input.id!=='string'||input.id.length>200)throw new HttpError(400,'请指定内容来源。');
 let existing=(await listSources(env)).find(s=>s.id===input.id);
 if(!existing){const item=(await listContent(env)).find(i=>i.sourceId===input.id);if(!item)throw new HttpError(404,'内容来源不存在。');existing={id:item.sourceId,name:item.sourceName,platform:'web',locator:item.url,topics:item.topics,enabled:true,status:'manual'};}
 const normalized=await normalizeSourceInput(input,existing,resolver);
 const duplicates=await listSources(env);if(duplicates.some(s=>s.id!==existing!.id&&sourceComparisonKey(s)===sourceComparisonKey(normalized)))throw new HttpError(409,'这个内容来源已经添加。');
 const changed=existing.platform!==normalized.platform||existing.locator!==normalized.locator;
 const source:Source={...existing,...normalized,id:existing.id};
 if(changed){delete source.lastSuccess;delete source.error;source.status=normalized.status;delete (source as Source&{lastAttempt?:number}).lastAttempt;}
 if(typeof input.blocked==='boolean')(source as Source&{blocked?:boolean}).blocked=input.blocked;
 const identity=sourceComparisonKey(normalized);const written=await env.DB.prepare("INSERT INTO sources(id,json) SELECT ?,? WHERE (EXISTS (SELECT 1 FROM sources WHERE id=?) OR (SELECT COUNT(*) FROM sources)<200) AND NOT EXISTS (SELECT 1 FROM sources WHERE id<>? AND json_extract(json,'$._identityKey')=?) ON CONFLICT(id) DO UPDATE SET json=excluded.json").bind(source.id,JSON.stringify({...source,_identityKey:identity}),source.id,source.id,identity).run();
 if(written.meta.changes!==1){if((await listSources(env)).some(item=>item.id!==source.id&&sourceComparisonKey(item)===identity))throw new HttpError(409,'这个内容来源已经添加。');throw new HttpError(400,'最多添加 200 个内容来源。');}
 if(changed||input.enabled===true)await setState(env,'sync-round-started','0');return source;
}
export async function deleteSource(env:Env,id:unknown):Promise<void>{
 if(typeof id!=='string'||id.length>200)throw new HttpError(400,'请指定内容来源。');
 if(!(await listSources(env)).some(s=>s.id===id))throw new HttpError(404,'内容来源不存在。');
 await env.DB.prepare('DELETE FROM sources WHERE id=?').bind(id).run();
 const state=await getState(env,'sync-queue');if(state){try{const queue=JSON.parse(state);if(Array.isArray(queue))await setState(env,'sync-queue',JSON.stringify(queue.filter(value=>value!==id)));}catch{}}
}
