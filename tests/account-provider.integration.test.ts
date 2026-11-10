import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Miniflare } from 'miniflare';
import { readFileSync, readdirSync } from 'node:fs';
import { handleApi } from '../server/api';
import { getConfig, getProviderKey, type Env } from '../server/db';
import { encryptSecret } from '../server/security';

let mf: Miniflare;
let env: Env;
const tables=['analysis_cache','content','feedback','meta','reservations','settings','sources'];
function request(path:string,method='GET',body?:unknown,authenticated=true) {
  const headers:Record<string,string>={};
  if(authenticated)headers['oai-authenticated-user-id']='account-integration-owner';
  if(body!==undefined){headers['content-type']='application/json';headers.origin='https://yourfeed.test';}
  return new Request('https://yourfeed.test'+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body)});
}
async function api(method:string,body?:unknown) {
  const response=await handleApi(request('/api/settings',method,body),env);
  return {status:response.status,value:await response.json() as any};
}
const custom={provider:'custom',providerName:'My gateway',model:'vendor/my-model',baseUrl:'https://openrouter.ai/api/v1',protocol:'chat-completions',inputPricePerMillion:1,outputPricePerMillion:3,enabled:true};
beforeAll(async()=>{
  mf=new Miniflare({modules:true,script:'export default {fetch(){return new Response("test")}}',d1Databases:{DB:'account-provider-test-db'},compatibilityDate:'2026-05-15'});
  env={AUTH_MODE:'sites',DB:await mf.getD1Database('DB') as unknown as Env['DB'],APP_ENCRYPTION_KEY:'b'.repeat(64)};
  for(const file of readdirSync('drizzle').filter(x=>x.endsWith('.sql')).sort())for(const statement of readFileSync('drizzle/'+file,'utf8').split('--> statement-breakpoint').map(x=>x.trim()).filter(Boolean))await env.DB.exec(statement.replace(/\r?\n/g,' '));
},60000);
beforeEach(async()=>{await env.DB.batch(tables.map(name=>env.DB.prepare('DELETE FROM '+name)));});
afterAll(async()=>{await mf?.dispose();});

describe('account and provider persistence integration',()=>{
 it('exposes an anonymous session without accessing private storage or fabricating an account',async()=>{
  const result=await handleApi(request('/api/session','GET',undefined,false),env);
  expect(result.status).toBe(200);
  const body=await result.json() as any;
  expect(body.authenticated).toBe(false);expect(body.user).toBeUndefined();
  expect(body.signInPath).toBe('/signin-with-chatgpt?return_to=%2F');
  expect(body.signOutPath).toBe('/signout-with-chatgpt?return_to=%2F');
  expect((await handleApi(request('/api/settings','GET',undefined,false),env)).status).toBe(401);
 });
 it('decodes trusted identity display data while keeping credentials out of session responses',async()=>{
  const req=request('/api/session');req.headers.set('oai-authenticated-user-email','owner@example.org');
  req.headers.set('oai-authenticated-user-full-name',encodeURIComponent('测试用户'));
  req.headers.set('oai-authenticated-user-full-name-encoding','percent-encoded-utf-8');
  const response=await handleApi(req,env);const body=await response.json() as any;
  expect(body).toMatchObject({authenticated:true,user:{id:'account-integration-owner',name:'测试用户',email:'owner@example.org'}});
  expect(JSON.stringify(body)).not.toContain('cipher');
 });
 it('reads legacy settings and encrypted keys without a migration or data loss',async()=>{
  const legacy={provider:'openai',model:'gpt-6.1-sol',enabled:true,monthlyBudget:17,dailyLimit:9};
  const key='legacy-test-key-ABCDEFGH';const cipher=await encryptSecret(key,env.APP_ENCRYPTION_KEY,'yourfeed:openai');
  await env.DB.batch([env.DB.prepare('INSERT INTO settings(id,json) VALUES (?,?)').bind('config',JSON.stringify(legacy)),env.DB.prepare('INSERT INTO settings(id,json) VALUES (?,?)').bind('key:openai',JSON.stringify({cipher,last4:'EFGH'}))]);
  const config=await getConfig(env);expect(config).toMatchObject(legacy);expect(await getProviderKey(env,'openai')).toBe(key);
  const result=await api('GET');expect(result.value.keyLast4).toBe('EFGH');expect(JSON.stringify(result.value)).not.toContain(key);
 });
 it('round-trips encrypted custom credentials and independently remembers provider profiles',async()=>{
  const key='custom-test-key-12345678';
  expect((await api('PUT',{...custom,key,temperature:0.4,maxOutputTokens:4096})).status).toBe(200);
  const switched=await api('PUT',{provider:'deepseek'});expect(switched.status).toBe(200);
  const back=await api('PUT',{provider:'custom'});expect(back.status).toBe(200);
  expect(back.value).toMatchObject({...custom,temperature:0.4,maxOutputTokens:4096,configured:true});
  expect(back.value.profiles.custom.baseUrl).toBe(custom.baseUrl);
  expect(await getProviderKey(env,'custom')).toBe(key);
  const stored=await env.DB.prepare('SELECT json FROM settings WHERE id=?').bind('key:custom').first<string>('json');
  expect(stored).not.toContain(key);expect(JSON.stringify(back.value)).not.toContain(key);
 });
 it('rejects rebinding an existing key and leaves the old profile intact',async()=>{
  await api('PUT',{...custom,key:'first-custom-test-secret'});
  const result=await api('PUT',{provider:'custom',baseUrl:'https://api.moonshot.cn/v1'});
  expect(result.status).toBe(400);expect((await getConfig(env)).baseUrl).toBe(custom.baseUrl);
  expect(await getProviderKey(env,'custom')).toBe('first-custom-test-secret');
  const rebound=await api('PUT',{provider:'custom',baseUrl:'https://api.moonshot.cn/v1',key:'replacement-custom-test-secret'});
  expect(rebound.status).toBe(200);expect(await getProviderKey(env,'custom')).toBe('replacement-custom-test-secret');
 });
 it('requires explicit custom pricing before activation and rejects unsafe or official-key redirect addresses',async()=>{
  const {inputPricePerMillion:_i,outputPricePerMillion:_o,...withoutPrices}=custom;
  expect((await api('PUT',{...withoutPrices,key:'unused-test-secret'})).status).toBe(400);
  expect(await env.DB.prepare('SELECT COUNT(*) AS count FROM settings').first('count')).toBe(0);
  expect((await api('PUT',{...custom,baseUrl:'https://127.0.0.1/v1',key:'unused-test-secret'})).status).toBe(400);
  expect((await api('PUT',{provider:'openai',model:'gpt-6.1-sol',baseUrl:'https://openrouter.ai/api/v1',key:'unused-test-secret'})).status).toBe(400);
 });
 it('saves configuration without issuing provider network calls',async()=>{
  const network=vi.spyOn(globalThis,'fetch').mockRejectedValue(new Error('Unexpected network'));
  try{expect((await api('PUT',{...custom,key:'save-only-custom-test-key'})).status).toBe(200);expect(network).not.toHaveBeenCalled();}finally{network.mockRestore();}
 });
});
