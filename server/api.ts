import type { ContentItem, Feedback, Kind, Mode } from '../shared/types';
import { initialize, listContent, upsertContent, listSources, updateSource, readFeedback, saveFeedback, publicConfig, saveConfig, getUsage, getState, type Env } from './db';
import { checkWriteRequest, readJson, HttpError, cleanError, providerName } from './security';
import { feedPage, rankFeed } from './ranking';
import { groupNews } from './dedup';
import { selectBriefing } from './briefing';
import { sessionForRequest } from './session';
import { handleAuth, requireUser, requireRecentAuth } from './auth';
import { getProfile, saveProfile } from './profile';
import { createSource, updateSourceInput, deleteSource } from './sources';
import { getDeployment, saveDeployment, checkDeployment } from './deployment';
const response=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
const kinds=new Set(['all','video','article','news','post','project']);
export async function handleApi(request:Request,env:Env,ctx?:unknown):Promise<Response> {
  try{
    const path=new URL(request.url).pathname;
    if(path.startsWith('/api/auth/'))return handleAuth(request,env);
    if(path==='/api/health'){if(!env.DB)return response({ok:false,name:'YourFeed',storage:false,schemaReady:false},503);try{const row=await env.DB.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type='table' AND name='content'").first<{count:number}>();const ready=(row?.count||0)>0;return response({ok:ready,name:'YourFeed',storage:true,schemaReady:ready},ready?200:503);}catch{return response({ok:false,name:'YourFeed',storage:true,schemaReady:false},503);}}
    if(path==='/api/session'&&request.method==='GET')return response(await sessionForRequest(request,env));
    const userId=(await requireUser(request,env)).id;
    if(!env.DB)throw new HttpError(503,'内容库尚未连接，请稍后再试。');
    if(!['GET','HEAD'].includes(request.method))checkWriteRequest(request);
    await initialize(env);
    if(path==='/api/profile'&&request.method==='GET')return response(await getProfile(env));
    if(path==='/api/profile'&&request.method==='PUT')return response(await saveProfile(env,await readJson(request)));
    if(path==='/api/deployment'&&request.method==='GET')return response(await getDeployment(env,request));
    if(path==='/api/deployment'&&request.method==='PUT'){await requireRecentAuth(request,env);return response(await saveDeployment(env,request,await readJson(request)));}
    if(path==='/api/deployment/check'&&request.method==='POST')return response(await checkDeployment(env,request));
    const url=new URL(request.url);
    const presentationProfile=async()=>{const profile=await getProfile(env);const locale=request.headers.get('accept-language');return locale?{...profile,language:(locale.toLowerCase().startsWith('zh')?'zh':'en') as 'zh'|'en'}:profile;};
    if(path==='/api/briefing'&&request.method==='GET'){
      const [items,sources,feedback,lastUpdated]=await Promise.all([listContent(env),listSources(env),readFeedback(env,userId),getState(env,'last-sync')]);
      return response(selectBriefing(items,sources,feedback,new Date(),lastUpdated||undefined,await presentationProfile()));
    }
    if(path==='/api/feed'&&request.method==='GET'){
      const mode:Mode=url.searchParams.get('mode')==='grow'?'grow':'rest';const type=url.searchParams.get('type')||'all';const filter=url.searchParams.get('filter')||'all';
      if(!kinds.has(type)||!['all','saved','liked','read'].includes(filter))throw new HttpError(400,'内容筛选条件无效。');
      const cursor=Math.min(1000,Math.max(0,parseInt(url.searchParams.get('cursor')||'0',10)||0));
      const [items,sources,feedback]=await Promise.all([listContent(env),listSources(env),readFeedback(env,userId)]);
      const ranked=groupNews(rankFeed(items,sources,feedback,mode,type,filter,(url.searchParams.get('q')||'').slice(0,200),await presentationProfile()),items);
      const page=feedPage(ranked,cursor);
      return response({...page,total:ranked.length,sources:sources.filter(s=>s.enabled).length,lastUpdated:await getState(env,'last-sync'),mode});
    }
    if(path==='/api/feedback'&&request.method==='POST'){
      const body=await readJson(request);if(typeof body.id!=='string'||!body.patch||typeof body.patch!=='object')throw new HttpError(400,'反馈内容不完整。');
      const patch:Feedback={};for(const key of ['liked','saved','read','dismissed'] as const){const value=(body.patch as Record<string,unknown>)[key];if(typeof value==='boolean')patch[key]=value;}
      if(!(await env.DB.prepare('SELECT id FROM content WHERE id=?').bind(body.id).first()))throw new HttpError(404,'这条内容不存在。');
      return response({ok:true,feedback:await saveFeedback(env,userId,body.id,patch)});
    }
    if(path==='/api/sources'&&request.method==='GET')return response({sources:await listSources(env)});
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
      const {importUrl}=await import('./ingest');let item:ContentItem;try{item=await importUrl(body.url,env);}catch(error){const message=error instanceof Error?error.message:'';if(/^(请输入|请提供|仅支持|不支持|暂不支持|此链接|YouTube 视频|来源暂时|来源返回|来源内容|来源跳转)/.test(message))throw new HttpError(400,message);throw new HttpError(502,'暂时无法读取这个来源，请稍后重试。');}await upsertContent(env,[item]);return response({ok:true,item});
    }
    if(path==='/api/test-provider'&&request.method==='POST'){
      await requireRecentAuth(request,env);
      const body=await readJson(request);const overrides:Partial<import('../shared/types').ProviderConfig>={};if(body.provider!==undefined)overrides.provider=providerName(body.provider);for(const field of ['model','key','providerName','baseUrl','protocol','temperature','maxOutputTokens','timeoutSeconds','responseFormat','reasoningEffort','inputPricePerMillion','outputPricePerMillion'] as const){if(body[field]!==undefined)(overrides as Record<string,unknown>)[field]=body[field];}const {testProvider}=await import('./ai');return response(await testProvider(env,overrides));
    }
    if(path==='/api/analyze'&&request.method==='POST'){
      const body=await readJson(request);const {analyzeItem,analyzePending}=await import('./ai');
      if(typeof body.id==='string'){
        const item=(await listContent(env)).find(x=>x.id===body.id);if(!item)throw new HttpError(404,'内容不存在。');
        return response(await analyzeItem(env,item));
      }
      return response(await analyzePending(env,Math.min(3,Math.max(1,Number(body.limit)||1)),userId));
    }
    return response({error:'接口不存在。'},404);
  }catch(error){return response({error:cleanError(error)},error instanceof HttpError?error.status:500);}
}
