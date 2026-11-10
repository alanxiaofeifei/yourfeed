import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import type { ContentItem } from '../shared/types';
import { createProfile } from '../shared/profile';

const state = vi.hoisted(() => ({
  config: {provider:'openai',model:'gpt-6.1-sol',enabled:true,monthlyBudget:20,dailyLimit:20} as any,
  key: 'test-secret-not-a-real-key' as string | undefined,
  cache: new Map<string,any>(), reservations:new Map<string,any>(), items:[] as any[],sources:[] as any[],feedback:{} as Record<string,any>,profiles:{} as Record<string,any>,profile:{} as any,
}));
vi.mock('../server/profile',()=>({getProfile:vi.fn(async()=>state.profile)}));
vi.mock('../server/db', () => ({
  getConfig:vi.fn(async(_env,provider)=>provider&&state.profiles[provider]?state.profiles[provider]:state.config), getProviderKey:vi.fn(async()=>state.key),
  getAnalysisCache:vi.fn(async(_env,id,fingerprint,provider,model)=>state.cache.get([id,fingerprint,provider,model].join('|'))||null),
  saveAnalysisCache:vi.fn(async(_env,id,fingerprint,provider,model,value)=>{state.cache.set([id,fingerprint,provider,model].join('|'),value);}),
  listContent:vi.fn(async()=>state.items),listSources:vi.fn(async()=>state.sources),readFeedback:vi.fn(async()=>state.feedback),upsertContent:vi.fn(async()=>{}),
  usagePeriod:vi.fn((_timezone?:string)=>({day:'2026-11-10',month:'2026-11'})),
  reserveUsage:vi.fn(async(_env,reservation)=>{
    const all=[...state.reservations.values()];
    if(all.reduce((sum,x)=>sum+x.reserved,0)+reservation.maxCost>reservation.monthlyBudget)return false;
    if(!reservation.isTest && all.filter(x=>!x.isTest && x.status!=='failed').length>=reservation.dailyLimit)return false;
    if(!reservation.isTest && all.some(x=>x.contentId===reservation.contentId&&x.status==='reserved'))return false;
    state.reservations.set(reservation.reservationId,{...reservation,reserved:reservation.maxCost,status:'reserved'});return true;
  }),
  settleUsage:vi.fn(async(_env,settlement)=>{const row=state.reservations.get(settlement.reservationId);if(!settlement.uncertain&&row)Object.assign(row,{reserved:settlement.cost,status:settlement.success?'settled':'failed',cost:settlement.cost});}),
}));
import * as db from '../server/db';
import { analyzeItem, analyzePending, testProvider, probeProviderModels, sourceCoverage, contentFingerprint, validateAnalysis, sourceReferences } from '../server/ai';

const env={} as any;
const item: ContentItem={id:'item-1',kind:'article',platform:'RSS',sourceId:'rss-test',sourceName:'技术原文',title:'Linux 网络故障排查',url:'https://example.com/article',summary:'介绍 Linux 网络故障的排查过程，使用实际命令验证连接状态，逐步定位 DHCP、DNS、网关和防火墙等不同故障来源。',body:'排查过程与证据。'.repeat(80),topics:['it','network','linux'],publishedAt:'2026-11-10T00:00:00Z'};
const valid={bullets:['先核实本机地址，再检查网关与 DNS。'],relevance:'适合补齐现场 IT 排障的网络基础。',topics:['network','linux'],references:[item.url]};
function response(value:unknown=valid,provider='openai') {
  return new Response(JSON.stringify(provider==='openai'?{output:[{content:[{type:'output_text',text:JSON.stringify(value)}]}],usage:{input_tokens:1000,output_tokens:150}}:{choices:[{message:{content:JSON.stringify(value)}}],usage:{prompt_tokens:1000,completion_tokens:150}}),{status:200,headers:{'Content-Type':'application/json'}});
}
let fetchMock:ReturnType<typeof vi.fn>;
beforeEach(()=>{
  vi.clearAllMocks();state.config={provider:'openai',model:'gpt-6.1-sol',enabled:true,monthlyBudget:20,dailyLimit:20};state.key='test-secret-not-a-real-key';state.cache.clear();state.reservations.clear();state.items=[item];state.sources=[];state.feedback={};state.profiles={};state.profile=createProfile('it-ai');
  fetchMock=vi.fn(async()=>response());vi.stubGlobal('fetch',fetchMock);
});

describe('Custom OpenAI-compatible providers',()=>{
  function custom(overrides:Record<string,unknown>={}){
    state.config={...state.config,provider:'custom',model:'vendor/arbitrary-model:free',baseUrl:'https://api.vendor.net/v1',protocol:'chat-completions',responseFormat:'json_object',inputPricePerMillion:0.3,outputPricePerMillion:1.2,...overrides};
    fetchMock.mockImplementation(async(url:string)=>url.startsWith('https://cloudflare-dns.com/')?new Response(JSON.stringify({Status:0,Answer:[{type:1,data:'93.184.216.34'}]})):response(valid,'custom'));
  }
  function modelCalls(){return fetchMock.mock.calls.filter(([url])=>!String(url).startsWith('https://cloudflare-dns.com/'));}
  it('supports arbitrary models, explicit params and plain JSON mode over chat completions',async()=>{
    custom({temperature:0.4,maxOutputTokens:1024,timeoutSeconds:40});await analyzeItem(env,item);
    const [url,request]=modelCalls()[0] as unknown as [string,RequestInit];const body=JSON.parse(String(request.body));
    expect(url).toBe('https://api.vendor.net/v1/chat/completions');expect(body.model).toBe('vendor/arbitrary-model:free');expect(body.temperature).toBe(0.4);expect(body.max_tokens).toBe(1024);expect(body.response_format).toEqual({type:'json_object'});expect(body.reasoning_effort).toBeUndefined();expect(body.thinking).toBeUndefined();expect(request.redirect).toBe('manual');expect(Object.keys(request.headers as object)).toEqual(['Content-Type','Authorization']);
    expect(db.reserveUsage).toHaveBeenCalledWith(env,expect.objectContaining({maxCost:expect.any(Number)}));
  });
  it('supports Responses protocol and an explicitly configured reasoning effort',async()=>{
    custom({protocol:'responses',responseFormat:'json_schema',reasoningEffort:'medium'});
    fetchMock.mockImplementation(async(url:string)=>url.startsWith('https://cloudflare-dns.com/')?new Response(JSON.stringify({Status:0,Answer:[{type:1,data:'93.184.216.34'}]})):response());
    await analyzeItem(env,item);const body=JSON.parse(String((modelCalls()[0][1] as RequestInit).body));expect(modelCalls()[0][0]).toBe('https://api.vendor.net/v1/responses');expect(body.reasoning).toEqual({effort:'medium'});expect(body.text.format.type).toBe('json_schema');
  });
  it('omits provider output-format parameters when none is selected, but still validates returned analysis',async()=>{
    custom({responseFormat:'none'});await analyzeItem(env,item);const body=JSON.parse(String((modelCalls()[0][1] as RequestInit).body));expect(body.response_format).toBeUndefined();
  });
  it('requires explicit finite custom prices and supports an explicitly free model',async()=>{
    custom({inputPricePerMillion:undefined});await expect(analyzeItem(env,item)).rejects.toThrow('单价');expect(fetchMock).not.toHaveBeenCalled();
    state.config.inputPricePerMillion=0;state.config.outputPricePerMillion=0;await analyzeItem(env,item);expect(db.reserveUsage).toHaveBeenCalledWith(env,expect.objectContaining({maxCost:0}));
  });
  it('blocks private DNS before forwarding credentials and releases the unused reservation',async()=>{
    custom();fetchMock.mockImplementation(async()=>new Response(JSON.stringify({Status:0,Answer:[{type:1,data:'169.254.169.254'}]})));
    await expect(analyzeItem(env,item)).rejects.toThrow('非公开');expect(modelCalls()).toHaveLength(0);expect(db.settleUsage).toHaveBeenCalledWith(env,expect.objectContaining({uncertain:false,cost:0}));
  });
  it('requires a fresh key for a changed custom base and never loads the old credential',async()=>{
    custom();await expect(testProvider(env,{provider:'custom',baseUrl:'https://another.vendor.net/v1'})).rejects.toThrow('重新填写');expect(db.getProviderKey).not.toHaveBeenCalled();expect(fetchMock).not.toHaveBeenCalled();
  });
  it('accepts a fresh key for a changed endpoint and keeps saved budget limits',async()=>{
    custom();await testProvider(env,{baseUrl:'https://another.vendor.net/v1',key:'fresh-endpoint-key',monthlyBudget:999});
    const [url,request]=modelCalls()[0] as unknown as [string,RequestInit];expect(url).toBe('https://another.vendor.net/v1/chat/completions');expect((request.headers as any).Authorization).toBe('Bearer fresh-endpoint-key');expect(db.reserveUsage).toHaveBeenCalledWith(env,expect.objectContaining({monthlyBudget:20}));
  });
  it('invalidates cached analysis when endpoint or generation parameters change',async()=>{
    custom();await analyzeItem(env,item);await analyzeItem(env,item);expect(modelCalls()).toHaveLength(1);
    state.config.temperature=0.8;await analyzeItem(env,item);expect(modelCalls()).toHaveLength(2);
    state.config.baseUrl='https://another.vendor.net/v1';await analyzeItem(env,item);expect(modelCalls()).toHaveLength(3);
    expect((await analyzeItem(env,item)).analysis?.model).toBe('vendor/arbitrary-model:free');
  });
  it('reserves the configured output ceiling instead of the legacy fixed cap',async()=>{
    custom({maxOutputTokens:8192});await analyzeItem(env,item);
    const reservation=(db.reserveUsage as any).mock.calls[0][1];expect(reservation.maxCost).toBeGreaterThan(8192*1.2/1e6);
  });
  it('does not forward credentials on redirects or leak endpoint/error text',async()=>{
    custom();fetchMock.mockImplementation(async(url:string)=>url.startsWith('https://cloudflare-dns.com/')?new Response(JSON.stringify({Status:0,Answer:[{type:1,data:'93.184.216.34'}]})):new Response('https://private.vendor.net key-secret',{status:302,headers:{Location:'https://private.vendor.net'}}));
    await expect(analyzeItem(env,item)).rejects.toMatchObject({diagnostic:{code:'provider_redirect_blocked',upstreamStatus:302}});expect(modelCalls()).toHaveLength(1);expect((modelCalls()[0][1] as RequestInit).redirect).toBe('manual');
  });
  it('honors explicitly cleared OpenAI reasoning without reintroducing its default',async()=>{
    state.config.reasoningEffort='';await analyzeItem(env,item);const payload=JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body));expect(payload.reasoning).toBeUndefined();
  });
});
afterEach(()=>vi.unstubAllGlobals());

describe('AI access, provider isolation and accounting',()=>{
  it('uses configured test output allowance instead of a hidden tiny cap',async()=>{
    state.config.maxOutputTokens=2048;await testProvider(env);const body=JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body));expect(body.max_output_tokens).toBe(2048);
  });
  it('keeps the generation failure even when a metadata-only probe succeeds',async()=>{
    const warn=vi.spyOn(console,'warn').mockImplementation(()=>{});
    fetchMock.mockImplementation(async(_url:string,options:RequestInit)=>{if(options.method==='POST')throw new TypeError('outbound network access is not allowed '+state.key);return new Response(JSON.stringify({data:[{id:'gpt-6.1-sol'}]}));});
    await expect(testProvider(env)).rejects.toMatchObject({diagnostic:{code:'provider_network_blocked',stage:'transport',billingUncertain:false,modelProbe:{reachable:true,status:200,modelListed:true}}});
    expect(fetchMock.mock.calls.map((call:any)=>call[1].method)).toEqual(['POST','GET']);expect(db.settleUsage).toHaveBeenCalledWith(env,expect.objectContaining({cost:0,uncertain:false}));expect(JSON.stringify(warn.mock.calls)).not.toContain(state.key);warn.mockRestore();
  });
  it.each([{}, {output:{}}, {output:[{content:null}]}, {choices:[]}])('does not report a successful test for empty/malformed 200 output: %j',async payload=>{
    const warn=vi.spyOn(console,'warn').mockImplementation(()=>{});fetchMock.mockImplementation(async(_url:string,options:RequestInit)=>new Response(JSON.stringify(options.method==='GET'?{}:payload)));
    await expect(testProvider(env)).rejects.toMatchObject({diagnostic:{code:'provider_empty_response',stage:'response',modelProbe:{reachable:true,status:200,modelListed:null}}});warn.mockRestore();
  });
  it('settles reported usage once for truncated reasoning output before returning failure',async()=>{
    const warn=vi.spyOn(console,'warn').mockImplementation(()=>{});fetchMock.mockImplementation(async(_url:string,options:RequestInit)=>new Response(JSON.stringify(options.method==='GET'?{data:[]}:{status:'incomplete',incomplete_details:{reason:'max_output_tokens'},output:[],usage:{input_tokens:1000,output_tokens:150}})));
    await expect(testProvider(env)).rejects.toMatchObject({diagnostic:{code:'provider_output_limit',billingUncertain:false}});expect(db.settleUsage).toHaveBeenCalledTimes(1);expect(db.settleUsage).toHaveBeenCalledWith(env,expect.objectContaining({cost:0.0035,inputTokens:1000,outputTokens:150,success:false,uncertain:false}));warn.mockRestore();
  });
  it('does not misdiagnose content-filtered incomplete output as a token-limit problem',async()=>{
    const warn=vi.spyOn(console,'warn').mockImplementation(()=>{});fetchMock.mockImplementation(async(_url:string,options:RequestInit)=>new Response(JSON.stringify(options.method==='GET'?{}:{status:'incomplete',incomplete_details:{reason:'content_filter'},output_text:'Partial text',usage:{input_tokens:10,output_tokens:5}})));
    await expect(testProvider(env)).rejects.toMatchObject({diagnostic:{code:'provider_incomplete_response',billingUncertain:false}});expect(db.settleUsage).toHaveBeenCalledTimes(1);warn.mockRestore();
  });
  it('treats model-list results as metadata reachability, not generation or billing validation',async()=>{
    fetchMock.mockResolvedValue(new Response(JSON.stringify({data:[{id:'another-model'}]})));expect(await probeProviderModels(state.config,state.key!)).toEqual({reachable:true,status:200,modelListed:false});expect((fetchMock.mock.calls[0][1] as RequestInit).method).toBe('GET');
  });
  it('does not call a model when the key is missing or AI is disabled',async()=>{
    state.key=undefined;await expect(analyzeItem(env,item)).rejects.toThrow('密钥');
    state.key='test-secret';state.config.enabled=false;await expect(analyzeItem(env,item)).rejects.toThrow('启用');
    expect(fetchMock).not.toHaveBeenCalled();expect(db.reserveUsage).not.toHaveBeenCalled();
  });
  it('uses the selected OpenAI model with low reasoning, structured output and no storage/tools',async()=>{
    const result=await analyzeItem(env,item);const [url,request]=fetchMock.mock.calls[0] as unknown as [string,RequestInit];const payload=JSON.parse(String(request.body));
    expect(url).toBe('https://api.openai.com/v1/responses');expect(payload.model).toBe('gpt-6.1-sol');expect(payload.reasoning).toEqual({effort:'low'});expect(payload.store).toBe(false);expect(payload.tools).toBeUndefined();expect(payload.text.format.strict).toBe(true);expect(result.analysis?.coverage).toBe('full_text');
    expect(db.settleUsage).toHaveBeenCalledWith(env,expect.objectContaining({inputTokens:1000,outputTokens:150,success:true,cost:0.0035}));
  });
  it.each([['deepseek','deepseek-flash','https://api.deepseek.com/chat/completions'],['glm','glm-5.3','https://open.bigmodel.cn/api/paas/v4/chat/completions']])('only calls the selected %s official endpoint',async(provider,model,endpoint)=>{
    state.config={...state.config,provider,model};fetchMock.mockResolvedValue(response(valid,provider));await analyzeItem(env,item);
    const [url,request]=fetchMock.mock.calls[0] as unknown as [string,RequestInit];const payload=JSON.parse(String(request.body));expect(url).toBe(endpoint);expect(payload.model).toBe(model);expect(payload.thinking).toEqual({type:'disabled'});expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it('checks the reserved upper cost before any network request',async()=>{
    state.config.monthlyBudget=0.000001;await expect(analyzeItem(env,item)).rejects.toThrow('预算');expect(fetchMock).not.toHaveBeenCalled();
  });
  it('does not oversubscribe a one-item daily allowance under concurrent requests',async()=>{
    state.config.dailyLimit=1;fetchMock.mockImplementation(async()=>{await new Promise(r=>setTimeout(r,15));return response();});
    const results=await Promise.allSettled([analyzeItem(env,item),analyzeItem(env,{...item,id:'item-2'})]);
    expect(results.filter(x=>x.status==='fulfilled')).toHaveLength(1);expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it('returns safe invalid-key errors without exposing response text or trying another provider',async()=>{
    fetchMock.mockResolvedValue(new Response('invalid test-secret-not-a-real-key',{status:401}));
    await expect(analyzeItem(env,item)).rejects.toThrow('密钥无效');expect(fetchMock).toHaveBeenCalledTimes(1);expect(db.settleUsage).toHaveBeenCalledWith(env,expect.objectContaining({success:false,cost:0,uncertain:false}));
  });
  it('does not switch providers on exhausted quota',async()=>{
    fetchMock.mockResolvedValue(new Response('',{status:429}));await expect(analyzeItem(env,item)).rejects.toThrow('额度');expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it('keeps a conservative reservation for an unknown network outcome',async()=>{
    fetchMock.mockRejectedValue(new Error('network timeout with sensitive payload'));await expect(analyzeItem(env,item)).rejects.toMatchObject({diagnostic:{code:'provider_timeout',stage:'transport',billingUncertain:true}});expect(db.settleUsage).toHaveBeenCalledWith(env,expect.objectContaining({success:false,uncertain:true}));expect([...state.reservations.values()][0].status).toBe('reserved');
  });
  it('tracks paid tokens even if the model returns malformed analysis',async()=>{
    fetchMock.mockResolvedValue(response({bad:'not analysis'}));await expect(analyzeItem(env,item)).rejects.toThrow('格式');expect(db.settleUsage).toHaveBeenCalledWith(env,expect.objectContaining({success:false,cost:0.0035}));expect(db.saveAnalysisCache).not.toHaveBeenCalled();
  });
  it('reserves connection-test cost even when automatic AI reading is disabled',async()=>{
    state.config.enabled=false;const result=await testProvider(env);expect(result.ok).toBe(true);expect(db.reserveUsage).toHaveBeenCalledWith(env,expect.objectContaining({isTest:true}));
  });
  it('tests an unsaved provider draft without letting it override saved budget limits',async()=>{
    fetchMock.mockResolvedValue(response(valid,'deepseek'));
    await testProvider(env,{provider:'deepseek',model:'deepseek-flash',key:'draft-secret',monthlyBudget:999,dailyLimit:999});
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.deepseek.com/chat/completions');
    expect(db.reserveUsage).toHaveBeenCalledWith(env,expect.objectContaining({monthlyBudget:20,dailyLimit:20,isTest:true}));
  });
  it('cannot lower a known OpenAI tariff to zero through draft connection-test quotes',async()=>{
    await testProvider(env,{provider:'openai',model:'gpt-6.1-sol',inputPricePerMillion:0,outputPricePerMillion:0});
    expect((db.reserveUsage as any).mock.calls[0][1].maxCost).toBeGreaterThan(0);
    expect(db.settleUsage).toHaveBeenCalledWith(env,expect.objectContaining({cost:0.0035,success:true}));
  });
  it('cannot lower a known tariff through saved provider settings during analysis',async()=>{
    state.config.inputPricePerMillion=0;state.config.outputPricePerMillion=0;await analyzeItem(env,item);
    expect((db.reserveUsage as any).mock.calls[0][1].maxCost).toBeGreaterThan(0);
    expect(db.settleUsage).toHaveBeenCalledWith(env,expect.objectContaining({cost:0.0035,success:true}));
  });
  it('rejects unpriced custom models before spending',async()=>{
    state.config.model='unpriced-model';await expect(analyzeItem(env,item)).rejects.toThrow('尚未配置价格');expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('Evidence, coverage and cache invalidation',()=>{
  it('never represents video descriptions, project metadata or aggregator stories as original full-text evidence',()=>{
    expect(sourceCoverage({...item,kind:'video'})).toBe('metadata');expect(sourceCoverage({...item,kind:'project'})).toBe('metadata');expect(sourceCoverage({...item,kind:'news',parentId:'issue'})).toBe('excerpt');expect(sourceCoverage({...item,body:'x'.repeat(20000)})).toBe('excerpt');
  });
  it('rejects hallucinated source links and ignores claimed coverage',()=>{
    expect(()=>validateAnalysis({...valid,references:['https://invented.example/fake']},item,'gpt-6.1-sol')).toThrow('不存在');
    const result=validateAnalysis(valid,{...item,body:undefined},'gpt-6.1-sol');expect(result.coverage).toBe('excerpt');
  });
  it('preserves the actual aggregator URL as an allowed provenance link',()=>{
    expect(sourceReferences({...item,body:'来源：橘鸦早报，https://daily.juya.uk/issues/2026-11-10/。以下是整理。'})).toContain('https://daily.juya.uk/issues/2026-11-10/');
  });
  it('reuses analysis only for the same content fingerprint, provider and model',async()=>{
    await analyzeItem(env,item);await analyzeItem(env,item);expect(fetchMock).toHaveBeenCalledTimes(1);
    const changed={...item,body:item.body+'新版本发布'};expect(await contentFingerprint(changed)).not.toBe(await contentFingerprint(item));await analyzeItem(env,changed);expect(fetchMock).toHaveBeenCalledTimes(2);
    state.config.model='gpt-6-luna';await analyzeItem(env,item);expect(fetchMock).toHaveBeenCalledTimes(3);
  });
  it('uses the editable profile and summary language without leaking identity or fixed private background',async()=>{
    state.profile={...createProfile('explorer','en'),displayName:'Example Reader',goals:['Explore food science'],timezone:'UTC'};await analyzeItem(env,item);
    const payload=JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body));
    expect(payload.instructions).toContain('in English');expect(payload.instructions).toContain('preference data');
    const input=JSON.parse(payload.input);expect(input.user_profile.goals).toEqual(['Explore food science']);expect(input.user_profile.summary_language).toBe('en');expect(JSON.stringify(payload)).not.toContain('Example Reader');
    expect(db.usagePeriod).toHaveBeenCalledWith('UTC');
  });
  it('invalidates profile-semantic or summary-language changes but not UI-language changes',async()=>{
    await analyzeItem(env,item);state.profile.language='en';await analyzeItem(env,item);expect(fetchMock).toHaveBeenCalledTimes(1);
    state.profile.summaryLanguage='en';state.profile.version++;await analyzeItem(env,item);expect(fetchMock).toHaveBeenCalledTimes(2);
    state.profile.goals=['Explore science'];state.profile.version++;const updated=await analyzeItem(env,item);expect(fetchMock).toHaveBeenCalledTimes(3);expect(updated.analysis?.profileVersion).toBe(state.profile.version);expect(updated.analysis?.summaryLanguage).toBe('en');
  });
  it('does not send any key or sensitive personal archive into the content prompt',async()=>{
    await analyzeItem(env,item);const payload=JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body));expect(JSON.stringify(payload)).not.toContain(state.key);expect(payload.instructions).toContain('不可信');
  });
  it('prioritizes useful IT foundations over shallow new AI announcements in automatic batches',async()=>{
    state.items=[{...item,id:'ai-news',topics:['ai'],title:'新工具发布',sourceId:'ai',publishedAt:'2026-11-11T00:00:00Z'},item];
    await analyzePending(env,1);expect(db.upsertContent).toHaveBeenCalledWith(env,[expect.objectContaining({id:item.id})]);
  });
  it('does not spend on disabled or blocked sources, including the GitHub parent source',async()=>{
    state.items=[{...item,id:'disabled',sourceId:'disabled'},{...item,id:'blocked',sourceId:'blocked'},{...item,id:'repo',kind:'project',platform:'GitHub',sourceId:'github:example/repo'},item];
    state.sources=[{id:'disabled',enabled:false},{id:'blocked',enabled:true,blocked:true},{id:'github-stars',enabled:false}];
    const result=await analyzePending(env,5,'owner-id');expect(result.analyzed).toBe(1);expect(fetchMock).toHaveBeenCalledTimes(1);expect(db.upsertContent).toHaveBeenCalledWith(env,[expect.objectContaining({id:item.id})]);
  });
  it('excludes persistent dismissed and read feedback and prioritizes an explicitly saved item',async()=>{
    state.items=[{...item,id:'dismissed'},{...item,id:'read'},{...item,id:'saved',topics:['ai']},item];state.feedback={dismissed:{dismissed:true},read:{read:true},saved:{saved:true,liked:true}};
    const result=await analyzePending(env,1,'owner-id');expect(result.analyzed).toBe(1);expect(db.readFeedback).toHaveBeenCalledWith(env,'owner-id');expect(db.upsertContent).toHaveBeenCalledWith(env,[expect.objectContaining({id:'saved'})]);
    const sent=String((fetchMock.mock.calls[0][1] as RequestInit).body);expect(sent).not.toContain('owner-id');expect(sent).not.toContain('dismissed');
  });
});
