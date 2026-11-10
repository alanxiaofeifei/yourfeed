import {afterAll,beforeAll,describe,expect,it} from 'vitest';
import {Miniflare} from 'miniflare';
import {build} from 'esbuild';

/** Exercise the real adapter in workerd: Node fetch accepts redirect:error, but
 * the deployed Worker does not. All outbound requests terminate in this fixture. */
describe('Provider HTTP boundary in actual Cloudflare workerd',()=>{
 let worker:Miniflare;const calls:{url:string;method:string}[]=[];let redirect=false;
 beforeAll(async()=>{
  const entry=`import {callModel,probeProviderModels} from './server/ai.ts';
  export default {async fetch(request){const url=new URL(request.url);const provider=url.searchParams.get('provider')||'openai';const config={provider,model:provider==='openai'?'gpt-6.1-sol':provider==='deepseek'?'deepseek-flash':'fixture/model',baseUrl:'https://models.vendor.net/v1',protocol:provider==='openai'?'responses':'chat-completions',enabled:true,monthlyBudget:20,dailyLimit:20,maxOutputTokens:2048,timeoutSeconds:10};
  try{const result=url.pathname==='/probe'?await probeProviderModels(config,'worker-fixture-key'):await callModel(config,'worker-fixture-key','Reply only OK.',true);return Response.json({ok:true,result});}catch(error){return Response.json({ok:false,diagnostic:error.diagnostic||null,error:error.message});}}};`;
  const bundled=await build({stdin:{contents:entry,resolveDir:process.cwd(),sourcefile:'provider-worker-fixture.ts',loader:'ts'},bundle:true,write:false,format:'esm',platform:'neutral',target:'es2022',external:['node:*'],logLevel:'silent'});
  worker=new Miniflare({modules:true,script:bundled.outputFiles[0].text,compatibilityDate:'2026-05-15',compatibilityFlags:['nodejs_compat'],outboundService:async (request:{url:string;method:string})=>{
   calls.push({url:request.url,method:request.method});const url=new URL(request.url);
   if(url.hostname==='cloudflare-dns.com')return Response.json({Status:0,Answer:[{type:1,data:'93.184.216.34'}]});
   if(redirect)return new Response('blocked redirect',{status:302,headers:{Location:'https://redirect-target.vendor.net/steal'}});
   if(url.pathname.endsWith('/models'))return Response.json({data:[{id:'gpt-6.1-sol'}]});
   return Response.json(url.pathname.endsWith('/responses')?{output_text:'OK',usage:{input_tokens:8,output_tokens:1}}:{choices:[{message:{content:'OK'}}],usage:{prompt_tokens:8,completion_tokens:1}});
  }});
 },20000);
 afterAll(async()=>{await worker?.dispose();});
 it.each(['openai','deepseek'])('sends %s generation successfully through workerd without unsupported redirect options',async provider=>{
  redirect=false;calls.length=0;const response=await worker.dispatchFetch('https://fixture.local/?provider='+provider);const body=await response.json() as any;
  expect(body.ok).toBe(true);expect(body.result.text).toBe('OK');expect(calls).toHaveLength(1);expect(calls[0].method).toBe('POST');
 });
 it('validates custom-provider DNS and sends the request in the same deployed runtime',async()=>{
  redirect=false;calls.length=0;const response=await worker.dispatchFetch('https://fixture.local/?provider=custom');const body=await response.json() as any;
  expect(body.ok).toBe(true);expect(body.result.text).toBe('OK');expect(calls.filter(call=>call.url.startsWith('https://cloudflare-dns.com/'))).toHaveLength(2);expect(calls.filter(call=>call.method==='POST')).toHaveLength(1);
 });
 it('refuses an upstream redirect without sending a second credentialed request',async()=>{
  redirect=true;calls.length=0;const response=await worker.dispatchFetch('https://fixture.local/?provider=openai');const body=await response.json() as any;
  expect(body.ok).toBe(false);expect(body.diagnostic.code).toBe('provider_redirect_blocked');expect(body.diagnostic.upstreamStatus).toBe(302);expect(calls).toHaveLength(1);expect(calls[0].url).not.toContain('redirect-target');redirect=false;
 });
 it('performs the metadata probe with GET and no inference request',async()=>{
  calls.length=0;const response=await worker.dispatchFetch('https://fixture.local/probe?provider=openai');const body=await response.json() as any;
  expect(body.ok).toBe(true);expect(body.result).toMatchObject({reachable:true,status:200,modelListed:true});expect(calls).toEqual([{url:'https://api.openai.com/v1/models',method:'GET'}]);
 });
});
