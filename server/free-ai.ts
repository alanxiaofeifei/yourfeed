import type {Env} from './db';

export type FreeEndpoint = 'ovh' | 'pollinations';
export type GroqEndpoint = 'groq-120b' | 'groq-20b';
type Endpoint = FreeEndpoint | GroqEndpoint;
const endpoints = {
  'groq-120b': {url:'https://api.groq.com/openai/v1/chat/completions',model:'openai/gpt-oss-120b'},
  'groq-20b': {url:'https://api.groq.com/openai/v1/chat/completions',model:'openai/gpt-oss-20b'},
  ovh: {url:'https://oai.endpoints.kepler.ai.cloud.ovh.net/v1/chat/completions',model:'gpt-oss-20b'},
  pollinations: {url:'https://text.pollinations.ai/v1/chat/completions',model:'openai'},
} as const;

/** Keyless outbound construction seam, also reusable by an operator's egress probe.
 * No credentials, configurable URL, redirects, tools or strict-schema mode. */
export function buildFreeAiRequest(endpoint:FreeEndpoint,instructions:string,prompt:string,signal?:AbortSignal) {
  return {url:endpoints[endpoint].url,init:{method:'POST',headers:{'Content-Type':'application/json'},redirect:'manual' as const,signal,body:JSON.stringify({model:endpoints[endpoint].model,...(endpoint==='ovh'?{reasoning_effort:'low'}:{}),stream:false,max_tokens:4096,response_format:{type:'json_object'},messages:[{role:'system',content:instructions},{role:'user',content:prompt}]})}};
}

// Shared egress is scarce: reserve synchronously before fetch, including in-flight
// requests. This is deliberately best effort per isolate, never an IP guarantee.
const nextAttempt:Record<Endpoint,number>={'groq-120b':0,'groq-20b':0,ovh:0,pollinations:0};
// Groq reserves only the active attempt; successful tasks use its 30 RPM spacing.
const groqInFlight=new Set<GroqEndpoint>();
// Only a known limit (not ordinary errors or in-flight reservations) enables 20b.
let groq120bLimitedUntil=0;
function isGroq(endpoint:Endpoint):endpoint is GroqEndpoint {return endpoint==='groq-120b'||endpoint==='groq-20b';}
function available(endpoint:Endpoint):boolean {return nextAttempt[endpoint]<=Date.now()&&(!isGroq(endpoint)||!groqInFlight.has(endpoint));}
function groqKey(env:Env):string|undefined {return env.FREE_AI_GROQ_API_KEY?.trim()||undefined;}
/** Credentials are returned only in the outbound Authorization header. */
export function buildFreeGroqRequest(endpoint:GroqEndpoint,key:string,instructions:string,prompt:string,signal?:AbortSignal) {
  return {url:endpoints[endpoint].url,init:{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+key},redirect:'manual' as const,signal,body:JSON.stringify({model:endpoints[endpoint].model,reasoning_effort:'low',stream:false,max_tokens:2048,response_format:{type:'json_object'},messages:[{role:'system',content:instructions},{role:'user',content:prompt}]})}};
}
function durationMs(raw:string):number|undefined {
  const parts=[...raw.matchAll(/(\d+(?:\.\d+)?)(ms|us|µs|ns|s|m|h|d)/g)];
  if(!parts.length||parts.map(part=>part[0]).join('')!==raw)return;
  const units:Record<string,number>={ns:.000001,us:.001,'µs':.001,ms:1,s:1000,m:60_000,h:3_600_000,d:86_400_000};
  const value=parts.reduce((total,part)=>total+Number(part[1])*units[part[2]],0);
  return Number.isFinite(value)?value:undefined;
}
function retryAt(response:Response,now:number,groqResets:readonly string[]=[]):number {
  const deadlines:number[]=[];
  for(const header of ['Retry-After','ratelimit-reset','x-ratelimit-reset']){
    const raw=response.headers.get(header)?.trim();if(!raw)continue;
    const seconds=Number(raw),date=Date.parse(raw);
    // Retry-After uses delay seconds; reset headers may use delay seconds or Unix seconds.
    if(Number.isFinite(seconds))deadlines.push(header!=='Retry-After'&&seconds>=1_000_000_000?seconds*1000:now+Math.max(0,seconds)*1000);
    else if(Number.isFinite(date))deadlines.push(date);
  }
  for(const header of groqResets){
    const raw=response.headers.get(header)?.trim();if(!raw)continue;
    const delay=durationMs(raw);if(delay!==undefined)deadlines.push(now+delay);
  }
  return Math.max(now+30_000,...(deadlines.length?deadlines:[now+60_000]));
}
async function visibleContent(response:Response):Promise<string> {
  if(!response.body)throw Error('empty');
  const reader=response.body.getReader();const chunks:Uint8Array[]=[];let size=0;
  try{
    while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>256_000)throw Error('oversize');chunks.push(value);}
    const bytes=new Uint8Array(size);let offset=0;for(const part of chunks){bytes.set(part,offset);offset+=part.byteLength;}
    const data=JSON.parse(new TextDecoder().decode(bytes));const choice=data?.choices?.[0];
    // reasoning/reasoning_content and raw vendor errors never escape this module.
    if(data.error||choice?.finish_reason==='length'||choice?.finish_reason==='content_filter'||typeof choice?.message?.content!=='string'||!choice.message.content.trim())throw Error('unusable');
    return choice.message.content;
  }finally{void reader.cancel().catch(()=>{});}
}

/** Each independent instance has exactly one owner, so the atomic instance cap is
 * also a per-owner cap. Count attempts conservatively, including failed requests;
 * the same bounded day key is reused, with no personal data or prompt persistence. */
export async function runFreeAi<T>(env:Env,task:{instructions:string;prompt:string;parse:(text:string)=>T;timeoutSeconds?:number}):Promise<T|undefined> {
  const key=groqKey(env);
  const instructions=task.instructions+' Return only a JSON object matching this task.';
  // Approximate UTF-8 input tokens plus the output ceiling. An oversized task
  // bypasses both 8K TPM models without changing their shared cooldown state.
  const estimate=key?Math.ceil(new TextEncoder().encode(JSON.stringify({instructions,prompt:task.prompt})).byteLength/3)+2048:0;
  const order:Endpoint[]=key&&estimate<=8000?['groq-120b','groq-20b','ovh','pollinations']:['ovh','pollinations'];
  let allow20b=groq120bLimitedUntil>Date.now();
  if(!order.some(endpoint=>(endpoint!=='groq-20b'||allow20b)&&available(endpoint)))return;
  const day=new Date().toISOString().slice(0,10);
  let reserved:unknown;
  try{reserved=await env.DB.prepare("INSERT INTO meta(key,value) VALUES (?, '1') ON CONFLICT(key) DO UPDATE SET value=CAST(CAST(meta.value AS INTEGER)+1 AS TEXT) WHERE CAST(meta.value AS INTEGER)<10 RETURNING value").bind('free-ai:day:'+day).first();}catch{return;}

  if(!reserved)return;
  const budget=Math.min(8000,(task.timeoutSeconds??8)*1000),deadline=Date.now()+budget;
  // With the supplement, leave two seconds for public fallbacks (scaled for shorter callers).
  const groqDeadline=deadline-Math.min(2000,budget/4);
  for(const endpoint of order){
    if(endpoint==='groq-20b'&&!allow20b||!available(endpoint))continue;
    const remaining=deadline-Date.now();if(remaining<=0)return;
    const groq=isGroq(endpoint);
    const timeout=groq?Math.min(4000,groqDeadline-Date.now()):endpoint==='ovh'?Math.min(6000,remaining-(key?Math.min(1000,budget/8):0)):remaining;
    if(timeout<=0)continue;
    if(endpoint==='groq-120b')allow20b=false;
    if(isGroq(endpoint))groqInFlight.add(endpoint);
    else nextAttempt[endpoint]=Date.now()+30_000;
    const controller=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined;
    try{
      const request=isGroq(endpoint)?buildFreeGroqRequest(endpoint,key!,instructions,task.prompt,controller.signal):buildFreeAiRequest(endpoint,instructions,task.prompt,controller.signal);
      const work=(async()=>{const response=await fetch(request.url,request.init);
        // Ignore late responses after this attempt's timeout, including their headers.
        if(groq&&controller.signal.aborted){void response.body?.cancel().catch(()=>{});throw Error('timeout');}
        const matchingResets:string[]=[];
        if(groq){
          const requests=response.headers.get('x-ratelimit-remaining-requests'),tokens=response.headers.get('x-ratelimit-remaining-tokens');
          if(requests!==null&&requests.trim()!==''&&Number(requests)===0)matchingResets.push('x-ratelimit-reset-requests');
          if(tokens!==null&&tokens.trim()!==''&&Number(tokens)<estimate)matchingResets.push('x-ratelimit-reset-tokens');
        }
        const limited=matchingResets.length>0;
        if(!response.ok||limited){
          // Use only the exhausted budgets' resets; without an identifiable limit,
          // errors conservatively honor both Groq resets, plus Retry-After.
          const cooldown=retryAt(response,Date.now(),groq?(limited?matchingResets:['x-ratelimit-reset-requests','x-ratelimit-reset-tokens']):[]);
          nextAttempt[endpoint]=Math.max(nextAttempt[endpoint],cooldown);
          if(endpoint==='groq-120b'&&response.status===429){
            groq120bLimitedUntil=nextAttempt[endpoint];
            allow20b=true;
          }
        }
        if(!response.ok){void response.body?.cancel().catch(()=>{});throw Error('unavailable');}
        const text=await visibleContent(response),result=task.parse(text);
        // A valid limited success may enable 20b for subsequent tasks. Invalid
        // responses still fall through to OVH, without granting a 20b attempt.
        if(endpoint==='groq-120b'&&limited)groq120bLimitedUntil=nextAttempt[endpoint];
        return result;
      })();
      const result=await Promise.race([work,new Promise<never>((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(Error('timeout'));},timeout);})]);
      if(groq)nextAttempt[endpoint]=Math.max(nextAttempt[endpoint],Date.now()+2000);
      return result;
    }catch{nextAttempt[endpoint]=Math.max(nextAttempt[endpoint],Date.now()+30_000);}finally{if(timer)clearTimeout(timer);controller.abort();if(isGroq(endpoint))groqInFlight.delete(endpoint);}
  }
}

/** Operator-only seam, deliberately not wired to the public health API. */
export async function probeFreeGroq(env:Env):Promise<{configured:boolean;ok:boolean;status?:number}> {
  const key=groqKey(env);if(!key)return {configured:false,ok:false};
  const controller=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined;
  try{
    const work=(async()=>{
      const response=await fetch('https://api.groq.com/openai/v1/models',{method:'GET',headers:{Authorization:'Bearer '+key},redirect:'manual',signal:controller.signal});
      void response.body?.cancel().catch(()=>{});
      return {configured:true,ok:response.ok,status:response.status};
    })();
    return await Promise.race([work,new Promise<never>((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(Error('timeout'));},4000);})]);
  }catch{return {configured:true,ok:false};}finally{if(timer)clearTimeout(timer);controller.abort();}
}
