import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildProviderEndpoint, isPublicAddress, resolveProviderEndpoint, resolvePublicDns, validateProviderBaseUrl } from '../server/provider-endpoint';

afterEach(()=>vi.unstubAllGlobals());
describe('Custom provider URL and DNS boundary',()=>{
  it('normalizes supported public API bases and pasted endpoint paths',()=>{
    expect(validateProviderBaseUrl('https://API.OpenRouter.AI./api/v1/')).toBe('https://api.openrouter.ai/api/v1');
    expect(buildProviderEndpoint('https://api.moonshot.cn/v1','chat-completions')).toBe('https://api.moonshot.cn/v1/chat/completions');
    expect(buildProviderEndpoint('https://api.siliconflow.cn/v1/chat/completions','responses')).toBe('https://api.siliconflow.cn/v1/responses');
  });
  it.each(['http://api.vendor.net/v1','https://user:secret@api.vendor.net/v1','https://api.vendor.net/v1?key=secret','https://api.vendor.net/v1#secret','https://api.vendor.net:8443/v1','https://localhost/v1','https://host.internal/v1','https://service.local/v1','https://metadata.google.internal/v1','https://127.0.0.1/v1','https://2130706433/v1','https://0x7f000001/v1','https://%31%32%37.0.0.1/v1','https://[::1]/v1','https://[::ffff:127.0.0.1]/v1','https://api.vendor.net/v1%2fadmin'])('rejects unsafe URL %s',url=>{
    expect(()=>validateProviderBaseUrl(url)).toThrow();
  });
  it.each(['0.0.0.0','10.0.0.1','127.0.0.1','169.254.169.254','172.16.0.1','192.168.1.1','100.64.0.1','198.18.0.1','224.0.0.1','::1','::','::ffff:127.0.0.1','fc00::1','fe80::1','ff02::1','2001:db8::1','2001:0db8::1','2001:0000::1','2001:0:4136:e378:8000:63bf:3fff:fdd2','2001:2::1','2001:0002:0000::1','2001:10::1','2001:001f::1','2001:20::1','2001:002f::1','2002:0a00:0001::1','3ffe::1','3fff::1'])('rejects private and special-purpose DNS address %s',address=>{
    expect(isPublicAddress(address)).toBe(false);
  });
  it.each(['8.8.8.8','93.184.216.34','2606:4700:4700::1111','2001:4860:4860::8888'])('accepts global unicast %s',address=>expect(isPublicAddress(address)).toBe(true));
  it('fails closed on mixed public/private answers and missing DNS addresses',async()=>{
    await expect(resolveProviderEndpoint('https://api.vendor.net/v1','responses',async()=>['8.8.8.8','10.0.0.1'])).rejects.toThrow('非公开');
    await expect(resolveProviderEndpoint('https://api.vendor.net/v1','responses',async()=>[])).rejects.toThrow('非公开');
    await expect(resolveProviderEndpoint('https://api.vendor.net/v1','responses',async()=>{throw new Error('sensitive failure');})).rejects.toThrow('暂时无法验证');
  });
  it('revalidates DNS on each call instead of trusting a previous public answer',async()=>{
    const resolver=vi.fn().mockResolvedValueOnce(['8.8.8.8']).mockResolvedValueOnce(['127.0.0.1']);
    await expect(resolveProviderEndpoint('https://api.vendor.net/v1','responses',resolver)).resolves.toBe('https://api.vendor.net/v1/responses');
    await expect(resolveProviderEndpoint('https://api.vendor.net/v1','responses',resolver)).rejects.toThrow('非公开');
    expect(resolver).toHaveBeenCalledTimes(2);
  });
  it('uses only the fixed DoH server and never sends model credentials to DNS',async()=>{
    const fetcher=vi.fn(async()=>new Response(JSON.stringify({Status:0,Answer:[{type:1,data:'8.8.8.8'}]})));vi.stubGlobal('fetch',fetcher);
    await resolvePublicDns('api.vendor.net');expect(fetcher).toHaveBeenCalledTimes(2);
    for(const [url,options] of fetcher.mock.calls as unknown as [string,RequestInit][]) {expect(new URL(url).origin).toBe('https://cloudflare-dns.com');expect(options.headers).toEqual({Accept:'application/dns-json'});expect(options.redirect).toBe('error');}
  });
});
