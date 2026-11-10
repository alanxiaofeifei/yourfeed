import {describe,it,expect} from 'vitest';
import type { ContentItem, Source } from '../shared/types';
import {rankFeed,feedPage,sourceGroup} from '../server/ranking';
const item=(id:string,topics:ContentItem['topics'],patch:Partial<ContentItem>={}):ContentItem=>({id,kind:'video',platform:'YouTube',sourceId:id,sourceName:id,title:id,url:'https://www.youtube.com/watch?v='+id,summary:'',publishedAt:new Date().toISOString(),topics,...patch});
describe('personalized feed',()=>{
 it('changes theme priority without treating a subscription as an explicit like',()=>{
  const rows=[item('cook',['cooking']),item('network',['network'])];
  expect(rankFeed(rows,[],{},'rest')[0].id).toBe('cook');
  expect(rankFeed(rows,[],{},'grow')[0].id).toBe('network');
  expect(rankFeed(rows,[],{cook:{liked:true}},'grow')[0].id).toBe('cook');
 });
 it('applies feedback and blocks the aggregate GitHub source despite publisher IDs',()=>{
  const rows=[item('a',['science']),item('b',['science']),item('repo',['tools'],{kind:'project',platform:'GitHub',sourceId:'github:owner'})];
  const sources:Source[]=[{id:'github-stars',name:'Stars',platform:'github',locator:'sampleuser',topics:['tools'],enabled:false}];
  expect(rankFeed(rows,sources,{a:{read:true},b:{dismissed:true}},'rest')).toHaveLength(0);
  expect(rankFeed(rows,[],{a:{read:true}},'rest','all','read').map(i=>i.id)).toEqual(['a']);
 });
 it('limits a publisher per page and allows browsing later pages without duplicates',()=>{
  const rows=Array.from({length:12},(_,i)=>item('v'+i,['science'],{sourceId:'same-channel'}));
  const a=feedPage(rows,0),b=feedPage(rows,a.nextCursor!);
  expect(a.items.length).toBe(2);expect(b.items.length).toBe(2);expect(new Set([...a.items,...b.items].map(i=>i.id)).size).toBe(4);
 });
 it('normalizes project publishers and prevents hundreds of Stars occupying a mixed page',()=>{
  const repos=Array.from({length:40},(_,i)=>item('r'+i,['tools'],{kind:'project',platform:'GitHub',url:'https://github.com/owner'+i+'/repo'}));
  const videos=Array.from({length:20},(_,i)=>item('v'+i,['making']));
  const page=feedPage([...repos,...videos],0);
  expect(page.items.length).toBe(20);expect(page.items.filter(i=>i.kind==='project').length).toBe(8);
  expect(sourceGroup(repos[0])).toBe('github:owner0');
 });
});
