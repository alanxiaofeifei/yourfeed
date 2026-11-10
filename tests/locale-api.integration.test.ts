import {afterAll,beforeAll,beforeEach,describe,expect,it,vi} from 'vitest';
import {Miniflare} from 'miniflare';
import {readFileSync,readdirSync} from 'node:fs';
import {handleApi} from '../server/api';
import {getProfile} from '../server/profile';
import {updateSource,upsertContent,type Env} from '../server/db';
import type {ContentItem} from '../shared/types';

let mf:Miniflare,env:Env;
const origin='https://locale.reader.net';
function request(path:string,{method='GET',body,language,user=true,requestOrigin=origin}:{method?:string;body?:unknown;language?:string;user?:boolean;requestOrigin?:string}={}) {
  return new Request(origin+path,{method,headers:{'Content-Type':'application/json',Origin:requestOrigin,...(user?{'oai-authenticated-user-id':'locale-owner'}:{}),...(language?{'Accept-Language':language}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});
}
beforeAll(async()=>{
  mf=new Miniflare({modules:true,script:'export default {fetch(){return new Response("fixture")}}',d1Databases:{DB:'locale-api-integration'},compatibilityDate:'2026-05-15'});
  env={DB:await mf.getD1Database('DB') as unknown as Env['DB'],AUTH_MODE:'sites'};
  for(const file of readdirSync('drizzle').filter(file=>file.endsWith('.sql')).sort())for(const sql of readFileSync('drizzle/'+file,'utf8').split('--> statement-breakpoint').map(sql=>sql.trim()).filter(Boolean))await env.DB.exec(sql.replace(/\r?\n/g,' '));
},60000);
beforeEach(async()=>{
  await env.DB.batch(['analysis_cache','content','feedback','meta','reservations','settings','sources'].map(table=>env.DB.prepare('DELETE FROM '+table)));
  await updateSource(env,{id:'science',name:'原始作者',platform:'rss',locator:'https://science.reader.net/feed',topics:['science'],enabled:true});
  const item:ContentItem={id:'source-language-preserved',kind:'article',platform:'RSS',sourceId:'science',sourceName:'原始作者',title:'中文原始标题',url:'https://science.reader.net/story',summary:'原始摘要，不应因界面语言变化而改写。',body:'<p>保留原始正文。</p>',publishedAt:'2026-11-10T01:00:00Z',topics:['science']};
  await upsertContent(env,[item]);
});
afterAll(async()=>{await mf?.dispose();});

describe('portable four-language API behavior',()=>{
  it('persists every interface locale without changing the summary preference or AI profile revision',async()=>{
    const first=await getProfile(env);
    for(const language of ['en','zh-TW','vi','zh']){
      const saved=await handleApi(request('/api/profile',{method:'PUT',body:{language}}),env);
      expect(saved.status).toBe(200);
      const profile=await saved.json() as any;
      expect(profile.language).toBe(language);expect(profile.summaryLanguage).toBe(first.summaryLanguage);expect(profile.version).toBe(first.version);
      const reloaded=await handleApi(request('/api/profile'),env);expect(await reloaded.json()).toEqual(profile);
    }
  });
  it('accepts explicit AI-summary locales and increments the revision independently of interface choice',async()=>{
    const saved=await handleApi(request('/api/profile',{method:'PUT',body:{language:'vi',summaryLanguage:'zh-TW'}}),env);
    expect(saved.status).toBe(200);const profile=await saved.json() as any;expect(profile).toMatchObject({language:'vi',summaryLanguage:'zh-TW',version:2});
    const changed=await handleApi(request('/api/profile',{method:'PUT',body:{summaryLanguage:'vi'}}),env);expect(await changed.json()).toMatchObject({language:'vi',summaryLanguage:'vi',version:3});
  });
  it('uses each requested UI locale for recommendation explanations while preserving source language and saved profile',async()=>{
    // User-entered goals retain their own language. Isolate generated UI reasons here.
    await handleApi(request('/api/profile',{method:'PUT',body:{goals:[]}}),env);
    const saved=await getProfile(env);const network=vi.spyOn(globalThis,'fetch').mockRejectedValue(new Error('Locale changes must not fetch content or invoke a model'));
    try{
      const reasons:Record<string,string>={};
      for(const language of ['en-US,en;q=0.9','zh-TW,zh;q=0.9','vi-VN,vi;q=0.9']){
        const response=await handleApi(request('/api/feed',{language}),env);expect(response.status).toBe(200);const result=await response.json() as any;
        expect(result.items).toHaveLength(1);expect(result.items[0]).toMatchObject({title:'中文原始标题',sourceName:'原始作者',summary:'原始摘要，不应因界面语言变化而改写。',body:'<p>保留原始正文。</p>'});
        reasons[language]=result.items[0].reason;
      }
      expect(reasons['en-US,en;q=0.9']).not.toMatch(/[\u4e00-\u9fff]/);expect(reasons['en-US,en;q=0.9']).toMatch(/Science|science/);
      expect(reasons['vi-VN,vi;q=0.9']).not.toMatch(/[\u4e00-\u9fff]/);expect(reasons['vi-VN,vi;q=0.9']).not.toEqual(reasons['en-US,en;q=0.9']);
      expect(reasons['zh-TW,zh;q=0.9']).toMatch(/科學/);expect(reasons['zh-TW,zh;q=0.9']).not.toMatch(/科学|兴趣|来源/);
      expect(await getProfile(env)).toEqual(saved);expect(network).not.toHaveBeenCalled();expect(await env.DB.prepare('SELECT COUNT(*) n FROM reservations').first('n')).toBe(0);
    }finally{network.mockRestore();}
  });
  it('does not let invalid locale writes or anonymous callers overwrite preferences',async()=>{
    const before=await getProfile(env);
    expect((await handleApi(request('/api/profile',{method:'PUT',body:{language:'de'}}),env)).status).toBe(400);
    expect((await handleApi(request('/api/profile',{method:'PUT',body:{language:'vi'},user:false}),env)).status).toBe(401);
    expect((await handleApi(request('/api/profile',{method:'PUT',body:{language:'vi'},requestOrigin:'https://another.reader.net'}),env)).status).toBe(403);
    expect(await getProfile(env)).toEqual(before);
  });
  it('keeps the explicit profile-advice action behind authentication and same-origin checks',async()=>{
    const body={profile:await getProfile(env),language:'vi'};
    expect((await handleApi(request('/api/profile/advice',{method:'POST',body,user:false}),env)).status).toBe(401);
    expect((await handleApi(request('/api/profile/advice',{method:'POST',body,requestOrigin:'https://another.reader.net'}),env)).status).toBe(403);
    expect(await env.DB.prepare('SELECT COUNT(*) n FROM reservations').first('n')).toBe(0);
  });
  it('returns AI setup guidance without charging or saving an edited profile draft',async()=>{
    const before=await getProfile(env);const edited={...before,goals:['Learn to bake bread'],topicWeights:{cooking:1,science:.7}};
    const network=vi.spyOn(globalThis,'fetch').mockRejectedValue(new Error('No credentials, no model request'));
    try{
      const response=await handleApi(request('/api/profile/advice',{method:'POST',body:{profile:edited,language:'vi'}}),env);
      expect(response.status).toBe(200);expect(await response.json()).toMatchObject({needsConfiguration:true});expect(await getProfile(env)).toEqual(before);
      expect(await env.DB.prepare('SELECT COUNT(*) n FROM settings').first('n')).toBe(0);expect(await env.DB.prepare('SELECT COUNT(*) n FROM reservations').first('n')).toBe(0);expect(network).not.toHaveBeenCalled();
    }finally{network.mockRestore();}
  });
  it('rejects accidentally pasted credentials before any profile-advice provider call',async()=>{
    const before=await getProfile(env);const network=vi.spyOn(globalThis,'fetch').mockRejectedValue(new Error('Credential-like profile data must stay local'));
    try{
      const response=await handleApi(request('/api/profile/advice',{method:'POST',body:{profile:{...before,goals:['My API key is sk-profile-test-1234567890123456789012345']},language:'en'}}),env);
      expect(response.status).toBe(400);expect(await response.text()).not.toContain('sk-profile-test');expect(network).not.toHaveBeenCalled();expect(await getProfile(env)).toEqual(before);expect(await env.DB.prepare('SELECT COUNT(*) n FROM reservations').first('n')).toBe(0);
    }finally{network.mockRestore();}
  });
});
