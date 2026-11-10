import {beforeEach,describe,it,expect,vi} from 'vitest';
const memory=vi.hoisted(()=>({sources:[] as any[],items:[] as any[],state:new Map<string,string>()}));
vi.mock('../server/db',()=>({listSources:async()=>memory.sources,listContent:async()=>memory.items,updateSource:async(_e:any,s:any)=>{memory.sources=[...memory.sources.filter(x=>x.id!==s.id),s];},getState:async(_e:any,k:string)=>memory.state.get(k)||null,setState:async(_e:any,k:string,v:string)=>{memory.state.set(k,v);}}));
import {createSource,updateSourceInput,deleteSource,normalizeSourceInput} from '../server/sources';
const env:any={DB:{prepare:(sql:string)=>({bind:(id:string,json?:string,...args:string[])=>({run:async()=>{if(sql.startsWith('INSERT')){const identity=args[args.length-1];const own=memory.sources.find(source=>source.id===id);if(memory.sources.some(source=>source.id!==id&&source._identityKey===identity)||(!own&&memory.sources.length>=200))return {meta:{changes:0}};memory.sources=[...memory.sources.filter(source=>source.id!==id),JSON.parse(json!)];}else memory.sources=memory.sources.filter(s=>s.id!==id);return {meta:{changes:1}};}})})}};
const publicDns=async()=>['93.184.216.34'];
beforeEach(()=>{memory.sources=[];memory.items=[];memory.state.clear();});
describe('owner-managed public content sources',()=>{
 it('starts empty and creates normalizes edits and deletes a generic RSS source',async()=>{
  expect(memory.sources).toHaveLength(0);
  const source=await createSource(env,{platform:'rss',name:'Independent science feed',locator:'https://Journal.Reader.NET/rss.xml?utm_source=copy',topics:['science'],enabled:true},publicDns);
  expect(source.locator).toBe('https://journal.reader.net/rss.xml');expect(source.topics).toEqual(['science']);expect(memory.sources).toHaveLength(1);
  expect(memory.state.get('sync-round-started')).toBe('0');
  await expect(createSource(env,{platform:'rss',locator:source.locator},publicDns)).rejects.toMatchObject({status:409});
  const updated=await updateSourceInput(env,{id:source.id,name:'My science feed',topics:['science','science','humanities'],enabled:false});
  expect(updated.name).toBe('My science feed');expect(updated.enabled).toBe(false);expect(updated.topics).toEqual(['science','humanities']);
  memory.items=[{id:'cached',sourceId:source.id}];memory.state.set('sync-queue',JSON.stringify([source.id,'another-source']));
  await deleteSource(env,source.id);expect(memory.sources).toHaveLength(0);expect(memory.items).toHaveLength(1);expect(JSON.parse(memory.state.get('sync-queue')!)).toEqual(['another-source']);
 });
 it.each([
  [{platform:'youtube',locator:'https://www.youtube.com/channel/UCabcdefghijklmnopqrstuv'},'UCabcdefghijklmnopqrstuv'],
  [{platform:'youtube',locator:'https://www.youtube.com/@ScienceCreator'},'ScienceCreator'],
  [{platform:'bilibili',locator:'https://space.bilibili.com/1234567890123456'},'1234567890123456'],
  [{platform:'github',locator:'https://github.com/Research-Lab?tab=stars'},'research-lab'],
  [{platform:'x',locator:'@ScienceWriter'},'https://x.com/ScienceWriter'],
 ])('normalizes supported platform identity %j',async(input,locator)=>{expect((await normalizeSourceInput(input,undefined,publicDns)).locator).toBe(locator);});
 it.each([
  {platform:'youtube',locator:'https://www.youtube.com/watch?v=abcdefghijk'},
  {platform:'bilibili',locator:'https://www.bilibili.com/video/BVabcdefghij'},
  {platform:'bilibili',locator:1234567890123456},
  {platform:'github',locator:'https://github.com/organization/repository'},
  {platform:'x',locator:'https://unrelated.reader.net/profile'},
  {platform:'unknown',locator:'whatever'},
  {platform:'rss',locator:'http://journal.reader.net/rss.xml'},
  {platform:'rss',locator:'https://127.0.0.1/rss'},
  {platform:'rss',locator:'https://journal.reader.net/rss.xml?token=private'},
  {platform:'rss',locator:'https://journal.reader.net/rss.xml',topics:['not-a-topic']},
  {platform:'rss',locator:'https://journal.reader.net/rss.xml',enabled:'true'},
 ])('rejects malformed or unsafe source %j',async input=>{await expect(createSource(env,input,publicDns)).rejects.toMatchObject({status:400});expect(memory.sources).toHaveLength(0);});
 it('rejects a generic hostname resolving to private addresses before saving',async()=>{await expect(createSource(env,{platform:'rss',locator:'https://journal.reader.net/rss.xml'},async()=>['93.184.216.34','127.0.0.1'])).rejects.toMatchObject({status:400});expect(memory.sources).toHaveLength(0);});
 it('resets source update cursor metadata when address changes and keeps existing ID',async()=>{const old=await createSource(env,{platform:'rss',locator:'https://journal.reader.net/rss.xml'},publicDns);memory.sources[0]={...old,lastSuccess:'2026-01-01T00:00:00Z',status:'error',error:'Previously unavailable'};const changed=await updateSourceInput(env,{id:old.id,locator:'https://journal.reader.net/another.xml'},publicDns);expect(changed.id).toBe(old.id);expect(changed.lastSuccess).toBeUndefined();expect(changed.error).toBeUndefined();});
 it('retains implicit imported-source block controls without a registry entry',async()=>{memory.items=[{sourceId:'import-source',sourceName:'Imported article',url:'https://journal.reader.net/article',topics:['science']}];const blocked:any=await updateSourceInput(env,{id:'import-source',blocked:true});expect(blocked.blocked).toBe(true);expect(blocked.status).toBe('manual');expect(memory.sources).toHaveLength(1);});
});
