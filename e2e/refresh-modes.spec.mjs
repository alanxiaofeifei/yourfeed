import {test,expect} from 'playwright/test';
import {mkdir} from 'node:fs/promises';
import {fixture} from './fixture.mjs';

async function setup(page,{language='en',mode='on_open',cron=true,age=0,delay=0,failedRead=false}={}){
 const f=await fixture(page,{language,populated:true});
 const policy={refreshMode:mode,effectiveRefreshMode:mode==='scheduled'&&!cron?'on_open':mode,enabled:mode==='scheduled',aiEnabled:false,intervalHours:6,schedulerConfigured:cron};
 const writes=[],syncs=[];
 await page.route('**/api/background',async route=>{
  if(route.request().method()==='PUT'){
   const body=route.request().postDataJSON();writes.push(body);Object.assign(policy,body);policy.enabled=policy.refreshMode==='scheduled';policy.effectiveRefreshMode=policy.refreshMode==='scheduled'&&!cron?'on_open':policy.refreshMode;
  }else{if(delay)await new Promise(resolve=>setTimeout(resolve,delay));if(failedRead)return route.fulfill({status:503,json:{error:'Synthetic unavailable'}});}
  return route.fulfill({json:policy});
 });
 await page.route('**/api/feed?**',route=>route.fulfill({json:{items:[],total:0,sources:1,nextCursor:null,lastUpdated:new Date(Date.now()-age*3600000).toISOString()}}));
 await page.route('**/api/sync',route=>{syncs.push(route.request().postDataJSON());return route.fulfill({json:{processed:0,pending:0,results:[]}});});
 await page.reload();await expect(page.locator('[data-tour=tour-launcher]')).toBeEnabled();
 return {...f,policy,writes,syncs};
}
async function nav(page,index){if(await page.locator('.mobile-menu').isVisible())await page.locator('.mobile-menu').click();await page.locator('.primary-nav').nth(1).locator('button').nth(index).click();}
async function storage(page){await nav(page,1);await page.locator('.settings-tabs button').nth(2).click();await expect(page.locator('#refresh-mode')).toBeVisible();}

for(const language of ['zh','en','zh-TW','vi'])test(`refresh F modes and AI reminder ${language}`,async({page})=>{
 await page.setViewportSize({width:language==='vi'?390:1280,height:900});const f=await setup(page,{language});await storage(page);
 const reminder=page.locator('#refresh-cost');await expect(reminder).toBeVisible();await expect(reminder).toContainText('AI');await expect(reminder).toContainText(/Key|key|khóa API/);
 for(const mode of ['manual','scheduled','on_open']){await page.locator('#refresh-mode').selectOption(mode);await expect(page.locator('#refresh-mode')).toBeEnabled();expect(f.writes.at(-1)).toEqual({refreshMode:mode});await expect(page.locator('#refresh-mode')).toHaveValue(mode);if(mode==='manual')await expect(page.locator('#refresh-interval')).toBeDisabled();else await expect(page.locator('#refresh-interval')).toBeEnabled();}
 await page.locator('#refresh-interval').selectOption('1');await expect(page.locator('#refresh-interval')).toBeEnabled();expect(f.writes.at(-1)).toEqual({intervalHours:1});
 await page.locator('#refresh-mode').selectOption('scheduled');await expect(page.locator('.refresh-settings input[type=checkbox]')).toBeEnabled();await page.locator('.refresh-settings input[type=checkbox]').check();await expect(page.locator('.refresh-settings input[type=checkbox]')).toBeEnabled();expect(f.writes.at(-1)).toEqual({aiEnabled:true});
 await page.reload();await storage(page);await expect(page.locator('#refresh-mode')).toHaveValue('scheduled');await expect(page.locator('#refresh-interval')).toHaveValue('1');await expect(page.locator('.refresh-settings input[type=checkbox]')).toBeChecked();expect(f.errors).toEqual([]);
});

test('refresh F manual waits for delayed policy, never auto-syncs on open, and allows the update button',async({page})=>{
 const f=await setup(page,{mode:'manual',age:48,delay:400});
 await storage(page);await expect(page.locator('#refresh-mode')).toHaveValue('manual');// Return home after the policy has settled.
 await page.locator('.primary-nav').first().locator('button').first().click();
 await expect(page.locator('[data-tour=feed-update]')).toBeEnabled();await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));expect(f.syncs).toHaveLength(0);
 await page.locator('[data-tour=feed-update]').click();await expect.poll(()=>f.syncs.length).toBe(1);expect(f.syncs[0].force).toBe(true);expect(f.errors).toEqual([]);
});

test('refresh F unavailable scheduler falls back to on-open and disables background selection',async({page})=>{
 const f=await setup(page,{mode:'scheduled',cron:false,age:48});await expect.poll(()=>f.syncs.length).toBe(1);expect(f.syncs[0].force).toBe(false);await storage(page);await expect(page.locator('#refresh-mode')).toHaveValue('on_open');await expect(page.locator('#refresh-mode option[value=scheduled]')).toBeDisabled();await expect(page.locator('#refresh-unavailable')).toBeVisible();await expect(page.locator('.refresh-settings input')).toBeDisabled();
});

for(const row of [{mode:'on_open',age:2,count:0},{mode:'on_open',age:48,count:1},{mode:'scheduled',age:48,count:0}])test(`refresh F home policy ${row.mode} age ${row.age}`,async({page})=>{
 const f=await setup(page,row);await storage(page);await expect(page.locator('#refresh-mode')).toHaveValue(row.mode);expect(f.syncs).toHaveLength(row.count);
});

test('refresh F failed read pauses automatic sync and failed save preserves selection',async({page})=>{
 const f=await setup(page,{age:48,failedRead:true});await nav(page,1);await page.locator('.settings-tabs button').nth(2).click();await expect(page.locator('.refresh-settings')).toContainText('Automatic refresh is paused');expect(f.syncs).toHaveLength(0);
 await page.route('**/api/background',route=>route.fulfill(route.request().method()==='PUT'?{status:503,json:{error:'Synthetic save failure'}}:{json:f.policy}));await page.locator('.refresh-settings button').click();await expect(page.locator('#refresh-mode')).toBeVisible();await page.locator('#refresh-mode').selectOption('manual');await expect(page.locator('.refresh-settings [role=alert]')).toBeVisible();await expect(page.locator('#refresh-mode')).toHaveValue('on_open');
});

for(const shot of [
 {file:'desktop-refresh-zh-CN.png',language:'zh',width:1280,cron:false},
 {file:'desktop-scheduled-zh-CN.png',language:'zh',width:1280,cron:true},
 {file:'mobile-refresh-zh-CN.png',language:'zh',width:390,cron:false},
 {file:'desktop-refresh-en.png',language:'en',width:1280,cron:false},
])test(`phase F screenshot ${shot.file}`,async({page})=>{
 test.skip(process.env.TOUR_SCREENSHOTS!=='1','Opt-in synthetic screenshots');await page.setViewportSize({width:shot.width,height:1000});const f=await setup(page,{...shot,mode:shot.cron?'scheduled':'on_open'});
 await page.route('**/api/storage',route=>route.fulfill({json:{enabled:false,days:90,expiringCount:0,expiredCount:0,estimatedBytes:0,limitBytes:null}}));
 await page.route('**/api/deployment',route=>route.fulfill({json:{hostname:'',currentOrigin:'http://127.0.0.1:4175',hostingMode:'standalone'}}));
 await storage(page);await page.locator('.refresh-settings').evaluate(el=>el.scrollIntoView({block:'start'}));await page.evaluate(()=>window.scrollBy(0,-100));await page.evaluate(()=>document.fonts.ready);
 const dir='/workspace/yourfeed-onboarding-20261112/phaseF-shots';await mkdir(dir,{recursive:true});await page.locator('.refresh-settings').screenshot({path:`${dir}/${shot.file}`,animations:'disabled'});expect(f.errors).toEqual([]);
});
