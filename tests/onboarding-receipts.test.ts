import {afterAll,afterEach,beforeAll,beforeEach,describe,expect,it,vi} from 'vitest';
import {Miniflare} from 'miniflare';
import {readFileSync,readdirSync} from 'node:fs';
import {handleApi} from '../server/api';
import {getConfig,saveConfig,type Env} from '../server/db';
import {getOnboarding,issueTestReceipt,testReceiptStorageKey,verifyTestReceipt} from '../server/onboarding';
import {testProvider} from '../server/ai';

let mf:Miniflare,env:Env,other:Env;
const identity={userId:'receipt-owner',origin:'https://receipt.test'},credential='synthetic-provider-credential-not-real';
const headers={'Content-Type':'application/json',Origin:identity.origin,'oai-authenticated-user-id':identity.userId};
async function api(path:string,body:unknown,method='POST',target=env){return handleApi(new Request(identity.origin+path,{method,headers,body:JSON.stringify(body)}),target);}
async function evidence(target=env,user=identity.userId){return (await getOnboarding(target,user)).evidence;}
async function stored(id:string,target=env){return (await target.DB.prepare('SELECT json FROM settings WHERE id=?').bind(id).first<{json:string}>())?.json;}
function providerResponse(){return new Response(JSON.stringify({output:[{content:[{type:'output_text',text:'OK'}]}],usage:{input_tokens:2,output_tokens:1}}),{headers:{'Content-Type':'application/json'}});}
async function token(overrides:Record<string,unknown>={}){const response=await api('/api/test-provider',{key:credential,...overrides});expect(response.status).toBe(200);const result=await response.json() as any;expect(typeof result.testReceipt).toBe('string');return result.testReceipt as string;}
beforeAll(async()=>{
  mf=new Miniflare({modules:true,script:'export default {fetch(){return new Response("fixture")}}',d1Databases:{DB:'receipts',OTHER:'receipts-other'},compatibilityDate:'2026-05-15'});
  env={DB:await mf.getD1Database('DB') as unknown as Env['DB'],AUTH_MODE:'sites',APP_ENCRYPTION_KEY:'ab'.repeat(32)};other={...env,DB:await mf.getD1Database('OTHER') as unknown as Env['DB']};
  for(const target of [env,other])for(const file of readdirSync('drizzle').filter(file=>file.endsWith('.sql')).sort())for(const sql of readFileSync('drizzle/'+file,'utf8').split('--> statement-breakpoint').map(sql=>sql.trim()).filter(Boolean))await target.DB.exec(sql.replace(/\r?\n/g,' '));
},60000);
beforeEach(async()=>{for(const target of [env,other]){delete target.OPENAI_API_KEY;await target.DB.batch(['settings','meta','reservations'].map(table=>target.DB.prepare('DELETE FROM '+table)));}vi.stubGlobal('fetch',vi.fn(async(url:unknown)=>String(url).startsWith('https://cloudflare-dns.com/')?new Response(JSON.stringify({Status:0,Answer:[{type:1,data:'93.184.216.34'}]})):providerResponse()));});
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();});
afterAll(async()=>{await mf?.dispose();});

describe('opaque account/instance-bound connection-test receipts',()=>{
  it('tests draft without saving credentials; API save binds proof to exact saved configuration',async()=>{
    const testReceipt=await token({temperature:null,reasoningEffort:null,maxOutputTokens:2048,timeoutSeconds:25});
    const claims=JSON.parse(atob(testReceipt.replace(/-/g,'+').replace(/_/g,'/')));expect(Object.keys(claims).sort()).toEqual(['expiresAt','issuedAt','nonce','tag','v']);expect(JSON.stringify(claims)).not.toContain(credential);
    expect(await stored('key:openai')).toBeUndefined();expect(await stored('config')).toBeUndefined();expect((await evidence()).aiTested).toBe(false);
    const saved=await api('/api/settings',{key:credential,temperature:null,reasoningEffort:null,maxOutputTokens:2048,timeoutSeconds:25,testReceipt},'PUT');expect(saved.status).toBe(200);
    expect(await evidence()).toMatchObject({aiConfigured:true,aiEnabled:false,aiTested:true,aiVerification:'connection_test',aiTestedAt:expect.any(String)});
    const publicSettings=JSON.stringify(await saved.json());expect(publicSettings).not.toContain('testReceipt');expect(publicSettings).not.toContain('configRevision');expect(publicSettings).not.toContain('credentialRevision');
    const proof=JSON.parse((await stored(testReceiptStorageKey(env,identity.userId)))!);expect(Object.keys(proof).sort()).toEqual(['configRevision','credentialRevision','expiresAt','nonce','testedAt']);
    const text=JSON.stringify(await getOnboarding(env,identity.userId));for(const privateValue of [testReceipt,credential,'cipher','credentialRevision','configRevision'])expect(text).not.toContain(privateValue);
  });
  it('binds existing stored credential and partial PUT to its normalized effective configuration',async()=>{
    await saveConfig(env,{key:credential,temperature:0.4,maxOutputTokens:512});
    const response=await api('/api/test-provider',{}),result=await response.json() as any;expect(response.status).toBe(200);expect(result.testReceipt).toBeTruthy();
    expect((await api('/api/settings',{testReceipt:result.testReceipt},'PUT')).status).toBe(200);expect((await evidence()).aiTested).toBe(true);
  });
  it('upgrades legacy encrypted credentials only on explicit matching save without key reentry',async()=>{
    await saveConfig(env,{key:credential});await env.DB.prepare("UPDATE settings SET json=json_remove(json,'$.credentialRevision') WHERE id=?").bind('key:openai').run();
    const legacyRaw=(await stored('key:openai'))!,legacy=JSON.parse(legacyRaw);expect(legacy.credentialRevision).toBeUndefined();
    const response=await api('/api/test-provider',{}),result=await response.json() as any;expect(response.status).toBe(200);expect(result.testReceipt).toBeTruthy();
    expect(await stored('key:openai')).toBe(legacyRaw);expect((await evidence()).aiTested).toBe(false);
    expect((await api('/api/settings',{testReceipt:result.testReceipt},'PUT')).status).toBe(200);
    const upgraded=JSON.parse((await stored('key:openai'))!);expect(upgraded.credentialRevision).toEqual(expect.any(String));expect(upgraded.cipher).toBe(legacy.cipher);expect(upgraded.last4).toBe(legacy.last4);expect((await evidence()).aiTested).toBe(true);
  });
  it('also matches custom endpoint/protocol/parameters and never claims structured-output validation',async()=>{
    const draft={provider:'custom',model:'synthetic-model',baseUrl:'https://api.public-example.net/v1',protocol:'chat-completions',responseFormat:'json_object',reasoningEffort:null,temperature:0.2,maxOutputTokens:256,timeoutSeconds:30,inputPricePerMillion:0,outputPricePerMillion:0,key:credential};
    vi.stubGlobal('fetch',vi.fn(async(url:unknown)=>String(url).startsWith('https://cloudflare-dns.com/')?new Response(JSON.stringify({Status:0,Answer:[{type:1,data:'93.184.216.34'}]})):new Response(JSON.stringify({choices:[{message:{content:'OK'}}],usage:{prompt_tokens:2,completion_tokens:1}}))));
    const testReceipt=await token(draft);expect((await api('/api/settings',{...draft,testReceipt},'PUT')).status).toBe(200);expect(await evidence()).toMatchObject({aiTested:true,aiVerification:'connection_test'});
  });
  it('does not bypass a stored custom credential endpoint binding when acknowledging a draft test',async()=>{
    const oldBase='https://old.public-example.net/v1',newBase='https://new.public-example.net/v1';
    const draft={provider:'custom',model:'synthetic-model',baseUrl:oldBase,protocol:'chat-completions',responseFormat:'json_object',inputPricePerMillion:0,outputPricePerMillion:0,key:credential};
    await saveConfig(env,draft);
    // Simulate pre-existing inconsistent endpoint configuration; key stays bound
    // to the old endpoint, despite the active profile naming the new endpoint.
    await env.DB.prepare("UPDATE settings SET json=json_set(json,'$.baseUrl',?) WHERE id IN ('config','profile:custom')").bind(newBase).run();
    const keyBefore=await stored('key:custom');
    vi.stubGlobal('fetch',vi.fn(async(url:unknown)=>String(url).startsWith('https://cloudflare-dns.com/')?new Response(JSON.stringify({Status:0,Answer:[{type:1,data:'93.184.216.34'}]})):new Response(JSON.stringify({choices:[{message:{content:'OK'}}],usage:{prompt_tokens:2,completion_tokens:1}}))));
    const testReceipt=await token({provider:'custom',baseUrl:newBase,key:credential});
    expect((await api('/api/settings',{testReceipt},'PUT')).status).toBe(200);
    expect(await stored('key:custom')).toBe(keyBefore);expect(await stored(testReceiptStorageKey(env,identity.userId))).toBeUndefined();
    expect(await evidence()).toMatchObject({aiConfigured:false,aiTested:false,aiVerification:'not_recorded'});
  });
  it('rejects tampering, expiry, future issuance, changed key/config/account/origin without failing product save',async()=>{
    const config=await getConfig(env),now=Date.now();const valid=(await issueTestReceipt(env,identity,config,credential,now))!;
    expect(await verifyTestReceipt(env,identity,config,credential,valid,now)).toBeTruthy();
    for(const [target,who,configuration,key,receipt,time] of [
      [env,identity,config,credential,valid.slice(0,-2)+'xx',now],
      [env,identity,config,credential,valid,now+600000],
      [env,identity,config,credential,valid,now-1],
      [env,{...identity,userId:'another-owner'},config,credential,valid,now],
      [env,{...identity,origin:'https://other.test'},config,credential,valid,now],
      [env,identity,{...config,model:'other-model'},credential,valid,now],
      [env,identity,config,'different-credential',valid,now],
    ] as const)expect(await verifyTestReceipt(target,who,configuration,key,receipt,time)).toBeUndefined();
    expect((await api('/api/settings',{key:credential,temperature:0.7,testReceipt:valid},'PUT')).status).toBe(200);expect((await evidence()).aiTested).toBe(false);
  });
  it('prevents replay across actual databases even with the same account, encryption key and namespace',async()=>{
    const config=await getConfig(env),receipt=(await issueTestReceipt(env,identity,config,credential))!;
    await issueTestReceipt(other,identity,config,credential);expect(await verifyTestReceipt(other,identity,config,credential,receipt)).toBeUndefined();
    expect((await api('/api/settings',{key:credential,testReceipt:receipt},'PUT',other)).status).toBe(200);expect((await evidence(other)).aiTested).toBe(false);
    expect(await stored(testReceiptStorageKey(other,identity.userId),other)).toBeUndefined();
  });
  it('invalidates current proof after any settings save, key replacement/removal, and expiry',async()=>{
    const receipt=await token();await saveConfig(env,{key:credential,testReceipt:receipt},identity);expect((await evidence()).aiTested).toBe(true);
    expect((await evidence(env,'another-owner')).aiTested).toBe(false);
    await saveConfig(env,{enabled:true});expect((await evidence()).aiTested).toBe(false);
    await saveConfig(env,{key:credential,testReceipt:receipt},identity);expect((await evidence()).aiTested).toBe(true);
    await saveConfig(env,{key:'replacement-synthetic-credential'});expect((await evidence()).aiTested).toBe(false);
    await saveConfig(env,{key:credential,testReceipt:receipt},identity);await saveConfig(env,{clearKey:true});expect((await evidence()).aiTested).toBe(false);
    await saveConfig(env,{key:credential,testReceipt:receipt},identity);const time=vi.spyOn(Date,'now').mockReturnValue(Date.now()+600001);expect((await evidence()).aiTested).toBe(false);time.mockRestore();
  });
  it('does not promote environment-fallback credentials without a stored rotation revision',async()=>{
    env.OPENAI_API_KEY=credential;const result=await testProvider(env,{},identity);expect(result.testReceipt).toBeTruthy();await saveConfig(env,{testReceipt:result.testReceipt},identity);expect(await evidence()).toMatchObject({aiConfigured:true,aiTested:false});expect(await stored('key:openai')).toBeUndefined();
  });
  it('never creates proof from failed tests and signing failure cannot fail successful billed test',async()=>{
    const failSigning={...env,APP_ENCRYPTION_KEY:undefined};const successful=await testProvider(failSigning,{key:credential},identity);expect(successful.ok).toBe(true);expect(successful.testReceipt).toBeUndefined();
    vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify({error:{message:'synthetic rejection'}}),{status:401})));
    expect((await api('/api/test-provider',{key:credential})).status).not.toBe(200);expect(await stored(testReceiptStorageKey(env,identity.userId))).toBeUndefined();
  });
  it.each([false,true])('does not pair an old-key receipt with a concurrently rotated credential revision (legacy=%s)',async(legacy)=>{
    await saveConfig(env,{key:credential});if(legacy)await env.DB.prepare("UPDATE settings SET json=json_remove(json,'$.credentialRevision') WHERE id=?").bind('key:openai').run();const testReceipt=(await testProvider(env,{},identity)).testReceipt!;
    const originalBatch=env.DB.batch.bind(env.DB);let rotate=true;
    const db=new Proxy(env.DB,{get(target,property){if(property==='batch')return async(statements:any[])=>{if(rotate){rotate=false;await saveConfig(env,{key:'concurrent-rotated-credential'});}return originalBatch(statements);};const value=Reflect.get(target,property);return typeof value==='function'?value.bind(target):value;}}) as Env['DB'];
    await saveConfig({...env,DB:db},{testReceipt},identity);
    expect(await evidence()).toMatchObject({aiConfigured:true,aiTested:false});
    const key=JSON.parse((await stored('key:openai'))!),proof=JSON.parse((await stored(testReceiptStorageKey(env,identity.userId)))!);expect(proof.credentialRevision).not.toBe(key.credentialRevision);
  });
  it('rolls back an optional proof failure and retries product-only writes, but propagates product failure',async()=>{
    const testReceipt=await token();
    // Exercise an actual D1 transaction rollback, not just a mocked rejection.
    await env.DB.exec("CREATE TRIGGER reject_optional_proof BEFORE INSERT ON settings WHEN NEW.id LIKE 'onboarding:%:ai-test' BEGIN SELECT RAISE(ABORT,'synthetic proof failure'); END");
    try{await expect(saveConfig(env,{key:credential,testReceipt},identity)).resolves.toMatchObject({configured:true});expect((await evidence()).aiTested).toBe(false);expect(await stored(testReceiptStorageKey(env,identity.userId))).toBeUndefined();}finally{await env.DB.exec('DROP TRIGGER reject_optional_proof');}
    const failedDb=new Proxy(env.DB,{get(target,property){if(property==='batch')return async()=>{throw new Error('product unavailable');};const value=Reflect.get(target,property);return typeof value==='function'?value.bind(target):value;}}) as Env['DB'];
    await expect(saveConfig({...env,DB:failedDb},{key:credential,testReceipt},identity)).rejects.toThrow('product unavailable');
  });
});
