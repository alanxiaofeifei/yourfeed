import {describe,it,expect} from 'vitest';
import {rankFeed} from '../server/ranking';
import {selectBriefing} from '../server/briefing';
import {createProfile} from '../shared/profile';
import type {ContentItem} from '../shared/types';
const now=new Date('2026-11-10T03:00:00Z');
const content=(id:string,title:string,topics:ContentItem['topics'],patch:Partial<ContentItem>={}):ContentItem=>({id,title,topics,kind:'news',platform:'RSS',sourceId:id,sourceName:'Example source',url:'https://news.example/'+id,summary:'A report describing the announced findings and evidence.',publishedAt:'2026-11-10T01:00:00Z',...patch});
describe('Profile-aware ranking and briefings',()=>{
 it('lets the same content pool follow different explicit topic preferences',()=>{
  const items=[content('science','New science research released',['science']),content('network','Network protocol update',['network'])];
  const explorer={...createProfile('explorer'),goals:[],topicWeights:{science:1,network:0}};const technical={...createProfile('it-ai'),goals:[],topicWeights:{science:0,network:1}};
  expect(rankFeed(items,[],{},'grow','all','all','',explorer)[0].id).toBe('science');expect(rankFeed(items,[],{},'grow','all','all','',technical)[0].id).toBe('network');
 });
 it('uses English interface reasons while retaining differently-language summaries',()=>{
  const profile={...createProfile('explorer','en'),summaryLanguage:'zh' as const,goals:[]};const item=content('science','Science research released',['science'],{analysis:{bullets:['中文摘要'],relevance:'中文关联',topics:['science'],coverage:'excerpt',references:['https://news.example/science'],model:'example-model',summaryLanguage:'zh',profileVersion:1}});
  const ranked=rankFeed([item],[],{},'grow','all','all','',profile);expect(ranked[0].reason).toContain('Science');expect(ranked[0].reason).not.toMatch(/[\u4e00-\u9fff]/);expect(ranked[0].analysis?.bullets).toEqual(['中文摘要']);
 });
 it('personalizes the shortlist beyond AI, keeps three items maximum and explains relevance in English',()=>{
  const profile={...createProfile('explorer','en'),goals:['Understand food science'],topicWeights:{science:1,cooking:1,ai:0}};
  const rows=[content('a','Scientists release new food research',['science','cooking']),content('b','Researchers announce new astronomy findings',['science']),content('c','A new nutrition study published',['science']),content('d','OpenAI launches a new model',['ai'])];
  const result=selectBriefing(rows,[],{},now,undefined,profile);expect(result.items.length).toBeLessThanOrEqual(3);expect(result.items.some(row=>row.item.id==='a')).toBe(true);expect(result.items.some(row=>row.item.id==='d')).toBe(false);for(const row of result.items){expect(row.reason).not.toMatch(/[\u4e00-\u9fff]/);expect(row.signal).not.toMatch(/[\u4e00-\u9fff]/);}
 });
 it('uses the profile timezone to select the actual local calendar day',()=>{
  const profile={...createProfile('explorer','en'),timezone:'America/Los_Angeles',goals:[],topicWeights:{science:1}};
  const rows=[content('today','Scientists release research',['science'],{publishedAt:'2026-11-09T23:00:00Z'}),content('yesterday','Scientists release findings',['science'],{publishedAt:'2026-11-09T07:00:00Z'})];
  const result=selectBriefing(rows,[],{},now,undefined,profile);expect(result.date).toBe('2026-11-09');expect(result.timeZone).toBe('America/Los_Angeles');expect(result.items.map(row=>row.item.id)).toEqual(['today']);
 });
});
