import {describe,it,expect} from 'vitest';
import { groupNews } from '../server/dedup';
import type { ContentItem } from '../shared/types';
const item=(id:string,title:string,url:string,patch:Partial<ContentItem>={}):ContentItem=>({id,kind:'news',platform:'RSS',sourceId:id,sourceName:id,title,url,summary:'来源摘要',topics:['ai'],publishedAt:'2026-11-10T01:00:00Z',...patch});
const analysis=(references:string[])=>({bullets:['要点'],relevance:'相关',topics:['ai' as const],coverage:'excerpt' as const,references,model:'test'});
describe('conservative cross-source news grouping',()=>{
 it('groups canonical original URLs and retains source provenance and feedback',()=>{
  const rows=[item('a','OpenAI 发布 GPT-6.1','https://openai.com/news/gpt-6.1?utm_source=rss'),item('b','GPT-6.1 正式发布','https://openai.com/news/gpt-6.1',{liked:true,saved:true})];
  const result=groupNews(rows);expect(result).toHaveLength(1);expect(result[0].id).toBe('b');expect(result[0].liked).toBe(true);expect(result[0].saved).toBe(true);expect(result[0].relatedSources).toHaveLength(2);
 });
 it('groups only exact normalized full headlines within72hours',()=>{
  const rows=[item('a','Claude 5.2 发布','https://media.example/a'),item('b','Claude　5.2 发布','https://another.example/b'),item('c','Claude 5.2 发布','https://third.example/c',{publishedAt:'2026-11-14T01:00:00Z'})];
  expect(groupNews(rows)).toHaveLength(2);
 });
 it('never merges different model versions or explicit dates even with a common URL',()=>{
  const rows=[item('a','GPT-6.1 发布','https://openai.com/news/launch'),item('b','GPT-6.2 发布','https://openai.com/news/launch'),item('c','日报 2026-11-09','https://media.example/latest'),item('d','日报 2026-11-10','https://media.example/latest')];
  expect(groupNews(rows)).toHaveLength(4);
 });
 it('does not merge different stories because they cite the same daily issue',()=>{
  const parent=item('issue','AI早报','https://daily.juya.uk/issues/2026-11-10/',{kind:'article'});
  const rows=[item('a','Anthropic 发布模型','https://anthropic.com/news/new-model',{parentId:'issue',analysis:analysis([parent.url])}),item('b','OpenAI 更新应用','https://openai.com/news/new-app',{parentId:'issue',analysis:analysis([parent.url])})];
  expect(groupNews(rows,[parent,...rows])).toHaveLength(2);
 });
 it('can group shared original-article references and keeps other content kinds separate',()=>{
  const original='https://anthropic.com/news/claude-5.2';
  const rows=[item('a','Claude 5.2 模型发布','https://media.example/report',{analysis:analysis([original])}),item('b','Anthropic 上线 Claude 5.2','https://other.example/report',{analysis:analysis([original])}),item('c','Claude 5.2 模型发布','https://video.example/watch',{kind:'video'})];
  expect(groupNews(rows)).toHaveLength(2);
 });
});
