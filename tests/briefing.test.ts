import {describe,it,expect} from 'vitest';
import {selectBriefing,taipeiDate} from '../server/briefing';
import type {ContentItem,Source} from '../shared/types';
const NOW=new Date('2026-11-10T03:00:00Z');
const news=(id:string,title:string,patch:Partial<ContentItem>={}):ContentItem=>({id,kind:'news',platform:'RSS',sourceId:id,sourceName:id,title,url:'https://media.example/'+id,summary:'相关公开信息',topics:['ai'],publishedAt:'2026-11-10T01:00:00Z',...patch});
describe('personal major-news briefing',()=>{
 it('uses Taipei calendar day, including the UTC day boundary',()=>{
  expect(taipeiDate(new Date('2026-11-09T16:00:00Z'))).toBe('2026-11-10');
  const rows=[news('today','OpenAI 发布 GPT-6.1',{publishedAt:'2026-11-09T16:00:00Z'}),news('old','Claude 新模型发布',{publishedAt:'2026-11-09T15:59:59Z'})];
  const result=selectBriefing(rows,[],{},NOW);expect(result.date).toBe('2026-11-10');expect(result.window).toBe('today');expect(result.items.map(x=>x.item.id)).toEqual(['today']);
 });
 it('rejects future and invalid timestamps instead of treating them as latest',()=>{
  const rows=[news('future','OpenAI 发布模型',{publishedAt:'2026-11-10T04:00:00Z'}),news('invalid','Claude 模型发布',{publishedAt:'invalid'}),news('invalidday','GPT 模型发布',{publishedAt:'2026-02-30T00:00:00Z'})];
  expect(selectBriefing(rows,[],{},NOW).window).toBe('empty');
 });
 it('chooses practical enterprise news and filters gossip,promos,roundups,projects and videos',()=>{
  const rows=[news('gossip','Anthropic CEO 出轨后道歉'),news('promo','Claude 发布限时优惠码，订阅重置福利'),news('roundup','AI 早报 2026-11-10'),news('video','OpenAI 发布新模型',{kind:'video'}),news('project','OpenAI 发布新模型',{kind:'project'}),news('flashy','GPT 新模型发布，世界第一一夜斩杀'),news('practical','OpenAI 开放企业 Agent 部署，支持内网知识库与 IT 自动化')];
  const result=selectBriefing(rows,[],{},NOW);expect(result.items.map(x=>x.item.id)).toEqual(['practical','flashy']);expect(result.items[0].signal).toBe('部署与工作流');expect(result.items[0].reason).toContain('企业 AI');
 });
 it('respects source blocking and read/dismiss feedback, but does not hide saved unread news',()=>{
  const rows=[news('blocked','OpenAI 发布 GPT-6.1'),news('read','Claude 模型发布'),news('dismiss','GLM 模型发布'),news('saved','DeepSeek 模型开源')];
  const sources=[{id:'blocked',name:'blocked',platform:'rss',locator:'https://media.example/rss',topics:['ai'],enabled:true,blocked:true}] as (Source&{blocked:boolean})[];
  const result=selectBriefing(rows,sources,{read:{read:true},dismiss:{dismissed:true},saved:{saved:true}},NOW);expect(result.items.map(x=>x.item.id)).toEqual(['saved']);
 });
 it('deduplicates original URLs and caps the shortlist and one publisher',()=>{
  const rows=[news('a','GPT-6.1 模型发布',{url:'https://openai.com/news/gpt-6.1'}),news('duplicate','OpenAI 开放 GPT-6.1 模型',{url:'https://openai.com/news/gpt-6.1?utm_source=rss'}),news('b','OpenAI API 调整价格与配额'),news('c','Claude 企业 Agent 部署上线'),news('d','DeepSeek 发布安全修复，解决权限漏洞')];
  const result=selectBriefing(rows,[],{},NOW);expect(result.items).toHaveLength(3);expect(result.items.filter(x=>x.item.url.includes('openai.com/news/gpt'))).toHaveLength(1);expect(result.items.filter(x=>x.item.url.includes('media.example'))).toHaveLength(2);
 });
 it('falls back only within seven days and labels recency honestly',()=>{
  const result=selectBriefing([news('recent','Claude 新模型发布',{publishedAt:'2026-11-09T01:00:00Z'}),news('old','OpenAI API 调整价格',{publishedAt:'2026-11-01T01:00:00Z'})],[],{},NOW,'2026-11-10T02:55:00Z');
  expect(result.window).toBe('recent');expect(result.items[0].item.id).toBe('recent');expect(result.lastUpdated).toBe('2026-11-10T02:55:00Z');
  expect(selectBriefing([news('old','OpenAI 模型发布',{publishedAt:'2026-11-01T01:00:00Z'})],[],{},NOW).window).toBe('empty');
 });
 it('admits discrete imported announcements but excludes general tutorials',()=>{
  const rows=[news('article','OpenAI 发布企业部署新 API',{kind:'article'}),news('tutorial','如何在企业部署 OpenAI API 教程',{kind:'article'}),news('post','Claude 开放新的工具调用 API',{kind:'post'})];
  expect(selectBriefing(rows,[],{},NOW).items.map(x=>x.item.id).sort()).toEqual(['article','post']);
 });
 it('is deterministic for the same input and day',()=>{
  const rows=[news('a','OpenAI 模型发布'),news('b','Claude 企业部署上线'),news('c','DeepSeek API 调整价格')];
  expect(selectBriefing(rows,[],{},NOW)).toEqual(selectBriefing(rows,[],{},NOW));
 });
 it('excludes cosmetic agent layouts and ranks a flagship release above a minor feature',()=>{
  const rows=[news('cosmetic','Google Antigravity 推出 Knowledge Work 界面布局，隐藏终端和 Git',{summary:'AI Agent 工作流界面更新'}),news('feature','OpenAI 推出 Agent 工作流快捷操作',{summary:'企业工作流支持快捷操作'}),news('flagship','Anthropic 发布 Claude Fable 5.2 新模型',{summary:'新模型正式发布并开放使用'})];
  const result=selectBriefing(rows,[],{},NOW);expect(result.items.map(x=>x.item.id)).toEqual(['flagship','feature']);
 });
 it('includes explicit AI governance changes and permits substantial announcements despite UI wording',()=>{
  const rows=[news('governance','OpenAI 叫停无需审批的企业 Agent 任务',{summary:'增加权限控制与人工审批'}),news('model','Claude 发布新模型并更新界面',{summary:'正式开放新模型使用'})];
  const ids=selectBriefing(rows,[],{},NOW).items.map(x=>x.item.id);expect(ids).toContain('governance');expect(ids).toContain('model');
 });

});
