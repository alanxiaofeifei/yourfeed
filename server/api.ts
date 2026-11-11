import type { ContentItem, Feedback, Kind, Mode } from '../shared/types';
import { initialize, listContent, upsertContent, listSources, updateSource, readFeedback, saveFeedback, publicConfig, saveConfig, getUsage, getState, type Env } from './db';
import { checkWriteRequest, readJson, HttpError, cleanError, providerName } from './security';
import { feedPage, rankFeed } from './ranking';
import { groupNews,deduplicateFeed } from './dedup';
import { selectBriefing } from './briefing';
import { sessionForRequest } from './session';
import { handleAuth, requireUser, requireRecentAuth } from './auth';
import { getProfile, saveProfile } from './profile';
import { createSource, updateSourceInput, deleteSource, sourceComparisonKey } from './sources';
import { getDeployment, saveDeployment, checkDeployment } from './deployment';
import { providerErrorDiagnostic } from './provider-diagnostics';
import {readSourceImportBody,previewSourceImport,commitSourceImport,validateDiscoveryMessages} from './source-import';
import {sourceCatalog} from '../shared/source-catalog';
import {cachedBatchContent,readFeedBatchRequest,rotatedFeedPage,validateFeedBatchInput} from './feed-rotation';
import {localeFromTag} from '../shared/language';
import {getContentById,queryLibrary,exportLibraryPage,rebuildSearchIndex} from './library';
import {schemaHealth} from './health';
import {retentionStatus,saveRetentionPolicy,cleanupRetention} from './retention';
import {readLibraryArchiveBody,restoreLibrary} from './library-restore';
import {reserveManualImport} from './hosted-limits';
const response=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
const kinds=new Set(['all','video','article','news','post','project']);
export async function handleApi(request:Request,env:Env,ctx?:unknown):Promise<Response> {
  try{
    const path=new URL(request.url).pathname;
    if(path.startsWith('/api/maintenance-backup')){const {handleMaintenanceBackup}=await import('./maintenance-backup');return await handleMaintenanceBackup(request,env);}
    {const {backupWriteLocked}=await import('./maintenance-backup');if(backupWriteLocked(env)&&(!['GET','HEAD'].includes(request.method)||path==='/api/notebook/callback'))return response({error:'正在保存一致性备份，内容更新暂时暂停；阅读仍可使用。'},503);}
    if(path.startsWith('/api/auth/'))return handleAuth(request,env);
    if(path==='/api/health'){if(!env.DB)return response({ok:false,name:'YourFeed',storage:false,schemaReady:false},503);try{const health=await schemaHealth(env);return response({...health,ok:health.schemaReady,name:'YourFeed',storage:true},health.schemaReady?200:503);}catch{return response({ok:false,name:'YourFeed',storage:true,schemaReady:false},503);}}
    if(path==='/api/session'&&request.method==='GET')return response(await sessionForRequest(request,env));
    const userId=(await requireUser(request,env)).id;
    if(!env.DB)throw new HttpError(503,'内容库尚未连接，请稍后再试。');
    if(!['GET','HEAD'].includes(request.method))checkWriteRequest(request);
    await initialize(env);
    if(path.startsWith('/api/notebook/')){
      const {handleNotebookApi}=await import('./notebook');
      return await handleNotebookApi(request,env,userId);
    }
    if(path==='/api/profile'&&request.method==='GET')return response(await getProfile(env));
    if(path==='/api/profile'&&request.method==='PUT')return response(await saveProfile(env,await readJson(request)));
    if(path==='/api/profile/advice'&&request.method==='POST'){
      const {generateProfileAdvice}=await import('./profile-advisor');
      return response(await generateProfileAdvice(env,userId,await readJson(request)));
    }
    if(path==='/api/deployment'&&request.method==='GET')return response(await getDeployment(env,request));
    if(path==='/api/deployment'&&request.method==='PUT'){await requireRecentAuth(request,env);return response(await saveDeployment(env,request,await readJson(request)));}
    if(path==='/api/deployment/check'&&request.method==='POST')return response(await checkDeployment(env,request));
    const url=new URL(request.url);
    const presentationProfile=async()=>{const profile=await getProfile(env);const locale=request.headers.get('accept-language');return locale?{...profile,language:localeFromTag(locale)}:profile;};
    if(path==='/api/library'&&request.method==='GET')return response(await queryLibrary(env,{userId,filter:(url.searchParams.get('filter')||'all') as 'all'|'liked'|'saved'|'read',q:url.searchParams.get('q')||'',type:(url.searchParams.get('type')||'all') as Kind|'all',cursor:url.searchParams.get('cursor')||undefined,limit:20}));
    if(path==='/api/content'&&request.method==='GET'){const item=await getContentById(env,url.searchParams.get('id')||'');if(!item)throw new HttpError(404,'内容不存在。');const feedback=await readFeedback(env,userId);return response({...item,...feedback[item.id]});}
    if((path==='/api/archive'||path==='/api/export')&&request.method==='GET')return response(await exportLibraryPage(env,userId,{cursor:url.searchParams.get('cursor')||undefined,limit:50,filter:(url.searchParams.get('filter')||'all') as 'all'|'liked'|'saved'|'read'}));
    if(path==='/api/archive/import/preview'&&request.method==='POST')return response(await restoreLibrary(env,userId,await readLibraryArchiveBody(request),false));
    if(path==='/api/archive/import/commit'&&request.method==='POST'){await requireRecentAuth(request,env);return response(await restoreLibrary(env,userId,await readLibraryArchiveBody(request),true));}
    if(path==='/api/storage'&&request.method==='GET')return response(await retentionStatus(env));
    if(path==='/api/storage'&&request.method==='PUT'){await requireRecentAuth(request,env);return response(await saveRetentionPolicy(env,await readJson(request)));}
    if(path==='/api/storage/cleanup'&&request.method==='POST'){await requireRecentAuth(request,env);return response(await cleanupRetention(env,{limit:50}));}
    if(path==='/api/maintenance'&&request.method==='POST'){const index=await rebuildSearchIndex(env,5);return response({...await cleanupRetention(env,{limit:5}),index});}
    if(path==='/api/background'&&request.method==='GET'){const {backgroundStatus}=await import('./background');return response(await backgroundStatus(env));}
    if(path==='/api/background'&&request.method==='PUT'){await requireRecentAuth(request,env);const {saveBackgroundPolicy}=await import('./background');return response(await saveBackgroundPolicy(env,await readJson(request),userId));}
    if(path==='/api/briefing'&&request.method==='GET'){
      const [items,sources,feedback,lastUpdated]=await Promise.all([listContent(env),listSources(env),readFeedback(env,userId),getState(env,'last-sync')]);
      return response(selectBriefing(items,sources,feedback,new Date(),lastUpdated||undefined,await presentationProfile()));
    }
    if(path==='/api/feed'&&request.method==='GET'){
      const mode:Mode=url.searchParams.get('mode')==='grow'?'grow':'rest';const type=url.searchParams.get('type')||'all';const filter=url.searchParams.get('filter')||'all';
      if(!kinds.has(type)||!['all','saved','liked','read'].includes(filter))throw new HttpError(400,'内容筛选条件无效。');
      if(filter!=='all'||url.searchParams.get('q')){const page=await queryLibrary(env,{userId,filter:filter as 'all'|'liked'|'saved'|'read',q:url.searchParams.get('q')||'',type:type as Kind|'all',cursor:url.searchParams.get('cursor')==='0'?undefined:url.searchParams.get('cursor')||undefined,limit:20});return response({...page,sources:(await listSources(env)).filter(s=>s.enabled).length,lastUpdated:await getState(env,'last-sync'),mode});}
      const cursor=Math.min(1000,Math.max(0,parseInt(url.searchParams.get('cursor')||'0',10)||0));
      const [items,sources,feedback]=await Promise.all([listContent(env),listSources(env),readFeedback(env,userId)]);
      const ranked=deduplicateFeed(rankFeed(items,sources,feedback,mode,type,filter,(url.searchParams.get('q')||'').slice(0,200),await presentationProfile()),items);
      const page=feedPage(ranked,cursor);
      return response({...page,total:ranked.length,sources:sources.filter(s=>s.enabled).length,lastUpdated:await getState(env,'last-sync'),mode});
    }
    if(path==='/api/feed/batch'&&request.method==='POST'){
      const options=validateFeedBatchInput(await readFeedBatchRequest(request));
      const [items,sources,feedback,profile]=await Promise.all([cachedBatchContent(env,options.asOf),listSources(env),readFeedback(env,userId),presentationProfile()]);
      return response({...rotatedFeedPage(items,sources,feedback,options,profile),sources:sources.filter(source=>source.enabled).length,lastUpdated:await getState(env,'last-sync'),mode:options.mode});
    }
    if(path==='/api/feedback'&&request.method==='POST'){
      const body=await readJson(request);if(typeof body.id!=='string'||!body.patch||typeof body.patch!=='object')throw new HttpError(400,'反馈内容不完整。');
      const patch:Feedback={};for(const key of ['liked','saved','read','dismissed'] as const){const value=(body.patch as Record<string,unknown>)[key];if(typeof value==='boolean')patch[key]=value;}
      if(!(await env.DB.prepare('SELECT id FROM content WHERE id=?').bind(body.id).first()))throw new HttpError(404,'这条内容不存在。');
      return response({ok:true,feedback:await saveFeedback(env,userId,body.id,patch)});
    }
    if(path==='/api/sources'&&request.method==='GET')return response({sources:await listSources(env)});
    if(path==='/api/sources/recommendations'&&request.method==='GET'){const existing=await listSources(env);return response({recommendations:sourceCatalog.map(entry=>({...entry,existingId:existing.find(source=>sourceComparisonKey(source)===sourceComparisonKey(entry))?.id}))});}
    if(path==='/api/sources/discover/chat'&&request.method==='POST'){
      const body=await readSourceImportBody(request);const messages=validateDiscoveryMessages(body.messages);const {sourceDiscoveryConversation}=await import('./ai');
      const result=await sourceDiscoveryConversation(env,messages,sourceCatalog,await presentationProfile());const valid=new Set(sourceCatalog.map(entry=>entry.id));const recommendedIds=[...new Set(result.recommendedIds.filter(id=>valid.has(id)))];
      return response({message:result.message,ready:result.ready===true&&recommendedIds.length>0,recommendedIds,...(result.needsConfiguration===true?{needsConfiguration:true}:{})});
    }
    if(path==='/api/sources/import/preview'&&request.method==='POST')return response(await previewSourceImport(env,await readSourceImportBody(request)));
    if(path==='/api/sources/import/commit'&&request.method==='POST')return response(await commitSourceImport(env,await readSourceImportBody(request)));
    if(path==='/api/sources'&&request.method==='POST')return response({ok:true,source:await createSource(env,await readJson(request))},201);
    if(path==='/api/sources'&&request.method==='PATCH')return response({ok:true,source:await updateSourceInput(env,await readJson(request))});
    if(path==='/api/sources'&&request.method==='DELETE'){const body=await readJson(request);if(typeof body.id!=='string')throw new HttpError(400,'Source ID is required.');await deleteSource(env,body.id);return response({ok:true});}
    if(path==='/api/settings'&&request.method==='GET')return response(await publicConfig(env));
    if(path==='/api/settings'&&request.method==='PUT'){await requireRecentAuth(request,env);return response(await saveConfig(env,await readJson(request)));}
    if(path==='/api/usage'&&request.method==='GET')return response(await getUsage(env));
    if(path==='/api/sync'&&request.method==='POST'){
      const body=await readJson(request);const {syncSources}=await import('./ingest');
      return response(await syncSources(env,{force:body.force===true,limit:Math.min(5,Math.max(1,Number(body.limit)||3))}));
    }
    if(path==='/api/import'&&request.method==='POST'){
      const body=await readJson(request);if(typeof body.url!=='string')throw new HttpError(400,'请填写文章、帖子或视频链接。');
      await reserveManualImport(env);
      const {importUrl}=await import('./ingest');let item:ContentItem;try{item=await importUrl(body.url,env);}catch(error){const message=error instanceof Error?error.message:'';if(/^(请输入|请提供|仅支持|不支持|暂不支持|此链接|YouTube 视频|来源暂时|来源返回|来源内容|来源跳转)/.test(message))throw new HttpError(400,message);throw new HttpError(502,'暂时无法读取这个来源，请稍后重试。');}await upsertContent(env,[item]);return response({ok:true,item});
    }
    if(path==='/api/test-provider'&&request.method==='POST'){
      await requireRecentAuth(request,env);
      const body=await readJson(request);const overrides:Partial<import('../shared/types').ProviderConfig>={};if(body.provider!==undefined)overrides.provider=providerName(body.provider);for(const field of ['model','key','providerName','baseUrl','protocol','temperature','maxOutputTokens','timeoutSeconds','responseFormat','reasoningEffort','inputPricePerMillion','outputPricePerMillion'] as const){if(body[field]!==undefined)(overrides as Record<string,unknown>)[field]=body[field];}const {testProvider}=await import('./ai');return response(await testProvider(env,overrides));
    }
    if(path==='/api/analyze'&&request.method==='POST'){
      const body=await readJson(request);const {analyzeItem,analyzePending}=await import('./ai');
      if(typeof body.id==='string'){
        const item=await getContentById(env,body.id);if(!item)throw new HttpError(404,'内容不存在。');
        return response(await analyzeItem(env,item));
      }
      return response(await analyzePending(env,Math.min(3,Math.max(1,Number(body.limit)||1)),userId));
    }
    return response({error:'接口不存在。'},404);
  }catch(error){const diagnostic=providerErrorDiagnostic(error);return response({error:cleanError(error),...(diagnostic?{diagnostic}:{})},error instanceof HttpError?error.status:500);}
}
