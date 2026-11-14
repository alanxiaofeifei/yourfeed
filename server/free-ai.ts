import type {Env} from './db';

export type FreeEndpoint = 'ovh' | 'pollinations';
const endpoints = {
  ovh: {url:'https://oai.endpoints.kepler.ai.cloud.ovh.net/v1/chat/completions',model:'gpt-oss-20b'},
  pollinations: {url:'https://text.pollinations.ai/v1/chat/completions',model:'openai'},
} as const;

/** The only outbound construction seam, also reusable by an operator's egress probe.
 * No credentials, configurable URL, redirects, tools or strict-schema mode. */
export function buildFreeAiRequest(endpoint:FreeEndpoint,instructions:string,prompt:string,signal?:AbortSignal) {
  return {url:endpoints[endpoint].url,init:{method:'POST',headers:{'Content-Type':'application/json'},redirect:'manual' as const,signal,body:JSON.stringify({model:endpoints[endpoint].model,stream:false,max_tokens:4096,response_format:{type:'json_object'},messages:[{role:'system',content:instructions},{role:'user',content:prompt}]})}};
}

// Shared egress is scarce: reserve synchronously before fetch, including in-flight
// requests. This is deliberately best effort per isolate, never an IP guarantee.
const nextAttempt:Record<FreeEndpoint,number>={ovh:0,pollinations:0};
function retryAt(response:Response,now:number):number {
  const raw=response.headers.get('Retry-After');
  if(!raw)return now+60_000;
  const seconds=Number(raw),date=Date.parse(raw);
  return Math.max(now+30_000,Number.isFinite(seconds)?now+Math.max(0,seconds)*1000:Number.isFinite(date)?date:now+60_000);
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
  if(!(['ovh','pollinations'] as const).some(endpoint=>nextAttempt[endpoint]<=Date.now()))return;
  const day=new Date().toISOString().slice(0,10);
  let reserved:unknown;
  try{reserved=await env.DB.prepare("INSERT INTO meta(key,value) VALUES (?, '1') ON CONFLICT(key) DO UPDATE SET value=CAST(CAST(meta.value AS INTEGER)+1 AS TEXT) WHERE CAST(meta.value AS INTEGER)<10 RETURNING value").bind('free-ai:day:'+day).first();}catch{return;}

  if(!reserved)return;
  const deadline=Date.now()+Math.min(8000,(task.timeoutSeconds??8)*1000);
  for(const endpoint of ['ovh','pollinations'] as const){
    if(nextAttempt[endpoint]>Date.now())continue;
    const remaining=deadline-Date.now();if(remaining<=0)return;
    const timeout=endpoint==='ovh'?Math.min(remaining,Math.floor((task.timeoutSeconds??8)*500)):remaining;
    nextAttempt[endpoint]=Date.now()+30_000;
    const controller=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined;
    try{
      const request=buildFreeAiRequest(endpoint,task.instructions+' Return only a JSON object matching this task.',task.prompt,controller.signal);
      const work=(async()=>{const response=await fetch(request.url,request.init);
        if(!response.ok){nextAttempt[endpoint]=Math.max(nextAttempt[endpoint],retryAt(response,Date.now()));void response.body?.cancel().catch(()=>{});throw Error('unavailable');}
        const text=await visibleContent(response);return task.parse(text);
      })();
      return await Promise.race([work,new Promise<never>((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(Error('timeout'));},timeout);})]);
    }catch{nextAttempt[endpoint]=Math.max(nextAttempt[endpoint],Date.now()+30_000);}finally{if(timer)clearTimeout(timer);controller.abort();}
  }
}
