import {test,expect} from 'playwright/test';
import {mkdir} from 'node:fs/promises';
import {preferenceFixture,openPreferences,answer} from './preference-fixture.mjs';

for(const language of ['zh','en','zh-TW','vi'])test(`preference cards: ${language} confirms selected key-free sources and undoes only new sources`,async({page})=>{
 await page.setViewportSize({width:language==='vi'?390:1280,height:844});
 const f=await preferenceFixture(page,{language});await openPreferences(page);
 await expect(page.locator('.preference-progress')).toContainText('1');await expect(page.locator('[data-pref=generate]')).toHaveCount(0);
 for(let i=0;i<10;i++){await expect(page.locator('progress')).toHaveAttribute('value',String(i));await answer(page);}
 expect(f.commits).toHaveLength(0);expect(f.profile.version).toBe(1);
 await expect(page.locator('[data-pref-source=github-blog]')).toBeDisabled();
 await page.locator('[data-pref-source=openai-news]').uncheck();
 await page.locator('[data-pref=confirm]').click();await expect(page.locator('[data-pref=undo]')).toBeEnabled();
 expect(f.commits.length).toBeGreaterThan(0);expect(f.commits.every(batch=>batch.candidates.length<=10)).toBe(true);
 expect(f.commits.flatMap(b=>b.candidates).every(s=>s.platform==='rss'&&s.id!=='github-blog'&&s.id!=='openai-news')).toBe(true);
 expect(f.profile.topicWeights.code).toBeGreaterThan(0);expect(f.state.completedAt).toBeTruthy();
 const added=f.sources.filter(s=>s.id!=='existing-github');await page.locator('[data-pref=undo]').click();await expect(page.locator('.preference-dialog')).toHaveAttribute('aria-busy','false');await expect(page.locator('[data-pref=undo]')).toBeDisabled();
 expect(f.deletes.sort()).toEqual(added.map(s=>s.id).sort());expect(f.sources.map(s=>s.id)).toEqual(['existing-github']);expect(f.errors).toEqual([]);
 await page.locator('[data-pref=close]').click();await page.locator('[data-preference-entry]').first().click();await expect(page.locator('[data-pref=restart]')).toBeVisible();await page.locator('[data-pref=restart]').click();await expect(page.locator('progress')).toHaveAttribute('value','0');
});

test('preference cards: skip, keyboard, restore, manual interest and profile settings entry',async({page})=>{
 const f=await preferenceFixture(page);await openPreferences(page);
 await page.keyboard.press('2');await expect(page.locator('progress')).toHaveAttribute('value','1');await expect(page.locator('.preference-dialog')).toHaveAttribute('aria-busy','false');
 await page.locator('[data-pref=skip]').click();await expect(page.locator('progress')).toHaveAttribute('value','2');await expect(page.locator('.preference-dialog')).toHaveAttribute('aria-busy','false');
 expect(f.state.answers).toEqual({q1:'B',q2:'skipped'});
 await page.locator('[data-pref=close]').click();await expect(page.locator('.preference-dialog')).toHaveCount(0);
 await page.reload();await page.locator('[data-preference-entry]').first().click();await expect(page.locator('progress')).toHaveAttribute('value','2');
 await page.locator('[data-pref=manual]').click();await page.locator('#preference-interest').fill('Learn sourdough baking');await page.locator('.preference-topics label').filter({hasText:'Food science'}).locator('input').check();await page.locator('[data-pref=manual-review]').click();
 await expect(page.locator('[data-pref-source=king-arthur-baking]')).toBeVisible();expect(f.commits).toHaveLength(0);
 await page.locator('[data-pref=confirm]').click();await expect(page.locator('[data-pref=undo]')).toBeEnabled();expect(f.profile.goals[0]).toBe('Learn sourdough baking');
 await page.locator('[data-pref=close]').click();await page.locator('[data-preference-entry]').first().click();await page.locator('[data-pref=restart]').click();await page.locator('[data-pref=skip-all]').click();await expect(page.locator('.preference-dialog')).toHaveCount(0);expect(Object.values(f.state.answers)).toEqual(Array(10).fill('skipped'));
 // The manual exit opens the existing editable preference settings.
 await page.locator('[data-preference-entry]').first().click();await page.locator('[data-pref=manual]').click();await page.getByRole('button',{name:'Open manual settings',exact:true}).click();await expect(page.locator('#profile-goals')).toBeVisible();await expect(page.locator('.profile-page [data-preference-entry]')).toBeVisible();
});

test('preference cards: failed progress retains choices, retry persists, stale tab can reload',async({page})=>{
 const f=await preferenceFixture(page,{failSave:true});await openPreferences(page);await answer(page);
 await expect(page.locator('.preference-dialog [role=alert]')).toBeVisible();expect(f.state.revision).toBe(0);expect(f.commits).toHaveLength(0);
 f.controls.failSave=false;await page.getByRole('button',{name:'Retry',exact:true}).click();await expect(page.locator('.preference-dialog [role=alert]')).toHaveCount(0);expect(f.state.answers.q1).toBe('A');
 f.state.revision++;await answer(page);await expect(page.locator('.preference-dialog [role=alert]')).toBeVisible();await page.getByRole('button',{name:'Reload saved progress',exact:true}).click();await expect(page.locator('.preference-dialog [role=alert]')).toHaveCount(0);await expect(page.locator('progress')).toHaveAttribute('value','1');
});

for(const generation of ['valid','slow-valid','invalid','429','timeout'])test(`preference cards: AI ${generation} path stays usable`,async({page})=>{
 const f=await preferenceFixture(page,{ai:true,generation});await openPreferences(page);const started=Date.now();const aborted=generation==='timeout'?page.waitForEvent('requestfailed',{predicate:req=>req.url().endsWith('/api/preference-cards/generate')}):null;await page.locator('[data-pref=generate]').click();
 if(generation==='slow-valid'){await page.waitForTimeout(6100);await expect(page.locator('.preference-dialog')).toHaveAttribute('aria-busy','true');}
 await expect(page.locator('.preference-dialog')).toHaveAttribute('aria-busy','false',{timeout:10000});expect(Date.now()-started).toBeLessThan(10000);
 if(aborted){expect(Date.now()-started).toBeGreaterThanOrEqual(9000);expect((await aborted).failure().errorText).toContain('ERR_ABORTED');}
 const ai=generation==='valid'||generation==='slow-valid';await expect(page.locator('.preference-dialog h3')).toHaveText(ai?'Synthetic AI question for your interests?':'What do you want most when opening YourFeed?');expect(f.generations).toHaveLength(1);expect(f.state.source).toBe(ai?'ai':'curated');expect(f.commits).toHaveLength(0);await answer(page);await expect(page.locator('progress')).toHaveAttribute('value','1');expect(f.errors).toEqual([]);
});

for(const shot of [{file:'desktop-cards-zh-CN.png',width:1280,height:800,language:'zh'},{file:'mobile-cards-zh-CN.png',width:390,height:844,language:'zh'},{file:'desktop-cards-en.png',width:1280,height:800,language:'en'}])test(`phase B screenshot ${shot.file}`,async({page})=>{
 test.skip(process.env.TOUR_SCREENSHOTS!=='1','Opt-in synthetic screenshots');await page.setViewportSize({width:shot.width,height:shot.height});await preferenceFixture(page,{language:shot.language});await openPreferences(page);await page.evaluate(()=>document.fonts.ready);const directory='/workspace/yourfeed-onboarding-20261112/phaseB-shots';await mkdir(directory,{recursive:true});await page.screenshot({path:`${directory}/${shot.file}`,animations:'disabled'});
});

test('preference cards: curated-source entry owns focus and restores its source dialog',async({page})=>{
 const f=await preferenceFixture(page);await page.locator('[data-tour=sources-nav]').click();await page.locator('[data-tour=source-discover]').click();
 const outer=page.locator('.source-import-modal');await expect(outer).toBeVisible();await outer.locator('[data-preference-entry]').click();await expect(page.locator('.preference-dialog')).toHaveAttribute('aria-busy','false');
 await expect(outer).toHaveJSProperty('inert',true);
 await page.keyboard.press('Shift+Tab');for(let i=0;i<12;i++){expect(await page.evaluate(()=>!!document.activeElement.closest('.preference-dialog'))).toBe(true);await page.keyboard.press('Tab');}
 await page.keyboard.press('Escape');await expect(page.locator('.preference-dialog')).toHaveCount(0);await expect(outer).toHaveJSProperty('inert',false);await expect(outer.locator('[data-preference-entry]')).toBeFocused();expect(f.commits).toHaveLength(0);expect(f.errors).toEqual([]);
});

test('preference cards: unavailable progress storage never traps the owner',async({page})=>{
 const f=await preferenceFixture(page,{failSave:true});await openPreferences(page);await answer(page);await expect(page.locator('.preference-dialog [role=alert]')).toBeVisible();
 await page.locator('[data-pref=close]').click();await expect(page.locator('.preference-dialog')).toHaveCount(0);expect(f.commits).toHaveLength(0);expect(f.state.revision).toBe(0);
});
