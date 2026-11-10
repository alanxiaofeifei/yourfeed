import {describe,expect,it} from 'vitest';
import type {ContentItem,Source} from '../shared/types';
import {rotatedFeedPage,validateFeedBatchInput,weightedFeedOrder,type FeedBatchOptions} from '../server/feed-rotation';
import {sourceGroup} from '../server/ranking';

const seed='12345678-1234-4234-8234-123456789abc';
const asOf='2026-11-10T12:00:00.000Z';
function item(id:string,patch:Partial<ContentItem>={}):ContentItem{return {id,kind:'video',platform:'YouTube',sourceId:'source-'+id,sourceName:'Example source',title:'Science and making '+id,url:'https://video.reader.net/'+id,summary:'Useful scientific experiments.',topics:['science','making'],publishedAt:'2026-11-01T00:00:00Z',...patch};}
function options(patch:Partial<FeedBatchOptions>={}):FeedBatchOptions{return {mode:'rest',type:'all',filter:'all',q:'',cursor:0,excludeIds:[],seed,asOf,...patch};}
describe('cached feed rotation',()=>{
  it('keeps a seed stable and paginates without overlap while another seed yields a different batch',()=>{
    const rows=Array.from({length:100},(_,index)=>item('item-'+index));const first=rotatedFeedPage(rows,[],{},options()),again=rotatedFeedPage(rows,[],{},options());expect(first).toEqual(again);expect(first.items).toHaveLength(20);expect(first.hasMore).toBe(true);expect(first.exhausted).toBe(false);const second=rotatedFeedPage(rows,[],{},options({cursor:first.nextCursor!}));expect(second.items.every(row=>!new Set(first.items.map(value=>value.id)).has(row.id))).toBe(true);expect(rotatedFeedPage(rows,[],{},options({seed:'87654321-1234-4234-8234-123456789abc'})).items.map(row=>row.id)).not.toEqual(first.items.map(row=>row.id));
  });
  it('excludes recently/currently shown items and never falls back to them when exhausted',()=>{
    const rows=[item('shown'),item('also-shown')];const result=rotatedFeedPage(rows,[],{},options({excludeIds:rows.map(row=>row.id)}));expect(result).toMatchObject({items:[],nextCursor:null,hasMore:false,total:0,exhausted:true});const last=rotatedFeedPage(rows,[],{},options({excludeIds:['shown']}));expect(last.items.map(row=>row.id)).toEqual(['also-shown']);expect(last).toMatchObject({hasMore:false,exhausted:false});
  });
  it('honors explicit feedback, disabled/blocked sources, type and query filters',()=>{
    const rows=[item('read'),item('dismissed'),item('disabled'),item('blocked'),item('match',{kind:'article',url:'https://science.reader.net/experiments'}),item('different',{kind:'article',title:'English learning',topics:['english'],summary:'Language learning.'}),item('repo',{kind:'project',platform:'GitHub',sourceId:'github:someone',url:'https://github.com/someone/project'})];
    const sources:Source[]=[{id:'source-disabled',name:'Disabled',platform:'youtube',locator:'demo',topics:[],enabled:false},{id:'source-blocked',name:'Blocked',platform:'youtube',locator:'demo',topics:[],enabled:true,...{blocked:true}},{id:'github-stars',name:'Stars',platform:'github',locator:'someone',topics:[],enabled:false}];
    const result=rotatedFeedPage(rows,sources,{read:{read:true},dismissed:{dismissed:true}},options({type:'article',q:'science'}));expect(result.items.map(row=>row.id)).toEqual(['match']);expect(result.items[0].reason).toBeTruthy();
  });
  it('keeps two-per-source limits on every rotated page and balances project-heavy mixed content',()=>{
    const videos=Array.from({length:40},(_,index)=>item('video-'+index,{sourceId:'channel-'+Math.floor(index/5)}));const projects=Array.from({length:80},(_,index)=>item('project-'+index,{kind:'project',platform:'GitHub',url:'https://github.com/owner'+index+'/repo'}));const rows=[...videos,...projects];const seen=new Set<string>();let cursor:number|null=0;
    for(let pageIndex=0;pageIndex<4&&cursor!==null;pageIndex++){const page=rotatedFeedPage(rows,[],{},options({cursor}));const counts=new Map<string,number>();for(const row of page.items){expect(seen.has(row.id)).toBe(false);seen.add(row.id);const group=sourceGroup(row);counts.set(group,(counts.get(group)||0)+1);}expect(Math.max(...counts.values())).toBeLessThanOrEqual(2);if(pageIndex===0)expect(page.items.filter(row=>row.kind==='project').length).toBeLessThanOrEqual(8);cursor=page.nextCursor;}
  });
  it('keeps normal rank preference while exploring beyond the first page',()=>{
    const rows=Array.from({length:1000},(_,index)=>item('rank-'+index));let rankTotal=0,explored=false;for(let index=0;index<40;index++){const sample=weightedFeedOrder(rows,seed.slice(0,-2)+index.toString(16).padStart(2,'0')).slice(0,20);rankTotal+=sample.reduce((total,row)=>total+Number(row.id.replace('rank-','')),0);if(sample.some(row=>Number(row.id.replace('rank-',''))>20))explored=true;}expect(rankTotal/(40*20)).toBeLessThan(250);expect(explored).toBe(true);expect(rows[0].id).toBe('rank-0');
  });
  it('excludes other copies of an already shown/read news event without merging a different version',()=>{
    const rows=[item('shown-news',{kind:'news',title:'Example model 2.0 released with new features',url:'https://first.reader.net/model-2'}),item('copy-news',{kind:'news',title:'Example model 2.0 released with new features',url:'https://second.reader.net/model-2'}),item('new-version',{kind:'news',title:'Example model 2.1 released with new features',url:'https://second.reader.net/model-2-1'})];const result=rotatedFeedPage(rows,[],{'shown-news':{read:true}},options({excludeIds:['shown-news']}));expect(result.items.map(row=>row.id)).toEqual(['new-version']);
  });
  it('keeps model versions sharing one release URL separate when displaying and excluding news',()=>{
    const rows=[item('gpt61',{kind:'news',title:'GPT-6.1 发布',url:'https://openai.com/news/launch'}),item('gpt62',{kind:'news',title:'GPT-6.2 发布',url:'https://openai.com/news/launch'})];
    expect(new Set(rotatedFeedPage(rows,[],{},options()).items.map(row=>row.id))).toEqual(new Set(['gpt61','gpt62']));
    expect(rotatedFeedPage(rows,[],{},options({excludeIds:['gpt61']})).items.map(row=>row.id)).toEqual(['gpt62']);
  });
  it('keeps different daily-issue fragment stories separate when displaying and excluding news',()=>{
    const parent=item('issue',{kind:'article',title:'Daily issue',url:'https://daily.juya.uk/issues/2026-11-01/'});const rows=[parent,item('story1',{kind:'news',title:'Anthropic 发布新的模型',url:parent.url+'#story1',parentId:parent.id}),item('story2',{kind:'news',title:'NASA 公布新的研究进展',url:parent.url+'#story2',parentId:parent.id})];
    expect(new Set(rotatedFeedPage(rows,[],{},options({type:'news'})).items.map(row=>row.id))).toEqual(new Set(['story1','story2']));
    expect(rotatedFeedPage(rows,[],{},options({type:'news',excludeIds:['story1']})).items.map(row=>row.id)).toEqual(['story2']);
  });
  it('excludes actual same-event copies even when the shown member is not the displayed group representative',()=>{
    const rows=[item('shown',{kind:'news',title:'OpenAI 发布 GPT-6.1',url:'https://openai.com/news/gpt-6.1?utm_source=rss'}),item('liked-copy',{kind:'news',title:'GPT-6.1 正式发布',url:'https://openai.com/news/gpt-6.1'})];
    expect(rotatedFeedPage(rows,[],{'liked-copy':{liked:true}},options()).items.map(row=>row.id)).toEqual(['liked-copy']);
    expect(rotatedFeedPage(rows,[],{'liked-copy':{liked:true}},options({excludeIds:['shown']})).items).toEqual([]);
  });
  it('does not repeat the same article/video/project URL under another imported ID',()=>{
    const rows=[item('rss-original',{kind:'article',url:'https://www.journal.reader.net/story?utm_source=rss#intro'}),item('manual-copy',{kind:'article',url:'https://journal.reader.net/story'}),item('video-original',{url:'https://www.youtube.com/watch?v=demo123&si=share'}),item('video-copy',{url:'https://youtu.be/demo123'}),item('project-original',{kind:'project',url:'https://github.com/demo/tool?utm_source=share'}),item('project-copy',{kind:'project',url:'https://github.com/demo/tool#readme'}),item('distinct-version',{kind:'article',url:'https://journal.reader.net/story?version=2'})];
    const excluded=rotatedFeedPage(rows,[],{},options({excludeIds:['rss-original','video-original','project-original']}));expect(excluded.items.map(row=>row.id)).toEqual(['distinct-version']);
    const oneCopy=rotatedFeedPage(rows,[],{},options());expect(oneCopy.items).toHaveLength(4);expect(oneCopy.items.filter(row=>row.kind==='article')).toHaveLength(2);expect(oneCopy.items.filter(row=>row.kind==='video')).toHaveLength(1);expect(oneCopy.items.filter(row=>row.kind==='project')).toHaveLength(1);
  });
  it('validates bounded input and requires the original timestamp for later pages',()=>{
    const valid=validateFeedBatchInput({seed,mode:'grow',excludeIds:['a','a']},Date.parse(asOf));expect(valid).toMatchObject({mode:'grow',asOf,excludeIds:['a'],cursor:0});
    for(const patch of [{seed:'not-a-uuid'},{mode:'invalid'},{type:'invalid'},{filter:'saved'},{q:'x'.repeat(201)},{cursor:0.5},{cursor:1001},{cursor:1},{excludeIds:Array(201).fill('a')},{excludeIds:['x'.repeat(201)]},{excludeIds:['bad\nvalue']},{asOf:'invalid'},{asOf:'2099-01-01T00:00:00Z'}])expect(()=>validateFeedBatchInput({seed,...patch},Date.parse(asOf))).toThrow();
  });
});
