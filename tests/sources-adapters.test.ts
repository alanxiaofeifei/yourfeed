import {afterEach,beforeEach,it,expect,vi} from 'vitest';
const memory=vi.hoisted(()=>({state:new Map<string,string>(),sources:[] as any[]}));
vi.mock('../server/db',()=>({listSources:async()=>memory.sources,upsertContent:vi.fn(),updateSource:vi.fn(),getState:async(_e:any,k:string)=>memory.state.get(k)||null,setState:async(_e:any,k:string,v:string)=>{memory.state.set(k,v);},getSecret:async()=> 'test-only-youtube-key'}));
import {syncSources} from '../server/ingest';
beforeEach(()=>{memory.state.clear();memory.sources=[];});afterEach(()=>vi.unstubAllGlobals());
it('queries a supplied YouTube channel ID as id, using only the fixed official endpoint',async()=>{
 memory.sources=[{id:'source-channel',name:'Science channel',platform:'youtube',locator:'UCabcdefghijklmnopqrstuv',topics:['science'],enabled:true}];
 const fetcher=vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({items:[{contentDetails:{relatedPlaylists:{uploads:'UUabcdefghijklmnopqrstuv'}}}]}))).mockResolvedValueOnce(new Response(JSON.stringify({items:[]})));vi.stubGlobal('fetch',fetcher);
 const env:any={DB:{prepare:()=>({bind:()=>({run:async()=>({meta:{changes:1}})})})}};
 const result=await syncSources(env,{force:true});expect(result.results[0].ok).toBe(true);
 const first=new URL(fetcher.mock.calls[0][0]);expect(first.origin).toBe('https://www.googleapis.com');expect(first.pathname).toBe('/youtube/v3/channels');expect(first.searchParams.get('id')).toBe('UCabcdefghijklmnopqrstuv');expect(first.searchParams.has('forHandle')).toBe(false);expect(first.searchParams.has('key')).toBe(false);
 for(const [url,options] of fetcher.mock.calls){expect(new URL(url).origin).toBe('https://www.googleapis.com');expect(options.headers['X-Goog-Api-Key']).toBe('test-only-youtube-key');}
});
