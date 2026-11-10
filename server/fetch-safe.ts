import sanitizeHtml from 'sanitize-html';
import { isIP } from 'node:net';
import { isPublicAddress, resolvePublicDns, type PublicDnsResolver } from './provider-endpoint';

// These fixed platform/publisher hosts are controlled by their service operators.
// User-added domains always receive a fresh DNS validation before each request.
const FIXED_PUBLIC_ROOTS = ['www.googleapis.com','youtube.com','youtu.be','bilibili.com','github.com','api.github.com','raw.githubusercontent.com','x.com','twitter.com','publish.twitter.com','publish.x.com','ifanr.com','daily.juya.uk','openai.com','anthropic.com','claude.com','deepseek.com','bigmodel.cn','microsoft.com','googleblog.com','developers.google.com','cloud.google.com','cloudflare.com','arxiv.org','waytoagi.com','modevol.com'];
const SENSITIVE_KEYS = /^(?:token|access_token|refresh_token|api[_-]?key|key|auth|authorization|signature|sig|code|password|secret)$/i;
const LOCAL_SUFFIX=/(?:^|\.)(?:localhost|local|internal|intranet|lan|home|test|invalid|example|onion|arpa)$/i;
const RESERVED_NAMES=/(?:^|\.)(?:metadata|metadata-google|instance-data)(?:\.|$)/i;
const CREDENTIAL_HEADER=/^(?:authorization|proxy-authorization|cookie|x-goog-api-key|x-api-key|api-key)$/i;
export function validatePublicUrl(input:string): URL {
 if(typeof input!=='string'||input.length>4096||/[\s\x00-\x1f\x7f\\]/.test(input))throw new Error('请输入有效的 HTTPS 内容链接。');
 let u:URL;try{u=new URL(input);}catch{throw new Error('请输入有效的 HTTPS 内容链接。');}
 if(u.protocol!=='https:'||u.username||u.password||(u.port&&u.port!=='443'))throw new Error('仅支持无账号密码的 HTTPS 内容链接。');
 const h=u.hostname.toLowerCase().replace(/\.$/,'');
 if(!h.includes('.')||h.includes(':')||isIP(h)||/^[\d.]+$/.test(h)||LOCAL_SUFFIX.test(h)||RESERVED_NAMES.test(h)||!h.split('.').every(label=>/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label)))throw new Error('不支持本地或内网地址。');
 if(/%(?:2f|5c|00)/i.test(u.pathname))throw new Error('请输入有效的 HTTPS 内容链接。');
 if(/(?:unsubscribe|signout|logout|oauth|callback|settings\/billing)/i.test(u.pathname)||[...u.searchParams.keys()].some(k=>SENSITIVE_KEYS.test(k)))throw new Error('此链接可能包含凭据或账号操作，不作为内容导入。');
 u.hostname=h;u.hash='';return u;
}
export async function resolveContentUrl(input:string,resolver:PublicDnsResolver=resolvePublicDns):Promise<URL>{
 const u=validatePublicUrl(input);
 if(!FIXED_PUBLIC_ROOTS.some(root=>u.hostname===root||u.hostname.endsWith('.'+root))){
  let addresses:string[];try{addresses=await resolver(u.hostname);}catch{throw new Error('暂时无法验证内容域名的公开地址，请稍后重试。');}
  if(!addresses.length||addresses.some(a=>!isPublicAddress(a)))throw new Error('不支持解析到内网或保留地址的内容来源。');
 }
 return u;
}
export function canonicalUrl(input:string):string{
 const u=validatePublicUrl(input);
 for(const k of [...u.searchParams.keys()])if(/^utm_|^(?:spm_id_from|spm|ref_src|ref_url|feature|si|fbclid|gclid)$/i.test(k))u.searchParams.delete(k);
 if(u.hostname==='youtu.be')return `https://www.youtube.com/watch?v=${encodeURIComponent(u.pathname.slice(1))}`;
 if((u.hostname==='youtube.com'||u.hostname.endsWith('.youtube.com'))&&u.pathname==='/watch')return `https://www.youtube.com/watch?v=${encodeURIComponent(u.searchParams.get('v')||'')}`;
 if(u.hostname==='twitter.com')u.hostname='x.com';
 return u.toString();
}
export async function fetchSafe(input:string, options:{headers?:Record<string,string>;maxBytes?:number;timeout?:number;resolver?:PublicDnsResolver;maxRedirects?:number;sameOriginRedirects?:boolean}={}):Promise<{response:Response;text:string,url:string}>{
 let u=validatePublicUrl(input);
 const headers={'User-Agent':'Mozilla/5.0 (compatible; YourFeed/1.0; personal reader)',...options.headers};
 const credentialed=Object.keys(options.headers||{}).some(k=>CREDENTIAL_HEADER.test(k));
 // Only the controlled official metadata adapter may send a YouTube credential.
 // Public article/feed requests never attach caller cookies or authorization.
 if(credentialed&&(u.origin!=='https://www.googleapis.com'||!u.pathname.startsWith('/youtube/v3/')||Object.keys(options.headers||{}).some(k=>CREDENTIAL_HEADER.test(k)&&k.toLowerCase()!=='x-goog-api-key')))throw new Error('内容请求不允许携带账号凭据。');
 const timeout=Math.min(30000,Math.max(1000,options.timeout||12000));
 const signal=AbortSignal.timeout(timeout);
 const maxRedirects=Math.min(3,Math.max(0,Math.floor(options.maxRedirects??3)));
 for(let n=0;n<=maxRedirects;n++){
  u=await resolveContentUrl(u.toString(),options.resolver);
  const response=await fetch(u.toString(),{headers,redirect:'manual',signal});
  if(response.status>=300&&response.status<400){
   const location=response.headers.get('location');await response.body?.cancel();
   if(!location)throw new Error('来源返回了无效跳转。');
   const next=validatePublicUrl(new URL(location,u).toString());
   if(credentialed)throw new Error('带凭据的请求不允许跨站跳转或重定向。');
   if(n>=maxRedirects)throw new Error('来源跳转过多。');
   if(options.sameOriginRedirects&&next.origin!==u.origin)throw new Error('来源发现不允许跨站跳转。');
   u=next;continue;
  }
  if(!response.ok){await response.body?.cancel();throw new Error(`来源暂时无法读取（HTTP ${response.status}）。`);}
  const limit=Math.min(2_000_000,Math.max(1,options.maxBytes||2_000_000));const length=Number(response.headers.get('content-length')||0);
  if(length>limit){await response.body?.cancel();throw new Error('来源内容过大，暂不导入。');}
  const reader=response.body?.getReader();if(!reader)return {response,text:'',url:u.toString()};
  const decoder=new TextDecoder();let text='',bytes=0;
  try{while(true){const r=await reader.read();if(r.done)break;bytes+=r.value.byteLength;if(bytes>limit){await reader.cancel();throw new Error('来源内容过大，暂不导入。');}text+=decoder.decode(r.value,{stream:true});}text+=decoder.decode();}finally{reader.releaseLock();}
  return {response,text,url:u.toString()};
 }
 throw new Error('来源跳转过多。');
}
export function plainText(html:string):string{return sanitizeHtml(String(html||''),{allowedTags:[],allowedAttributes:{},nonTextTags:['style','script','textarea','option','noscript']}).replace(/&nbsp;/g,' ').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&#39;/g,"'").replace(/&quot;/g,'"').replace(/\s+/g,' ').trim();}
export function cleanHtml(html:string):string{return sanitizeHtml(html,{allowedTags:['p','br','h2','h3','h4','ul','ol','li','strong','em','blockquote','a','code','pre'],allowedAttributes:{a:['href','title','rel','target']},allowedSchemes:['https'],transformTags:{a:(_tag,attrs)=>({tagName:'a',attribs:{href:attrs.href||'',rel:'noopener noreferrer',target:'_blank'}})}});}
