import {afterAll,beforeAll,beforeEach,describe,expect,it,vi} from 'vitest';
import {Miniflare} from 'miniflare';
import {readFileSync,readdirSync} from 'node:fs';
import {handleApi} from '../server/api';
import {initialize,saveConfig,updateSource,upsertContent,type Env} from '../server/db';
import {getOnboarding,mutateOnboarding,onboardingKey} from '../server/onboarding';
import {saveProfile} from '../server/profile';
import {ONBOARDING_STEPS,type OnboardingResponse} from '../shared/onboarding';
import type {ContentItem,Source} from '../shared/types';

let mf:Miniflare,env:Env,isolatedEnv:Env;
const now=Date.now(),cutoff=new Date(now-86400000).toISOString();
const item:ContentItem={id:'item-1',sourceId:'rss-1',sourceName:'Private source name',platform:'RSS',kind:'article',title:'Private article',summary:'Private content',body:'Private body',url:'https://reader.test/article',topics:['science'],publishedAt:new Date(now-1000).toISOString()};
const source:Source={id:'rss-1',name:'Private source name',platform:'rss',locator:'https://reader.test/feed?token=private',enabled:true,topics:['science']};
const headers={'Content-Type':'application/json',Origin:'https://reader.test','oai-authenticated-user-id':'owner-a'};
function request(method='GET',body?:unknown,extra:Record<string,string>={}){return new Request('https://reader.test/api/onboarding',{method,headers:{...headers,...extra},...(body===undefined?{}:{body:JSON.stringify(body)})});}
async function api(method='GET',body?:unknown,user='owner-a'){const response=await handleApi(request(method,body,{'oai-authenticated-user-id':user}),env);return {response,data:await response.json() as OnboardingResponse};}
async function put(id:string,value:unknown){await env.DB.prepare('INSERT INTO settings(id,json) VALUES (?,?) ON CONFLICT(id) DO UPDATE SET json=excluded.json').bind(id,JSON.stringify(value)).run();}
async function account(id:string,createdAt:number){await env.DB.prepare('INSERT INTO auth_user(id,name,email,email_verified,created_at,updated_at) VALUES (?,?,?,1,?,?)').bind(id,'Name',id+'@reader.test',createdAt,createdAt).run();}
beforeAll(async()=>{mf=new Miniflare({modules:true,script:'export default {fetch(){return new Response("fixture")}}',d1Databases:{DB:'onboarding',ISOLATED_DB:'onboarding-isolated'},compatibilityDate:'2026-05-15'});env={DB:await mf.getD1Database('DB') as unknown as Env['DB'],AUTH_MODE:'sites',APP_ENCRYPTION_KEY:'ab'.repeat(32)};isolatedEnv={...env,DB:await mf.getD1Database('ISOLATED_DB') as unknown as Env['DB']};for(const target of [env,isolatedEnv])for(const file of readdirSync('drizzle').filter(file=>file.endsWith('.sql')).sort())for(const sql of readFileSync('drizzle/'+file,'utf8').split('--> statement-breakpoint').map(sql=>sql.trim()).filter(Boolean))await target.DB.exec(sql.replace(/\r?\n/g,' '));},60000);
beforeEach(async()=>{delete env.ONBOARDING_AUTO_OFFER_CUTOFF;delete env.PRIVATE_BACKUP_LOCK;delete env.PRIVATE_BACKUP_GRANT;delete env.OPENAI_API_KEY;await env.DB.batch(['content_search','content_sources','content_aliases','analysis_cache','feedback','content','meta','reservations','settings','sources','auth_user'].map(table=>env.DB.prepare('DELETE FROM '+table)));await initialize(env);});
afterAll(async()=>{await mf?.dispose();});

describe('account-scoped onboarding and strict tour actions',()=>{
  it('uses auth mode + authenticated ID and never initializes state on GET',async()=>{
    expect(onboardingKey(env,'a:b')).toBe('onboarding:'+JSON.stringify(['sites','a:b','first-use',1]));
    expect(onboardingKey({...env,AUTH_MODE:'standalone'},'a:b')).not.toBe(onboardingKey(env,'a:b'));
    const first=await api();expect(first.response.status).toBe(200);expect(first.response.headers.get('cache-control')).toBe('no-store');expect(first.data).toMatchObject({autoOffer:false,storage:'new',state:{revision:0,status:'not_started'},evidence:{hasSavedProfile:false,profileReady:false,aiTested:false}});
    expect(await env.DB.prepare('SELECT COUNT(*) n FROM settings').first('n')).toBe(0);
    await api('PATCH',{action:'start',expectedRevision:0});expect((await api()).data.state.revision).toBe(1);expect((await api('GET',undefined,'owner-b')).data.state.revision).toBe(0);
  });
  it('does not share progress or product evidence across reader databases with the same account ID',async()=>{
    await api('PATCH',{action:'start',expectedRevision:0});await saveProfile(env,{goals:['Private goal']});await updateSource(env,source);
    const other=await getOnboarding(isolatedEnv,'owner-a');expect(other.state.revision).toBe(0);expect(other.evidence).toMatchObject({hasSavedProfile:false,hasRssSource:false,aiConfigured:false});
    expect((await api()).data.state.revision).toBe(1);
  });
  it('fails closed on storage failure instead of inventing a first-use response',async()=>{
    const broken={...env,DB:{prepare(){throw new Error('synthetic storage failure');}} as unknown as Env['DB']};
    const response=await handleApi(request(),broken);expect(response.status).toBe(500);const body=await response.json();expect(body).not.toHaveProperty('autoOffer');expect(body).not.toHaveProperty('evidence');
  });
  it('requires authentication, JSON and same-origin write integration',async()=>{
    expect((await handleApi(new Request('https://reader.test/api/onboarding'),env)).status).toBe(401);
    expect((await handleApi(request('PATCH',{action:'start',expectedRevision:0},{Origin:'https://evil.test'}),env)).status).toBe(403);
    expect((await handleApi(request('PATCH',{action:'start',expectedRevision:0},{'Content-Type':'text/plain'}),env)).status).toBe(415);
    expect((await api('PUT',{action:'start',expectedRevision:0})).response.status).toBe(404);
  });
  it('inherits maintenance backup write lock while reads remain available',async()=>{
    env.PRIVATE_BACKUP_LOCK='true';env.PRIVATE_BACKUP_GRANT=String(Date.now()+60000)+':'+'a'.repeat(43);
    expect((await api('PATCH',{action:'start',expectedRevision:0})).response.status).toBe(503);
    expect((await api()).response.status).toBe(200);
  });
  it('strictly rejects action, step, revision, identity and evidence injection',async()=>{
    for(const body of [{action:'view',expectedRevision:0},{action:'start'},{action:'start',expectedRevision:-1},{action:'start',expectedRevision:0.5},{action:'start',expectedRevision:'0'},{action:'start',expectedRevision:0,completed:true},{action:'start',expectedRevision:0,userId:'owner-b'},{action:'start',expectedRevision:0,evidence:{aiTested:true}},{action:'resume',expectedRevision:0,step:'not-a-step'},{action:'next',expectedRevision:0,step:'finish'},[],null])expect((await api('PATCH',body)).response.status).toBe(400);
    expect((await api()).data.state.revision).toBe(0);
  });
  it('uses actual D1 compare-and-swap for concurrent tabs and duplicate actions',async()=>{
    const concurrent=await Promise.all([api('PATCH',{action:'start',expectedRevision:0}),api('PATCH',{action:'start',expectedRevision:0})]);expect(concurrent.map(result=>result.response.status).sort()).toEqual([200,409]);
    const started=(await api()).data;expect(started.state.revision).toBe(1);
    const next=await api('PATCH',{action:'skip',expectedRevision:1});expect(next.data.state).toMatchObject({revision:2,currentStep:'profile.interests',skippedSteps:['welcome.language']});
    expect((await api('PATCH',{action:'next',expectedRevision:1})).response.status).toBe(409);
    expect((await api()).data.state.currentStep).toBe('profile.interests');
  });
  it('preserves skipped/viewed history and product data when dismissing and reviewing',async()=>{
    await saveProfile(env,{goals:['Private goal']});await updateSource(env,source);
    await api('PATCH',{action:'start',expectedRevision:0});await api('PATCH',{action:'skip',expectedRevision:1});
    const dismissed=await api('PATCH',{action:'dismiss',expectedRevision:2});expect(dismissed.data.state).toMatchObject({status:'dismissed',currentStep:'profile.interests'});expect(dismissed.data.autoOffer).toBe(false);
    const review=await api('PATCH',{action:'restart',expectedRevision:3});expect(review.data.state).toMatchObject({currentStep:'welcome.language',skippedSteps:['welcome.language']});expect(review.data.evidence).toMatchObject({profileReady:true,hasRssSource:true});
    expect(await env.DB.prepare('SELECT COUNT(*) n FROM sources').first('n')).toBe(1);
  });
  it('supports all steps and optional feature skips without claiming configured features',async()=>{
    await api('PATCH',{action:'start',expectedRevision:0});let revision=1;
    for(let index=0;index<ONBOARDING_STEPS.length-1;index++){const result=await api('PATCH',{action:'skip',expectedRevision:revision++});expect(result.response.status).toBe(200);expect(result.data.state.currentStep).toBe(ONBOARDING_STEPS[index+1]);}
    const finished=await api('PATCH',{action:'finish',expectedRevision:revision});expect(finished.data.state.status).toBe('completed');expect(finished.data.state.completedAt).toBeTruthy();expect(finished.data.evidence).toMatchObject({aiConfigured:false,aiTested:false,youtubeConfigured:false});
    expect((await api('PATCH',{action:'next',expectedRevision:revision+1})).response.status).toBe(409);
  });
  it('bounds navigation and validates finish; resume can select a chapter',async()=>{
    expect((await api('PATCH',{action:'finish',expectedRevision:0})).response.status).toBe(400);
    await api('PATCH',{action:'start',expectedRevision:0});expect((await api('PATCH',{action:'back',expectedRevision:1})).data.state.currentStep).toBe('welcome.language');
    expect((await api('PATCH',{action:'resume',expectedRevision:2,step:'youtube.intro'})).data.state.currentStep).toBe('youtube.intro');
  });
  it('treats corrupt and unknown schema as manual-only and requires explicit recovery',async()=>{
    const key=onboardingKey(env,'owner-a');await put(key,{schemaVersion:99,key:'do-not-leak'});
    const result=await api();expect(result.data).toMatchObject({storage:'invalid',autoOffer:false,state:{revision:0}});expect(JSON.stringify(result.data)).not.toContain('do-not-leak');
    expect((await api('PATCH',{action:'start',expectedRevision:0})).response.status).toBe(409);
    expect((await api('PATCH',{action:'restart',expectedRevision:0})).data.storage).toBe('saved');
    await env.DB.prepare('UPDATE settings SET json=? WHERE id=?').bind('{bad json',key).run();expect((await api()).data.storage).toBe('invalid');
  });
});

describe('conservative trusted new-account eligibility',()=>{
  it('requires explicit approved cutoff and trusted standalone account creation after it',async()=>{
    const standalone={...env,AUTH_MODE:'standalone',ONBOARDING_AUTO_OFFER_CUTOFF:cutoff};
    await account('old',now-2*86400000);await account('new',now-1000);await account('future',now+86400000);
    expect((await getOnboarding(standalone,'new')).autoOffer).toBe(true);
    expect((await getOnboarding(standalone,'old')).autoOffer).toBe(false);
    expect((await getOnboarding(standalone,'future')).autoOffer).toBe(false);
    expect((await getOnboarding(standalone,'missing')).autoOffer).toBe(false);
    for(const value of [undefined,'bad','',new Date(now+86400000).toISOString()])expect((await getOnboarding({...standalone,ONBOARDING_AUTO_OFFER_CUTOFF:value},'new')).autoOffer).toBe(false);
    expect((await getOnboarding({...standalone,AUTH_MODE:'sites'},'new')).autoOffer).toBe(false);
    await mutateOnboarding(standalone,'new',{action:'dismiss',expectedRevision:0});expect((await getOnboarding(standalone,'new')).autoOffer).toBe(false);
  });
  it('never infers eligibility from empty feed or absence of settings',async()=>{expect((await api()).data.autoOffer).toBe(false);env.ONBOARDING_AUTO_OFFER_CUTOFF=cutoff;expect((await api()).data.autoOffer).toBe(false);});
});

describe('sanitized server-derived evidence',()=>{
  it('does not treat default profile or malformed stored defaults as saved goals',async()=>{
    expect((await api()).data.evidence).toMatchObject({hasSavedProfile:false,profileReady:false});
    await put('profile:user',{version:20});expect((await api()).data.evidence.hasSavedProfile).toBe(false);
    await saveProfile(env,{goals:[]});expect((await api()).data.evidence).toMatchObject({hasSavedProfile:true,profileReady:false});
    await saveProfile(env,{goals:['Private goal']});expect((await api()).data.evidence.profileReady).toBe(true);
  });
  it('requires matching enabled healthy source and actual content; empty/failed sync is not reading proof',async()=>{
    await updateSource(env,{...source,status:'ok',lastSuccess:new Date(now-1000).toISOString()});
    let evidence=(await api()).data.evidence;expect(evidence).toMatchObject({hasRssSource:true,hasRssContent:false,rssReady:false});expect(evidence.sources[0].health).toBe('checked_empty');
    await upsertContent(env,[{...item,sourceId:'another-source'}]);expect((await api()).data.evidence.rssReady).toBe(false);
    await upsertContent(env,[{...item,id:'rss-item'}]);expect((await api()).data.evidence.rssReady).toBe(true);
    await updateSource(env,{...source,status:'error',lastSuccess:new Date(now-1000).toISOString(),error:'SECRET upstream body'});expect((await api()).data.evidence).toMatchObject({hasRssContent:true,rssReady:false});
    await updateSource(env,{...source,enabled:false,status:'ok',lastSuccess:new Date(now-1000).toISOString()});expect((await api()).data.evidence).toMatchObject({hasRssSource:false,hasRssContent:false,rssReady:false});
    await put('irrelevant',{rssReady:true});expect((await api()).data.evidence.rssReady).toBe(false);
  });
  it('excludes blocked sources and future success timestamps from ready evidence',async()=>{
    await upsertContent(env,[item]);await updateSource(env,{...source,status:'ok',lastSuccess:new Date(now+86400000).toISOString()});expect((await api()).data.evidence.rssReady).toBe(false);
    await updateSource(env,{...source,status:'ok',lastSuccess:new Date(now-1000).toISOString(),blocked:true} as Source);const evidence=(await api()).data.evidence;expect(evidence.hasRssSource).toBe(false);expect(evidence.sources[0].health).toBe('blocked');
  });
  it('distinguishes AI saved/enabled/tested and YouTube saved/channel/read',async()=>{
    await saveConfig(env,{key:'secret-provider-key-12345',youtubeKey:'secret-youtube-key-12345',enabled:false});
    expect((await api()).data.evidence).toMatchObject({aiConfigured:true,aiEnabled:false,aiTested:false,aiVerification:'not_recorded',youtubeConfigured:true,hasYoutubeSource:false,youtubeReady:false});
    await updateSource(env,{...source,id:'yt-1',platform:'youtube',status:'ok',lastSuccess:new Date(now-1000).toISOString()});expect((await api()).data.evidence.youtubeReady).toBe(false);
    await upsertContent(env,[{...item,sourceId:'yt-1',kind:'video'}]);expect((await api()).data.evidence.youtubeReady).toBe(true);
    await saveConfig(env,{enabled:true,clearYoutubeKey:true});expect((await api()).data.evidence).toMatchObject({aiEnabled:true,aiTested:false,youtubeConfigured:false,youtubeReady:false});
  });
  it('keeps hosted environment provider keys out of configured evidence',async()=>{
    const hosted={...env,HOSTING_MODE:'hosted',OPENAI_API_KEY:'synthetic-admin-key'};
    const response=await getOnboarding(hosted,'owner-a');expect(response.evidence.aiConfigured).toBe(false);expect(JSON.stringify(response)).not.toContain('synthetic-admin-key');
  });
  it('never emits goals, content, source URLs/names, errors, key material or key suffixes and never calls network',async()=>{
    const network=vi.spyOn(globalThis,'fetch').mockRejectedValue(new Error('No network allowed'));
    try{await saveProfile(env,{goals:['Private goal']});await updateSource(env,{...source,error:'private-provider-error',status:'error'});await upsertContent(env,[item]);await saveConfig(env,{key:'secret-provider-key-12345'});const result=await api();const text=JSON.stringify(result.data);for(const secret of ['Private goal','Private article','Private body','Private source name','private-provider-error','https://reader.test/feed','secret-provider-key','12345','last4','cipher'])expect(text).not.toContain(secret);expect(network).not.toHaveBeenCalled();}finally{network.mockRestore();}
  });
});

it('private settings backup includes scoped progress, but ordinary archive/import never copies it',async()=>{
  await api('PATCH',{action:'start',expectedRevision:0});const key=onboardingKey(env,'owner-a');
  env.PRIVATE_BACKUP_GRANT=String(Date.now()+60000)+':'+'b'.repeat(43);
  const backup=await handleApi(new Request('https://reader.test/api/maintenance-backup?table=settings',{headers:{Authorization:'Bearer '+env.PRIVATE_BACKUP_GRANT}}),env);expect(backup.status).toBe(200);expect(JSON.stringify(await backup.json())).toContain(key.replaceAll('"','\\"'));
  const archiveResponse=await handleApi(new Request('https://reader.test/api/archive',{headers}),env),archive=await archiveResponse.json() as any;expect(archiveResponse.status).toBe(200);expect(JSON.stringify(archive)).not.toContain('onboarding:');
  archive.settings=[{id:onboardingKey(env,'owner-b'),json:JSON.stringify({status:'completed'})}];archive.onboarding={status:'completed'};
  const imported=await handleApi(new Request('https://reader.test/api/archive/import/commit',{method:'POST',headers,body:JSON.stringify({archive,confirmed:true})}),env);expect(imported.status).toBe(200);expect((await api('GET',undefined,'owner-b')).data.state.revision).toBe(0);expect((await api()).data.state.revision).toBe(1);
});
