import {test,expect} from 'playwright/test';
import {mkdir} from 'node:fs/promises';
import {fixture} from './fixture.mjs';
import {preferenceFixture,openPreferences} from './preference-fixture.mjs';

const labels={zh:{label:'免费公开通道（OVHcloud / Pollinations）',restore:'恢复默认',notice:'可能较慢、限流或失败'},en:{label:'Free public channel (OVHcloud / Pollinations)',restore:'Restore default',notice:'slow, rate limited or fail'},'zh-TW':{label:'免費公開通道（OVHcloud / Pollinations）',restore:'恢復預設',notice:'可能較慢、限流或失敗'},vi:{label:'Kênh công khai miễn phí (OVHcloud / Pollinations)',restore:'Khôi phục mặc định',notice:'có thể chậm, bị giới hạn hoặc lỗi'}};
async function settingsFixture(page,{language='zh',own=false}={}){
 const f=await fixture(page,{language});let usingFreeAi=!own;const writes=[];
 const config=()=>({provider:'openai',model:'gpt-6.1-sol',enabled:false,monthlyBudget:20,dailyLimit:20,configured:own,keyLast4:own?'DEMO':undefined,freeAiAvailable:true,usingFreeAi,providers:own?[{provider:'openai',configured:true,keyLast4:'DEMO'}]:[]});
 await page.route('**/api/settings',async route=>{if(route.request().method()==='PUT'){const body=route.request().postDataJSON();writes.push(body);usingFreeAi=body.restoreDefaultAi===true;}return route.fulfill({json:config()});});
 await page.reload();if(await page.locator('.mobile-menu').isVisible())await page.locator('.mobile-menu').click();await page.locator('.primary-nav button').last().click();await page.locator('.settings-tabs button').nth(1).click();await expect(page.locator('.free-ai-channel')).toBeVisible();return {...f,writes};
}
for(const language of ['zh','en','zh-TW','vi'])test(`free AI settings ${language}: restore preserves saved keys, masks the channel and own settings remain editable`,async({page})=>{
 await page.setViewportSize({width:language==='vi'?390:1280,height:844});const f=await settingsFixture(page,{language,own:true});const channel=page.locator('.free-ai-channel');await expect(channel).toContainText(labels[language].notice);
 await channel.getByRole('button',{name:labels[language].restore,exact:true}).click();await expect(channel.locator('input')).toBeDisabled();await expect(channel.locator('input')).toHaveAttribute('type','password');await expect(channel.locator('input')).toHaveValue('••••••••');expect(f.writes).toEqual([{restoreDefaultAi:true}]);await expect(page.locator('label[for=ai-key]')).toContainText('DEMO');
 const contents=await page.content();expect(contents).not.toMatch(/kepler\.ai|text\.pollinations\.ai/);
 await page.locator('#ai-model').fill('gpt-6-luna');await page.locator('.ai-save-button').click();await expect(page.locator('.free-ai-channel input')).toHaveCount(0);expect(f.writes[1]).toMatchObject({aiChannel:'own',model:'gpt-6-luna'});expect(f.writes[1].clearKey).toBeUndefined();expect(f.errors).toEqual([]);
});
for(const generation of ['valid','slow-valid','curated','invalid','429','timeout'])test(`free AI preferences ${generation}: no own key is required and fallback is visible`,async({page})=>{
 const f=await preferenceFixture(page,{free:true,generation});await openPreferences(page);await expect(page.locator('[data-pref=generate]')).toBeVisible();const started=Date.now();const aborted=generation==='timeout'?page.waitForEvent('requestfailed',{predicate:req=>req.url().endsWith('/api/preference-cards/generate')}):null;await page.locator('[data-pref=generate]').click();
 if(generation==='slow-valid'){await page.waitForTimeout(6100);await expect(page.locator('.preference-dialog')).toHaveAttribute('aria-busy','true');}
 await expect(page.locator('.preference-dialog')).toHaveAttribute('aria-busy','false',{timeout:10000});expect(Date.now()-started).toBeLessThan(10000);
 if(aborted){expect(Date.now()-started).toBeGreaterThanOrEqual(9000);expect((await aborted).failure().errorText).toContain('ERR_ABORTED');}
 const ai=generation==='valid'||generation==='slow-valid';expect(f.generations).toHaveLength(1);expect(f.state.source).toBe(ai?'ai':'curated');
 if(!ai)await expect(page.locator('.preference-dialog p[role=status]')).toHaveText('Using the curated question bank.');expect(f.commits).toHaveLength(0);expect(f.errors).toEqual([]);
});
for(const shot of [{file:'desktop-ai-settings-zh-CN.png',width:1280,height:900},{file:'mobile-ai-settings-zh-CN.png',width:390,height:844}])test(`phase D screenshot ${shot.file}`,async({page})=>{
 test.skip(process.env.TOUR_SCREENSHOTS!=='1','Opt-in synthetic screenshot evidence');await page.setViewportSize({width:shot.width,height:shot.height});const f=await settingsFixture(page);await page.evaluate(()=>document.fonts.ready);await page.locator('.ai-settings-page').scrollIntoViewIfNeeded();const directory='/workspace/yourfeed-onboarding-20261112/phaseD-shots';await mkdir(directory,{recursive:true});await page.screenshot({path:`${directory}/${shot.file}`,animations:'disabled'});expect(f.errors).toEqual([]);
});
