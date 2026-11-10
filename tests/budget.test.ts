import {describe,it,expect} from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync,readdirSync } from 'node:fs';
import { reserveUsage,settleUsage,getUsage,usagePeriod,upsertContent,listContent,type Env } from '../server/db';
function environment():Env {
 const db=new DatabaseSync(':memory:');for(const f of readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())db.exec(readFileSync('drizzle/'+f,'utf8'));
 const prepare=(sql:string)=>{
  const statement=db.prepare(sql);
  const bound=(args:any[])=>({run:async()=>({meta:{changes:Number(statement.run(...args).changes)}}),first:async()=>statement.get(...args)||null,all:async()=>({results:statement.all(...args)})});
  return {bind:(...args:any[])=>bound(args),...bound([])};
 };
 return {DB:{prepare,batch:async(statements:any[])=>Promise.all(statements.map(s=>s.run()))}} as unknown as Env;
}
describe('AI budget reservations against actual SQL migrations',()=>{
 it('reserves atomically, prevents duplicate inflight work and retains uncertain costs',async()=>{
  const env=environment(),period=usagePeriod();const args={...period,maxCost:1,monthlyBudget:2,dailyLimit:20,contentId:'a'};
  expect(await reserveUsage(env,{...args,reservationId:'a1'})).toBe(true);
  expect(await reserveUsage(env,{...args,reservationId:'a2'})).toBe(false);
  await settleUsage(env,{reservationId:'a1',cost:0,inputTokens:0,outputTokens:0,success:false,uncertain:true});
  expect((await getUsage(env)).reserved).toBe(1);
  expect(await reserveUsage(env,{...args,contentId:'b',reservationId:'b1'})).toBe(true);
  expect(await reserveUsage(env,{...args,contentId:'c',reservationId:'c1'})).toBe(false);
 });
 it('limits even zero-cost connection tests to five per ten minutes',async()=>{const env=environment();const period=usagePeriod();const results=await Promise.all(Array.from({length:8},(_,i)=>reserveUsage(env,{...period,reservationId:'test-'+i,contentId:'connection-test',maxCost:0,dailyLimit:20,monthlyBudget:0,isTest:true})));expect(results.filter(Boolean)).toHaveLength(5);});
 it('counts charged malformed output towards budget while releasing definitive failures',async()=>{
  const env=environment(),period=usagePeriod();const args={...period,maxCost:1,monthlyBudget:1,dailyLimit:20,contentId:'a'};
  expect(await reserveUsage(env,{...args,reservationId:'a1'})).toBe(true);
  await settleUsage(env,{reservationId:'a1',cost:.8,inputTokens:100,outputTokens:80,success:false});
  expect(await reserveUsage(env,{...args,contentId:'b',reservationId:'b1'})).toBe(false);
  expect((await getUsage(env)).cost).toBe(.8);
  expect((await getUsage(env)).analyzedToday).toBe(1);
 });
});

describe('analysis retention during source refresh',()=>{
 it('preserves unchanged analysis and invalidates it when source text changes',async()=>{
  const env=environment();const item={id:'article1',kind:'article' as const,platform:'RSS',sourceId:'rss',sourceName:'RSS',title:'DNS 基础',url:'https://example.com/dns',summary:'DNS 原理',publishedAt:new Date().toISOString(),topics:['network' as const]};
  const analysis={bullets:['域名解析'],relevance:'网络基础',topics:['network' as const],coverage:'excerpt' as const,references:[item.url],model:'test'};
  await upsertContent(env,[{...item,analysis}]);await upsertContent(env,[item]);
  expect((await listContent(env))[0].analysis?.model).toBe('test');
  await upsertContent(env,[{...item,summary:'新内容：DNS 缓存问题'}]);
  expect((await listContent(env))[0].analysis).toBeUndefined();
 });
});
