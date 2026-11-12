import type { Provider } from '../shared/types';
import { PROVIDERS } from '../shared/providers';

export class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export function identity(request: Request, trustedSite = false): string {
  if (!trustedSite) throw new HttpError(401, 'Sign in to use your private feed.');
  const id = request.headers.get('oai-authenticated-user-id');
  if (!id || id.length > 256) throw new HttpError(401, '请通过 ChatGPT 登录后使用你的私人内容库。');
  return id;
}
export function checkWriteRequest(request: Request): void {
  const origin = request.headers.get('origin');
  if (origin && origin !== new URL(request.url).origin) throw new HttpError(403, '请求来源不匹配。');
  if (!request.headers.get('content-type')?.includes('application/json')) throw new HttpError(415, '请使用 JSON 请求。');
}
export async function readJson(request: Request): Promise<Record<string, unknown>> {
  if (Number(request.headers.get('content-length') || 0) > 32000) throw new HttpError(413, '请求内容过大。');
  const text = await request.text();
  if (new TextEncoder().encode(text).length > 32000) throw new HttpError(413, '请求内容过大。');
  try {
    const value = JSON.parse(text);
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    return value;
  } catch { throw new HttpError(400, '请求不是有效的 JSON 对象。'); }
}
export function providerName(value: unknown): Provider {
  if (typeof value !== 'string' || !PROVIDERS.includes(value as Provider)) throw new HttpError(400, '请选择支持的模型服务商。');
  return value as Provider;
}
function decodeMaster(master: string): Uint8Array {
  if (/^[a-f0-9]{64}$/i.test(master)) return Uint8Array.from(master.match(/../g)!, x => parseInt(x,16));
  try {
    const raw = Uint8Array.from(atob(master), x => x.charCodeAt(0));
    if (raw.length === 32) return raw;
  } catch { /* Invalid master has no useful public details. */ }
  throw new HttpError(503, '服务器密钥保护尚未配置，请联系网站维护者。');
}
function base64(data: Uint8Array): string { return btoa(String.fromCharCode(...data)); }
async function cryptoKey(master?: string): Promise<CryptoKey> {
  if (!master) throw new HttpError(503, '服务器密钥保护尚未配置，请联系网站维护者。');
  return crypto.subtle.importKey('raw', decodeMaster(master) as BufferSource, 'AES-GCM', false, ['encrypt','decrypt']);
}
export async function encryptSecret(value: string, master: string | undefined, purpose: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const bytes = await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:new TextEncoder().encode(purpose)},await cryptoKey(master),new TextEncoder().encode(value));
  return JSON.stringify({v:1,iv:base64(iv),data:base64(new Uint8Array(bytes))});
}
export async function decryptSecret(cipher: string, master: string | undefined, purpose: string): Promise<string> {
  try {
    const payload = JSON.parse(cipher);
    if (payload.v !== 1) throw new Error();
    const iv = Uint8Array.from(atob(payload.iv), x => x.charCodeAt(0));
    const data = Uint8Array.from(atob(payload.data), x => x.charCodeAt(0));
    const bytes = await crypto.subtle.decrypt({name:'AES-GCM',iv,additionalData:new TextEncoder().encode(purpose)},await cryptoKey(master),data);
    return new TextDecoder().decode(bytes);
  } catch { throw new HttpError(503, '已保存密钥暂时无法读取，请检查服务器密钥保护配置。'); }
}
export function cleanError(error: unknown): string {
  if (error instanceof HttpError) return error.message;
  // Provider/network exceptions can contain credentials or request contents.
  return '操作暂时未完成，请稍后重试。已有内容和收藏仍然保留。';
}
