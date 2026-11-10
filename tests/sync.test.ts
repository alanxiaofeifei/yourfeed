import {beforeEach,afterEach,describe,it,expect,vi} from 'vitest';
const state=vi.hoisted(()=>({values:new Map<string,string>(),items:[] as any[],sources:[] as any[]}));
vi.mock('../server/db',()=>({
 listSources:vi.fn(async()=>structuredClone(state.sources)),upsertContent:vi.fn(async(_env,items)=>state.items.push(...items)),
 updateSource:vi.fn(async(_env,s)=>{state.sources=state.sources.map(x=>x.id===s.id?s:x);}),
 getState:vi.fn(async(_env,k)=>state.values.get(k)||null),setState:vi.fn(async(_env,k,v)=>{state.values.set(k,v);}),getSecret:vi.fn(async()=>undefined),
}));
import {syncSources} from '../server/ingest';
const env:any={DB:{prepare:(sql:string)=>({bind:(...args:any[])=>({run:async()=>{
 if(sql.startsWith('UPDATE sources')){
  const [raw,id,locator,platform]=args;const current=state.sources.find(s=>s.id===id&&s.locator===locator&&s.platform===platform&&s.enabled&&!s.blocked);
  if(!current)return {meta:{changes:0}};
  for(const [key,value] of Object.entries(JSON.parse(raw))){if(value===null)delete current[key];else current[key]=value;}
 }
 return {meta:{changes:1}};
}})})}};
beforeEach(()=>{state.values.clear();state.items=[];state.sources=[1,2,3].map(i=>({id:'rss-'+i,name:'Feed '+i,platform:'rss',locator:'https://daily.juya.uk/feed'+i+'.xml',topics:['ai'],enabled:true}));});
afterEach(()=>{vi.unstubAllGlobals();vi.restoreAllMocks();});
describe('resumable on-demand refresh',()=>{
 it('continues one persisted queue even when subsequent batches repeat force=true',async()=>{
  const fetcher=vi.fn(async(url:string)=>new Response(`<rss><channel><item><title>Article</title><link>https://daily.juya.uk/issues/${url.slice(-5,-4)}/</link><description>Summary</description></item></channel></rss>`));vi.stubGlobal('fetch',fetcher);
  expect((await syncSources(env,{force:true,limit:1})).pending).toBe(2);
  expect((await syncSources(env,{force:true,limit:1})).pending).toBe(1);
  expect((await syncSources(env,{force:true,limit:1})).pending).toBe(0);
  expect((await syncSources(env,{force:true,limit:1})).processed).toBe(0);
  expect(fetcher).toHaveBeenCalledTimes(3);expect(state.items).toHaveLength(3);
 });
 it('records source failure and advances the queue while preserving existing content',async()=>{
  state.items=[{id:'existing'}];vi.stubGlobal('fetch',vi.fn(async()=>new Response('blocked',{status:429})));
  const r=await syncSources(env,{force:true,limit:1});expect(r.pending).toBe(2);expect(r.results[0].ok).toBe(false);expect(state.items).toEqual([{id:'existing'}]);expect(state.sources[0].status).toBe('error');expect(state.sources[0].lastSuccess).toBeUndefined();expect(state.values.get('last-sync')).toBeUndefined();
 });

 it.each(['pause','block','delete','edit'] as const)('preserves owner %s while a refresh request is in flight',async action=>{
  let release!:(value:Response)=>void;const pending=new Promise<Response>(resolve=>{release=resolve;});
  const fetcher=vi.fn(()=>pending);vi.stubGlobal('fetch',fetcher);
  const task=syncSources(env,{force:true,limit:1});
  await vi.waitFor(()=>expect(fetcher).toHaveBeenCalledTimes(1));
  if(action==='pause')state.sources[0].enabled=false;
  if(action==='block')state.sources[0].blocked=true;
  if(action==='delete')state.sources=state.sources.filter(s=>s.id!=='rss-1');
  if(action==='edit')state.sources[0].locator='https://daily.juya.uk/replacement.xml';
  release(new Response('<rss><channel><item><title>Late response</title><link>https://daily.juya.uk/posts/late</link><description>Old address response</description></item></channel></rss>'));
  await task;const current=state.sources.find(s=>s.id==='rss-1');
  if(action==='pause')expect(current.enabled).toBe(false);
  if(action==='block')expect(current.blocked).toBe(true);
  if(action==='delete')expect(current).toBeUndefined();
  if(action==='edit')expect(current.locator).toBe('https://daily.juya.uk/replacement.xml');
  expect(state.items).toHaveLength(0);
 });
 it('excludes blocked and disabled sources before making a network request',async()=>{
  state.sources[0].blocked=true;state.sources[1].enabled=false;state.sources[2].platform='x';const fetcher=vi.fn();vi.stubGlobal('fetch',fetcher);const r=await syncSources(env,{force:true});expect(r.processed).toBe(0);expect(fetcher).not.toHaveBeenCalled();
 });
});
