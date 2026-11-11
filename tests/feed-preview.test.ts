import {describe,it,expect} from 'vitest';
import {validateFeedPreview} from '../server/source-import';
import {sourceCatalog} from '../shared/source-catalog';
describe('entry-level feed preview verification',()=>{
 it('validates actual RSS, Atom and RDF entries including social entries without titles',()=>{
  expect(validateFeedPreview('<rss><channel><item><title>Science</title><link>https://reader.net/post</link></item></channel></rss>')).toMatchObject({status:'valid',format:'RSS',items:1});
  expect(validateFeedPreview('<feed><entry><title>AI</title><link rel="alternate" href="https://reader.net/post"/></entry></feed>')).toMatchObject({status:'valid',format:'Atom'});
  expect(validateFeedPreview('<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><item><description>Social content without title</description><link>https://reader.net/post</link></item></rdf:RDF>')).toMatchObject({status:'valid',format:'RDF'});
 });
 it('distinguishes an empty feed from verified entries, and rejects HTML/error-feed false success',()=>{
  expect(validateFeedPreview('<rss><channel><title>New feed</title></channel></rss>').status).toBe('empty');
  expect(()=>validateFeedPreview('<html><body>Not a feed</body></html>')).toThrow();
  expect(()=>validateFeedPreview('<rss><channel><item><title>RSS-Bridge Error</title><description>Exception: captcha</description><link>https://bridge.reader.net/error</link></item></channel></rss>')).toThrow();
 });
 it('does not label unsafe, HTTP-only, or missing-link entries valid',()=>{
  for(const link of ['http://reader.net/post','https://127.0.0.1/post','https://reader.net/post?token=secret',''])expect(()=>validateFeedPreview(`<rss><channel><item><title>A post</title><link>${link}</link></item></channel></rss>`)).toThrow();
  expect(()=>validateFeedPreview('<!DOCTYPE rss><rss><channel/></rss>')).toThrow();
 });
 it('offers eight explicit starter choices and distinguishes valid feed snapshots from adapter readiness',()=>{
  expect(sourceCatalog.filter(item=>item.starter)).toHaveLength(8);expect(sourceCatalog.every(item=>!!item.verification)).toBe(true);
  expect(sourceCatalog.find(item=>item.id==='raschka')?.verification).toMatchObject({status:'needs-adapter',items:20});expect(sourceCatalog.find(item=>item.id==='huggingface')?.verification.coverage).toBe('metadata');expect(sourceCatalog.some(item=>item.locator==='https://www.ifanr.com/app/feed')).toBe(false);
 });
});
