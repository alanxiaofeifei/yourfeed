import {describe,it,expect} from 'vitest';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {getConfig,getProviderKey,publicConfig,saveConfig,type Env} from '../server/db';
function environment():Env {
 const db=new DatabaseSync(':memory:');for(const f of readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())db.exec(readFileSync('drizzle/'+f,'utf8'));
 const prepare=(sql:string)=>{const statement=db.prepare(sql);const bound=(args:any[])=>({run:async()=>({meta:{changes:Number(statement.run(...args).changes)}}),first:async()=>statement.get(...args)||null,all:async()=>({results:statement.all(...args)})});return {bind:(...args:any[])=>bound(args),...bound([])};};
 return {DB:{prepare,batch:async(statements:any[])=>Promise.all(statements.map(s=>s.run()))},APP_ENCRYPTION_KEY:'a1'.repeat(32)} as unknown as Env;
}
const custom={provider:'custom',model:'my-model-1',baseUrl:'https://models.example.com/v1',providerName:'My provider',protocol:'chat-completions',responseFormat:'json_object',inputPricePerMillion:1,outputPricePerMillion:2,enabled:false};
describe('advanced model profiles and key binding',()=>{
 it('preserves perprovider model/parameters and returns only masked secret metadata',async()=>{
  const env=environment();await saveConfig(env,{...custom,key:'custom-secret-12345678',temperature:.3,maxOutputTokens:1024});
  await saveConfig(env,{provider:'openai',model:'gpt-6-luna',temperature:.6,key:'openai-secret-12345678'});
  await saveConfig(env,{provider:'custom'});const config=await publicConfig(env);
  expect(config.model).toBe('my-model-1');expect(config.temperature).toBe(.3);expect(config.baseUrl).toContain('models.example.com');expect(config.keyLast4).toBe('5678');
  expect(JSON.stringify(config)).not.toContain('secret-12345678');expect(config.profiles.openai.model).toBe('gpt-6-luna');expect(await getProviderKey(env,'custom')).toBe('custom-secret-12345678');
 });
 it('requires a fresh key before changing customendpoint and keeps the old profile on rejection',async()=>{
  const env=environment();await saveConfig(env,{...custom,key:'old-custom-secret'});
  await expect(saveConfig(env,{provider:'custom',baseUrl:'https://another.example.com/v1'})).rejects.toThrow('密钥');
  expect((await getConfig(env,'custom')).baseUrl).toContain('models.example.com');
  await saveConfig(env,{provider:'custom',baseUrl:'https://another.example.com/v1',key:'new-custom-secret'});
  expect(await getProviderKey(env,'custom')).toBe('new-custom-secret');
 });
 it('requires explicit custom prices before enabling and clears old prices for a changed model',async()=>{
  const env=environment();await expect(saveConfig(env,{...custom,enabled:true,inputPricePerMillion:null})).rejects.toThrow('价格');
  await saveConfig(env,{...custom});await saveConfig(env,{provider:'custom',model:'different-model',enabled:false});
  expect((await getConfig(env)).inputPricePerMillion).toBeUndefined();
  await expect(saveConfig(env,{enabled:true})).rejects.toThrow('价格');
 });
 it('treats nulladvancedfields as cleared and rejects unsafe endpoints or altered presets',async()=>{
  const env=environment();await saveConfig(env,{...custom,temperature:.3,reasoningEffort:'high'});
  await saveConfig(env,{provider:'custom',temperature:null,reasoningEffort:null,inputPricePerMillion:null,outputPricePerMillion:null});
  const config=await getConfig(env);expect(config.temperature).toBeUndefined();expect(config.reasoningEffort).toBe('');expect(config.inputPricePerMillion).toBeUndefined();
  await expect(saveConfig(env,{provider:'custom',baseUrl:'http://localhost/v1'})).rejects.toThrow();
  await expect(saveConfig(env,{provider:'openai',baseUrl:'https://untrusted.example.com/v1'})).rejects.toThrow('固定官方地址');
 });
 it('keeps an explicitly cleared OpenAI reasoning preference cleared after reload',async()=>{
  const env=environment();await saveConfig(env,{provider:'openai',model:'gpt-6.1-sol',reasoningEffort:null});
  expect((await getConfig(env)).reasoningEffort).toBe('');
 });

});
