import type { Provider } from '../shared/types';
import { HttpError } from './security';

export type ProviderDiagnosticCode = 'provider_timeout'|'provider_dns_error'|'provider_tls_error'|'provider_network_blocked'|'provider_network_error'|'provider_redirect_blocked'|'provider_auth_failed'|'provider_access_denied'|'provider_model_access'|'provider_quota_exhausted'|'provider_rate_limited'|'provider_rate_or_quota'|'provider_bad_request'|'provider_unavailable'|'provider_non_json'|'provider_empty_response'|'provider_response_too_large'|'provider_output_limit'|'provider_incomplete_response';
export interface ModelProbe {reachable:boolean;code?:ProviderDiagnosticCode;status?:number;modelListed?:boolean|null;requestId?:string;}
export interface ProviderDiagnostic {
  code:ProviderDiagnosticCode;stage:'transport'|'http'|'response';provider:Provider;
  upstreamStatus?:number;requestId?:string;retryAfterSeconds?:number;parameter?:string;
  transport?:'timeout'|'dns'|'tls'|'blocked'|'connection'|'redirect'|'unknown';
  billingUncertain?:boolean;modelProbe?:ModelProbe;
}
const CODES=new Set<ProviderDiagnosticCode>(['provider_timeout','provider_dns_error','provider_tls_error','provider_network_blocked','provider_network_error','provider_redirect_blocked','provider_auth_failed','provider_access_denied','provider_model_access','provider_quota_exhausted','provider_rate_limited','provider_rate_or_quota','provider_bad_request','provider_unavailable','provider_non_json','provider_empty_response','provider_response_too_large','provider_output_limit','provider_incomplete_response']);
const PARAMETERS=new Set(['model','temperature','max_tokens','max_output_tokens','max_completion_tokens','reasoning','reasoning.effort','reasoning_effort','thinking','response_format','text.format','messages','input']);
const MESSAGES:Record<ProviderDiagnosticCode,string>={
  provider_timeout:'服务商请求超时，尚不能确认 API 是否已处理请求。请稍后重试或调整超时设置。',
  provider_dns_error:'部署环境无法解析服务商域名；请求尚未到达 API，请检查网络出口和 DNS。',
  provider_tls_error:'部署环境无法建立安全的服务商连接；请检查 TLS、网络代理或证书配置。',
  provider_network_blocked:'部署环境阻止了服务商的出站连接；请检查托管平台的网络出口限制。',
  provider_network_error:'模型服务暂时不可用：网络连接失败，未收到可识别的 API 响应。请检查部署环境的出站访问。',
  provider_redirect_blocked:'服务商地址返回跳转，请检查 API Base URL；为保护密钥，没有跟随跳转。',
  provider_auth_failed:'密钥无效或未被服务商接受，请检查所选服务商和密钥配置。',
  provider_access_denied:'服务商拒绝了访问，请检查区域、项目、组织及 API 权限。',
  provider_model_access:'服务商未开放当前模型，请检查模型名称及项目、组织的访问权限。',
  provider_quota_exhausted:'服务商返回额度或余额不足，请检查 API 账单、额度有效期和消费上限。',
  provider_rate_limited:'服务商返回请求速率限制，请稍后重试或降低并发；这不等同于余额不足。',
  provider_rate_or_quota:'服务商返回请求受限或额度限制，请查看服务商控制台；目前不能确定是否为余额不足。',
  provider_bad_request:'服务商不接受当前请求参数，请检查模型、协议和高级参数。',
  provider_unavailable:'服务商暂时不可用，已保留原始内容；请稍后重试。',
  provider_non_json:'服务商返回了非 JSON 响应，可能是网络代理、网关或访问拦截页面。',
  provider_empty_response:'服务商返回了空响应，尚未收到可用的模型结果。',
  provider_response_too_large:'服务商响应超过本站安全读取上限，本次结果未保存。',
  provider_output_limit:'模型达到输出上限，未完成可用结果。请增加最大输出 tokens 或降低推理强度后再试。',
  provider_incomplete_response:'服务商未完成模型响应，请检查输入内容及服务商限制后重试。',
};

function safeId(value:string|null,key?:string):string|undefined {
  if(!value||value.length>128||! /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value)||(key&&value.includes(key))||/sk[-_]|bearer/i.test(value))return undefined;
  return value;
}
export function responseDiagnostic(response:Response,provider:Provider,key?:string):Omit<ProviderDiagnostic,'code'|'stage'> {
  const rawRetry=response.headers.get('retry-after');const retry=rawRetry&&/^\d+$/.test(rawRetry)?Number(rawRetry):undefined;
  const requestId=safeId(response.headers.get('x-request-id')||response.headers.get('request-id')||response.headers.get('cf-ray'),key);
  return {provider,upstreamStatus:response.status,...(requestId?{requestId}:{}),...(retry!==undefined&&retry>=0&&retry<=3600?{retryAfterSeconds:retry}:{})};
}
export class ProviderFailure extends Error {
  constructor(public diagnostic:ProviderDiagnostic,public uncertain:boolean){super(diagnostic.code);this.name='ProviderFailure';this.diagnostic={...diagnostic,billingUncertain:uncertain};}
}
export class ProviderDiagnosticError extends HttpError {
  public diagnostic:ProviderDiagnostic;
  constructor(diagnostic:ProviderDiagnostic){
    const code=diagnostic.code;const status=code==='provider_quota_exhausted'||code==='provider_rate_limited'||code==='provider_rate_or_quota'?429:code==='provider_auth_failed'||code==='provider_access_denied'||code==='provider_model_access'||code==='provider_bad_request'?400:502;
    super(status,MESSAGES[code]);this.diagnostic={...diagnostic};
  }
}
export function providerMessage(error:unknown):HttpError {
  if(error instanceof HttpError)return error;
  if(error instanceof ProviderFailure)return new ProviderDiagnosticError(error.diagnostic);
  return new HttpError(502,'模型服务暂时不可用，已保留原始内容；未自动切换服务商。');
}
/** Only fixed classifications are emitted; raw network messages and cause objects stay private. */
export function transportFailure(error:unknown,provider:Provider):ProviderFailure {
  const e=error as {name?:unknown;message?:unknown;code?:unknown;cause?:{code?:unknown}};
  const name=typeof e?.name==='string'?e.name:'';const message=typeof e?.message==='string'?e.message:'';
  const rawCode=typeof e?.cause?.code==='string'?e.cause.code:typeof e?.code==='string'?e.code:'';
  let code:ProviderDiagnosticCode='provider_network_error',transport:ProviderDiagnostic['transport']='unknown',uncertain=true;
  if(name==='TimeoutError'||name==='AbortError'||['ETIMEDOUT','UND_ERR_CONNECT_TIMEOUT','UND_ERR_HEADERS_TIMEOUT'].includes(rawCode)||/timeout|timed out/i.test(message)){code='provider_timeout';transport='timeout';}
  else if(['ENOTFOUND','EAI_AGAIN'].includes(rawCode)||/DNS|name resolution|could not resolve|failed to resolve/i.test(message)){code='provider_dns_error';transport='dns';uncertain=false;}
  else if(['CERT_HAS_EXPIRED','ERR_TLS_CERT_ALTNAME_INVALID','UNABLE_TO_VERIFY_LEAF_SIGNATURE','DEPTH_ZERO_SELF_SIGNED_CERT'].includes(rawCode)||/certificate|TLS handshake|SSL handshake/i.test(message)){code='provider_tls_error';transport='tls';uncertain=false;}
  else if(['ERR_NETWORK_ACCESS_DENIED','ERR_BLOCKED_BY_CLIENT'].includes(rawCode)||/outbound (?:network )?(?:access|requests?).*(?:not allowed|denied|blocked)|egress.*(?:not allowed|denied|blocked)|network access.*(?:not allowed|denied)/i.test(message)){code='provider_network_blocked';transport='blocked';uncertain=false;}
  else if(/redirect/i.test(message)){code='provider_redirect_blocked';transport='redirect';}
  else if(['ECONNREFUSED','ENETUNREACH','EHOSTUNREACH'].includes(rawCode)){transport='connection';uncertain=false;}
  else if(['ECONNRESET','UND_ERR_SOCKET'].includes(rawCode)||/connection|fetch failed/i.test(message)){transport='connection';}
  return new ProviderFailure({provider,stage:'transport',code,transport},uncertain);
}

export function httpFailure(response:Response,payload:unknown,provider:Provider,key?:string):ProviderFailure {
  const info=responseDiagnostic(response,provider,key);const root=payload&&typeof payload==='object'?payload as Record<string,unknown>:{};
  const raw=root.error&&typeof root.error==='object'?root.error as Record<string,unknown>:root;
  const vendorCode=[raw.code,raw.type,root.code].filter(value=>typeof value==='string').join(' ').toLowerCase();
  const message=typeof raw.message==='string'?raw.message.toLowerCase():'';
  const combined=vendorCode+' '+message;
  let code:ProviderDiagnosticCode;
  if(/insufficient_quota|credit_balance_exhausted|billing_hard_limit|no balance|insufficient balance|current quota|run out of credits|balance.*(?:exhaust|insufficient)/i.test(combined)||response.status===402)code='provider_quota_exhausted';
  else if(/rate_limit_exceeded|rate limit|requests per minute|tokens per minute/i.test(combined))code='provider_rate_limited';
  else if(/model_not_found|model.*(?:not found|does not exist|no access)|permission_denied|project.*mismatch|organization.*mismatch/i.test(combined))code='provider_model_access';
  else if(response.status===401||/invalid_api_key|authentication_error/i.test(combined))code='provider_auth_failed';
  else if(response.status===403)code='provider_access_denied';
  else if(response.status===429)code='provider_rate_or_quota';
  else if(response.status>=300&&response.status<400)code='provider_redirect_blocked';
  else if(response.status<500)code='provider_bad_request';
  else code='provider_unavailable';
  const parameter=typeof raw.param==='string'&&PARAMETERS.has(raw.param)?raw.param:undefined;
  return new ProviderFailure({...info,stage:'http',code,...(parameter?{parameter}:{})},response.status>=500);
}

export async function readProviderJson(response:Response,provider:Provider,key?:string,maxBytes=256000):Promise<any> {
  const info=responseDiagnostic(response,provider,key);
  if(!response.body)throw new ProviderFailure({...info,stage:'response',code:'provider_empty_response'},true);
  const reader=response.body.getReader();const chunks:Uint8Array[]=[];let size=0;
  try{
    while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>maxBytes){await reader.cancel();throw new ProviderFailure({...info,stage:'response',code:'provider_response_too_large'},true);}chunks.push(value);}
    const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
    if(!size)throw new ProviderFailure({...info,stage:'response',code:'provider_empty_response'},true);
    let payload:any;try{payload=JSON.parse(new TextDecoder().decode(bytes));}catch{throw new ProviderFailure({...info,stage:'response',code:'provider_non_json'},true);}
    if(!payload||typeof payload!=='object'||Array.isArray(payload))throw new ProviderFailure({...info,stage:'response',code:'provider_non_json'},true);
    return payload;
  }catch(error){if(error instanceof ProviderFailure)throw error;throw transportFailure(error,provider);}
}
/** Serialize diagnostics only from our own safe error class, never arbitrary exceptions. */
export function providerErrorDiagnostic(error:unknown):ProviderDiagnostic|undefined {
  if(!(error instanceof ProviderDiagnosticError)||!CODES.has(error.diagnostic.code))return undefined;
  return error.diagnostic;
}
