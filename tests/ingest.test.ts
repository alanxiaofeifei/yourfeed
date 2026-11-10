import {describe,it,expect,vi} from 'vitest';
import {parseRssFeed,isoDuration,inferTopics,importUrl} from '../server/ingest';
import {canonicalUrl,validatePublicUrl,fetchSafe,plainText,cleanHtml} from '../server/fetch-safe';
import type {Source} from '../shared/types';
const source:Source={id:'rss-juya',name:'橘鸦 AI 早报',platform:'rss',locator:'https://daily.juya.uk/rss.xml',topics:['ai'],enabled:true};
const rss=(html:string)=>`<rss><channel><item><title>日报</title><link>https://daily.juya.uk/issues/2026-11-10/</link><pubDate>Tue, 10 Nov 2026 01:00:00 GMT</pubDate><description>概览摘要</description><content:encoded><![CDATA[${html}]]></content:encoded></item></channel></rss>`;
describe('RSS provenance and duplicate prevention',()=>{
 it('retains issue and only splits complete linked story headings, not overview',async()=>{
  const result=await parseRssFeed(rss('<h2>概览</h2><h3>要闻</h3><ul><li>重复的摘要</li></ul><h2>要闻</h2><h3 id="s9"><a href="https://openai.com/index/example">模型 2.0 发布</a><code>#1</code></h3><blockquote>这是来源对新模型发布的详细整理，包含足够长的正文与原始链接。</blockquote><h3><a href="https://openai.com/index/example">模型 2.0 发布</a></h3><p>同一来源链接重复出现不应再生成一条新闻。</p>'),source);
  expect(result).toHaveLength(2);expect(result[0].kind).toBe('article');expect(result[1].kind).toBe('news');expect(result[1].parentId).toBe(result[0].id);expect(result[1].title).toBe('模型 2.0 发布');expect(result[1].body).toContain('不代表已独立核验');
  expect((await parseRssFeed(rss('<h3><a href="https://openai.com/index/example">模型 2.0 发布</a></h3><p>这是不同时间获取的同一篇新闻正文，应该使用稳定的内容标识。</p>'),source))[1].id).toBe(result[1].id);
 });
 it('does not merge distinct versions with different primary URLs',async()=>{
  const result=await parseRssFeed(rss('<h3><a href="https://openai.com/release/v1">模型 1.0</a></h3><p>这是模型第一个版本的发布内容以及与旧版本的区别。</p><h3><a href="https://openai.com/release/v2">模型 2.0</a></h3><p>这是模型第二个版本的发布内容以及与旧版本的区别。</p>'),source);expect(result).toHaveLength(3);expect(result[1].id).not.toBe(result[2].id);
 });
 it('rejects malformed feeds and DTD entity expansion',async()=>{
  await expect(parseRssFeed('not XML',source)).rejects.toThrow();
  await expect(parseRssFeed('<!DOCTYPE rss [<!ENTITY x SYSTEM "file:///secret">]><rss/>',source)).rejects.toThrow('实体');
 });
});
describe('URL boundaries',()=>{
 it.each(['http://www.ifanr.com/1','https://127.0.0.1/x','https://[::1]/','https://localhost/a','https://metadata.google.internal/','https://www.ifanr.com.evil.invalid/a','https://user:pass@www.ifanr.com/a','https://www.ifanr.com:8080/a','https://www.ifanr.com/unsubscribe?token=secret','https://www.ifanr.com/a?api_key=secret'])('rejects unsafe target %s',url=>{expect(()=>validatePublicUrl(url)).toThrow();});
 it('normalizes platform links and tracking without losing video ID',()=>{expect(canonicalUrl('https://youtu.be/abcdefghijk?si=tracking')).toBe('https://www.youtube.com/watch?v=abcdefghijk');expect(canonicalUrl('https://www.bilibili.com/video/BVabcdefghij?spm_id_from=123')).toBe('https://www.bilibili.com/video/BVabcdefghij');});
 it('rechecks redirects to internal targets',async()=>{
  const mock=vi.fn().mockResolvedValue(new Response(null,{status:302,headers:{location:'https://127.0.0.1/admin'}}));vi.stubGlobal('fetch',mock);await expect(fetchSafe('https://www.ifanr.com/123')).rejects.toThrow();expect(mock).toHaveBeenCalledTimes(1);vi.unstubAllGlobals();
 });
 it('never forwards API credentials across an allowed cross-origin redirect',async()=>{const fetcher=vi.fn().mockResolvedValue(new Response(null,{status:302,headers:{location:'https://www.ifanr.com/collect'}}));vi.stubGlobal('fetch',fetcher);await expect(fetchSafe('https://www.googleapis.com/youtube/v3/videos',{headers:{'X-Goog-Api-Key':'test-credential'}})).rejects.toThrow('跨站');expect(fetcher).toHaveBeenCalledTimes(1);vi.unstubAllGlobals();});
 it('keeps a manually imported followed X account separate from disabled auto-sync sources',async()=>{vi.stubGlobal('fetch',vi.fn().mockRejectedValue(new Error('unavailable')));const item=await importUrl('https://x.com/OpenAI/status/123456789',{} as any);expect(item.kind).toBe('post');expect(item.sourceId).toBe('manual-x-OpenAI');expect(item.id).toBe('x-123456789');vi.unstubAllGlobals();});
 it('rejects unexpectedly large source responses',async()=>{vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response('small',{headers:{'content-length':'9999999'}})));await expect(fetchSafe('https://www.ifanr.com/1')).rejects.toThrow('过大');vi.unstubAllGlobals();});
 it('cleans untrusted HTML scripts and javascript links',()=>{expect(plainText('<script>steal()</script><p>Hello</p>')).toBe('Hello');expect(cleanHtml('<a href="javascript:steal()">click</a><script>evil</script>')).not.toContain('javascript:');});
});
it('parses durations and favors relevant non-AI interests',()=>{expect(isoDuration('PT1H2M3S')).toBe(3723);expect(inferTopics('科学解释烹饪的物理原理')).toEqual(expect.arrayContaining(['science','cooking']));});
