import {test,expect} from 'playwright/test';
import {mkdir} from 'node:fs/promises';
import {fixture} from './fixture.mjs';

const copy={zh:{dislike:'不喜欢',undo:'撤销',review:'不喜欢的内容',restore:'撤销不喜欢',reason:'因为你喜欢「科学探索」'},en:{dislike:'Not interested',undo:'Undo',review:'Not interested history',restore:'Undo not interested',reason:'Because you like “Science”'},'zh-TW':{dislike:'不喜歡',undo:'復原',review:'不喜歡的內容',restore:'撤銷不喜歡',reason:'因為你喜歡「科學探索」'},vi:{dislike:'Không quan tâm',undo:'Hoàn tác',review:'Lịch sử không quan tâm',restore:'Hoàn tác không quan tâm',reason:'Vì bạn thích “Khoa học”'}};
async function learningFixture(page,{language='zh',delay=0,fail=false,count=3,pageSize=count}={}){
 const f=await fixture(page,{language,populated:true});const feedback={},writes=[],reads=[];
 const rows=Array.from({length:count},(_,i)=>({id:'learning-'+i,kind:'article',platform:'RSS',sourceId:'synthetic-'+i,sourceName:language.startsWith('zh')?'合成科学周刊':'Synthetic Science',title:language.startsWith('zh')?['合成示例：把好奇心变成一次小实验','合成示例：观察身边的微小变化','合成示例：为下一次探索留个问题'][i]||'合成科学示例 '+i:['Synthetic: turn curiosity into a small experiment','Synthetic: notice the small changes around you','Synthetic: a question for the next exploration'][i]||'Synthetic science '+i,summary:language.startsWith('zh')?'这是用于本地验证的合成内容，介绍从日常观察开始的科学探索。':'Synthetic content for local testing: start exploring science with everyday observations.',body:'Synthetic reading text.',url:'https://example.com/synthetic/'+i,topics:['science'],publishedAt:'2026-11-15T00:00:00Z',reason:copy[language].reason}));
 await page.route('**/api/feedback',async route=>{
  const body=route.request().postDataJSON();writes.push(body);
  if(delay)await new Promise(resolve=>setTimeout(resolve,delay));
  if(fail)return route.fulfill({status:503,json:{error:'Synthetic feedback failure'}});
  feedback[body.id]={...feedback[body.id],...body.patch,updatedAt:new Date().toISOString()};return route.fulfill({json:{ok:true,feedback:feedback[body.id]}});
 });
 for(const endpoint of ['/api/feed','/api/feed/batch','/api/library'])await page.route(url=>url.pathname===endpoint,async route=>{
  const url=new URL(route.request().url());reads.push(url.pathname);const filter=url.searchParams.get('filter');
  const items=rows.map(row=>({...row,...feedback[row.id]})).filter(row=>filter==='disliked'?row.disliked||row.dismissed:!row.disliked&&!row.dismissed);
  const cursor=Number(url.searchParams.get('cursor')||0);return route.fulfill({json:{items:items.slice(cursor*pageSize,(cursor+1)*pageSize),total:items.length,sources:3,nextCursor:(cursor+1)*pageSize<items.length?cursor+1:null}});
 });
 await page.reload();await expect(page.locator('.content-card')).toHaveCount(Math.min(count,pageSize));return {...f,writes,feedback,reads,copy:copy[language]};
}
const card=page=>page.locator('[data-item-id="learning-0"]');
for(const language of ['zh','en','zh-TW','vi'])test(`learning ${language}: reason, optimistic dislike and early keyboard Undo`,async({page})=>{
 await page.setViewportSize({width:language==='zh'?390:1280,height:900});const f=await learningFixture(page,{language,delay:1000});
 await expect(card(page).locator('.card-reason')).toHaveText(f.copy.reason);
 await card(page).getByRole('button',{name:f.copy.dislike,exact:true}).click();
 await expect(card(page)).toHaveCount(0);await expect(page.locator('.dislike-toast [role=status]')).toBeVisible();
 expect(f.feedback['learning-0']).toBeUndefined();
 const undo=page.locator('.dislike-toast').getByRole('button',{name:f.copy.undo,exact:true});await undo.focus();await page.keyboard.press('Enter');
 await expect(card(page)).toBeVisible();await expect(page.locator('.content-card').first()).toHaveAttribute('data-item-id','learning-0');
 await expect.poll(()=>f.writes.length).toBe(2);await expect.poll(()=>f.feedback['learning-0']?.disliked).toBe(false);
 await expect(card(page)).toBeVisible();expect(f.writes.map(write=>write.patch.disliked)).toEqual([true,false]);expect(f.errors).toEqual([]);
});
test('reader dislike survives toast expiry and reload, and can be undone in history',async({page})=>{
 const f=await learningFixture(page);await card(page).locator('.card-title').click();await expect(page.locator('.reader-modal')).toBeVisible();
 await page.locator('.reader-footer').getByRole('button',{name:f.copy.dislike,exact:true}).click();await expect(page.locator('.reader-modal')).toHaveCount(0);await expect(card(page)).toHaveCount(0);
 await expect(page.locator('.dislike-toast')).toBeVisible();await expect(page.locator('.dislike-toast')).toHaveCount(0,{timeout:7500});
 await page.reload();await expect(card(page)).toHaveCount(0);
 await page.locator('.primary-nav').getByRole('button',{name:f.copy.review,exact:true}).click();await expect(card(page)).toBeVisible();
 await card(page).getByRole('button',{name:f.copy.restore,exact:true}).click();await expect(card(page)).toHaveCount(0);await expect.poll(()=>f.feedback['learning-0'].disliked).toBe(false);
 await page.locator('.primary-nav button').first().click();await expect(card(page)).toBeVisible();expect(f.errors).toEqual([]);
});
test('failed dislike rolls back',async({page})=>{
 const f=await learningFixture(page,{delay:600,fail:true});await card(page).getByRole('button',{name:f.copy.dislike,exact:true}).click();await expect(card(page)).toHaveCount(0);
 await expect(card(page)).toBeVisible();await expect(page.locator('.toast')).toContainText('Synthetic feedback failure');expect(f.errors).toEqual([]);
});
test('slow dislike cannot replace another view when its response arrives',async({page})=>{
 const f=await learningFixture(page,{delay:700});await card(page).getByRole('button',{name:f.copy.dislike,exact:true}).click();
 await page.locator('.primary-nav').getByRole('button',{name:f.copy.review,exact:true}).click();await expect(page.locator('.ranking-cost')).toContainText('可随时撤销');
 await expect.poll(()=>f.feedback['learning-0']?.disliked).toBe(true);
 await expect(page.locator('.content-card')).toHaveCount(0);expect(f.errors).toEqual([]);
});
test('dislike refresh retains loaded pages and Undo restores a card beyond the first page',async({page})=>{
 const f=await learningFixture(page,{count:6,pageSize:3});await page.locator('.load-more').click();await expect(page.locator('.content-card')).toHaveCount(6);
 const later=page.locator('[data-item-id="learning-4"]');await later.getByRole('button',{name:f.copy.dislike,exact:true}).click();
 await expect(page.locator('.content-card')).toHaveCount(5);await expect.poll(()=>f.reads.length).toBeGreaterThan(2);
 await page.locator('.dislike-toast').getByRole('button',{name:f.copy.undo,exact:true}).click();await expect(page.locator('.content-card')).toHaveCount(6);
 await expect.poll(()=>f.feedback['learning-4']?.disliked).toBe(false);await expect(page.locator('.content-card').nth(4)).toHaveAttribute('data-item-id','learning-4');expect(f.errors).toEqual([]);
});
test('a late AI result cannot reopen a reader after dislike',async({page})=>{
 const f=await learningFixture(page);
 await page.route('**/api/analyze',async route=>{await new Promise(resolve=>setTimeout(resolve,800));return route.fulfill({json:{item:{id:'learning-0',analysis:{bullets:['Synthetic note'],relevance:'Synthetic analysis',topics:['science'],coverage:'excerpt',references:[],model:'synthetic'}}}});});
 await card(page).locator('.card-title').click();const completed=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/analyze');
 await page.locator('.analyze-button').click();await page.locator('.reader-footer').getByRole('button',{name:f.copy.dislike,exact:true}).click();
 await (await completed).finished();await page.locator('.dislike-toast').getByRole('button',{name:'关闭提示',exact:true}).click();
 await expect(page.locator('.toast')).toContainText('AI 阅读已完成。');await expect(page.locator('.reader-modal')).toHaveCount(0);await expect(card(page)).toHaveCount(0);expect(f.errors).toEqual([]);
});
for(const shot of [{file:'desktop-card-zh-CN.png',width:1280,height:1000,language:'zh'},{file:'desktop-toast-zh-CN.png',width:1280,height:1000,language:'zh',toast:true},{file:'mobile-card-zh-CN.png',width:390,height:844,language:'zh'},{file:'desktop-card-en.png',width:1280,height:1000,language:'en'}])test(`phase C screenshot ${shot.file}`,async({page})=>{
 test.skip(process.env.TOUR_SCREENSHOTS!=='1','Opt-in synthetic screenshot evidence');await page.setViewportSize({width:shot.width,height:shot.height});const f=await learningFixture(page,{language:shot.language});
 await page.evaluate(()=>document.fonts.ready);await card(page).scrollIntoViewIfNeeded();
 if(shot.toast){await card(page).getByRole('button',{name:f.copy.dislike,exact:true}).click();await expect(page.locator('.dislike-toast')).toBeVisible();}
 const directory='/workspace/yourfeed-onboarding-20261112/phaseC-shots';await mkdir(directory,{recursive:true});await page.screenshot({path:`${directory}/${shot.file}`,animations:'disabled'});expect(f.errors).toEqual([]);
});
