import { isIP } from 'node:net';
import { HttpError } from './security';

export type ApiProtocol = 'responses' | 'chat-completions';
export type PublicDnsResolver = (hostname: string) => Promise<string[]>;

const LOCAL_SUFFIX = /(?:^|\.)(?:localhost|local|internal|intranet|lan|home|test|invalid|example|onion|arpa)$/i;
const RESERVED_NAMES = /(?:^|\.)(?:metadata|metadata-google|instance-data)(?:\.|$)/i;

/** Normalize a directory-style API base without ever accepting embedded secrets. */
export function validateProviderBaseUrl(input: string): string {
  if (typeof input !== 'string' || input.length > 2048 || /[\s\x00-\x1f\x7f\\]/.test(input)) throw new HttpError(400, '请输入有效的公开 HTTPS API Base URL。');
  let url: URL;try { url=new URL(input); } catch { throw new HttpError(400, '请输入有效的公开 HTTPS API Base URL。'); }
  if (url.protocol!=='https:' || url.username || url.password || input.includes('?') || input.includes('#') || (url.port && url.port!=='443')) throw new HttpError(400, 'API 地址仅支持不含账号、查询参数的 HTTPS 地址，端口必须为 443。');
  const host=url.hostname.toLowerCase().replace(/\.$/,'');
  if (!host.includes('.') || host.includes(':') || host.includes('[') || isIP(host) || /^[\d.]+$/.test(host) || LOCAL_SUFFIX.test(host) || RESERVED_NAMES.test(host) || !host.split('.').every(label=>/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label))) throw new HttpError(400, 'API 地址必须使用公开域名，不支持 IP、本机或内网地址。');
  if (/%(?:2f|5c|00)/i.test(url.pathname)) throw new HttpError(400, 'API 地址路径无效。');
  url.hostname=host;url.pathname=url.pathname.replace(/\/+$/,'');
  return url.toString().replace(/\/$/,'');
}

export function buildProviderEndpoint(baseUrl: string, protocol: ApiProtocol): string {
  const normalized=validateProviderBaseUrl(baseUrl);
  // Accept a pasted full endpoint as well as a directory without duplicating routes.
  const base=normalized.replace(/\/(?:responses|chat\/completions)\/?$/,'');
  return base+(protocol==='responses'?'/responses':'/chat/completions');
}

export function isPublicAddress(address: string): boolean {
  const version=isIP(address);
  if (version===4) {
    const [a,b,c]=address.split('.').map(Number);
    return !(a===0||a===10||a===127||a>=224||(a===100&&b>=64&&b<=127)||(a===169&&b===254)||(a===172&&b>=16&&b<=31)||(a===192&&b===168)||(a===192&&b===0)||(a===192&&b===88&&c===99)||(a===198&&(b===18||b===19))||(a===198&&b===51&&c===100)||(a===203&&b===0&&c===113));
  }
  if (version===6) {
    const value=new URL('https://['+address+']/').hostname.slice(1,-1).toLowerCase();
    const hextets=value.split(':');
    // 2001::/23 is special-purpose: includes Teredo, benchmark and ORCHID ranges.
    const special2001=parseInt(hextets[0],16)===0x2001 && (parseInt(hextets[1],16)||0)<0x200;
    return /^[23][0-9a-f]{0,3}:/.test(value) && !special2001 && !/^(?:2001:db8:|2002:|3ffe:|3fff:)/.test(value);
  }
  return false;
}

/** Fixed trusted DNS service; caller credentials are never attached to DNS requests. */
export const resolvePublicDns: PublicDnsResolver = async hostname => {
  const responses=await Promise.all(['A','AAAA'].map(async type=>{
    let response:Response;
    try { response=await fetch(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(hostname)}&type=${type}`,{headers:{Accept:'application/dns-json'},redirect:'manual',signal:AbortSignal.timeout(6000)}); }
    catch { throw new HttpError(503, '暂时无法验证 API 域名的公开地址，请稍后重试。'); }
    if (!response.ok || Number(response.headers.get('content-length')||0)>64000) { await response.body?.cancel();throw new HttpError(503, '暂时无法验证 API 域名的公开地址，请稍后重试。'); }
    let body:any;try { const text=await response.text();if(text.length>64000)throw new Error();body=JSON.parse(text); } catch { throw new HttpError(503, '暂时无法验证 API 域名的公开地址，请稍后重试。'); }
    if (body.Status!==0 || (body.Answer!==undefined&&!Array.isArray(body.Answer))) throw new HttpError(400, 'API 域名未解析到可用的公开地址。');
    return (body.Answer||[]).filter((answer:any)=>answer.type===1||answer.type===28).map((answer:any)=>String(answer.data));
  }));
  return responses.flat();
};

/** Re-run for every credentialed call; redirects are still forbidden by the caller. */
export async function resolveProviderEndpoint(baseUrl: string, protocol: ApiProtocol, resolver: PublicDnsResolver = resolvePublicDns): Promise<string> {
  const endpoint=buildProviderEndpoint(baseUrl,protocol);const host=new URL(endpoint).hostname;
  let addresses:string[];
  try { addresses=await resolver(host); } catch (error) { if(error instanceof HttpError)throw error;throw new HttpError(503,'暂时无法验证 API 域名的公开地址，请稍后重试。'); }
  if (!addresses.length || addresses.some(address=>!isPublicAddress(address))) throw new HttpError(400,'API 域名解析到非公开地址，已阻止发送密钥。');
  return endpoint;
}
