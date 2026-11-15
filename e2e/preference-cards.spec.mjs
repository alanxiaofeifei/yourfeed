import {test,expect} from 'playwright/test';
import {preferenceMessages} from '../shared/preference-messages.ts';
import {sourceCatalog} from '../shared/source-catalog.ts';
import {mkdir} from 'node:fs/promises';
import {preferenceFixture,openPreferences,answer,bank} from './preference-fixture.mjs';

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

for(const shot of [{file:'desktop-cards-zh-CN.png',width:1280,height:800,language:'zh'},{file:'mobile-cards-zh-CN.png',width:390,height:844,language:'zh'},{file:'desktop-cards-en.png',width:1280,height:800,language:'en'},{file:'desktop-cards-zh-TW.png',width:1280,height:800,language:'zh-TW'},{file:'desktop-cards-vi.png',width:1280,height:800,language:'vi'}])test(`phase B screenshot ${shot.file}`,async({page})=>{
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

for(const ai of [false,true])test(`preference cards: live ${ai?'AI':'curated'} locale switch keeps answers and position`,async({page})=>{
 const initial=ai?'en':'zh',target=ai?'zh-TW':'vi';
 const f=await preferenceFixture(page,{language:initial,ai});await openPreferences(page);
 if(ai){await page.locator('[data-pref=generate]').click();await expect(page.locator('.preference-dialog h3')).toHaveText('Synthetic AI question for your interests?');}
 await answer(page,'B');await answer(page,'A');
 const select=page.locator('.preference-dialog .language-toggle select');
 for(const language of [target,initial,target]){
  const m=preferenceMessages[language],q=bank[language][2];await select.selectOption(language);
  await expect(page.locator('.preference-dialog h2')).toHaveText(m.title);await expect(page.locator('.preference-dialog h3')).toHaveText(q.prompt);
  for(const [choice,option] of [['A',q.optionA],['B',q.optionB]]){await expect(page.locator(`[data-pref-choice=${choice}] strong`)).toHaveText(option.label);await expect(page.locator(`[data-pref-choice=${choice}] span`).last()).toHaveText(option.subtitle);}
  await expect(page.locator('.preference-progress')).toHaveText(m.progress.replace('{n}','3').replace('{left}','7'));
  await expect(page.locator('progress')).toHaveAttribute('value','2');expect(f.state.answers).toEqual({q1:'B',q2:'A'});expect(f.generations).toHaveLength(ai?1:0);
 }
 await page.locator('[data-pref=back]').click();await expect(page.locator('[data-pref-choice=A]')).toHaveAttribute('aria-pressed','true');await answer(page,'A');
 await page.locator('[data-pref=manual]').click();await page.locator('#preference-interest').fill('My own text');await select.selectOption(initial);await expect(page.locator('#preference-interest')).toHaveValue('My own text');await expect(page.locator('.preference-dialog h2')).toHaveText(preferenceMessages[initial].manual);
 await page.locator('[data-pref=manual]').click();for(let i=2;i<10;i++)await answer(page);
 await page.locator('[data-pref-source=openai-news]').uncheck();
 for(const language of [target,initial]){
  await select.selectOption(language);const m=preferenceMessages[language];
  await expect(page.locator('progress')).toHaveAttribute('value','10');await expect(page.locator('.preference-dialog h2')).toHaveText(m.review);
  for(const id of ['github-blog','sspai']){const entry=sourceCatalog.find(entry=>entry.id===id),row=page.locator('.preference-source-list label').filter({has:page.locator(`[data-pref-source=${id}]`)});await expect(row).toContainText(entry.description[language]);await expect(row).toContainText(m.sourceLanguages[entry.language]);await expect(row.locator('strong')).toHaveText(entry.name);}
  await expect(page.locator('[data-pref-source=openai-news]')).not.toBeChecked();
 }
 await page.locator('[data-pref=close]').click();expect(f.state).toMatchObject({position:10,language:initial,source:'curated',answers:{q1:'B',q2:'A'}});expect(f.generations).toHaveLength(ai?1:0);expect(f.errors).toEqual([]);
});

test('preference cards: stale AI response is discarded; explicit retry uses the live locale',async({page})=>{
 const f=await preferenceFixture(page,{ai:true,generation:'held'});await openPreferences(page);await page.locator('[data-pref=generate]').click();await expect.poll(()=>f.generations.length).toBe(1);
 const select=page.locator('.preference-dialog .language-toggle select');await select.selectOption('zh-TW');
 await expect(page.locator('.preference-dialog')).toHaveAttribute('aria-busy','false');await expect(page.locator('.preference-dialog h3')).toHaveText(bank['zh-TW'][0].prompt);
 f.controls.releaseGeneration();await answer(page,'B');await expect(page.locator('.preference-dialog h3')).toHaveText(bank['zh-TW'][1].prompt);expect(f.generations).toEqual(['en']);expect(f.state.answers).toEqual({q1:'B'});
 await page.locator('[data-pref=back]').click();await page.locator('[data-pref=generate]').click();await expect.poll(()=>f.generations.length).toBe(2);f.controls.releaseGeneration();
 await expect(page.locator('.preference-dialog h3')).toHaveText('為你的興趣產生的模擬 AI 題目？');expect(f.generations).toEqual(['en','zh-TW']);expect(f.state.source).toBe('ai');
 await select.selectOption('en');await expect(page.locator('.preference-dialog h3')).toHaveText(bank.en[0].prompt);await answer(page,'A');await page.locator('[data-pref=close]').click();await page.locator('[data-preference-entry]').first().click();await expect(page.locator('.preference-dialog h3')).toHaveText(bank.en[1].prompt);expect(f.state.answers).toEqual({q1:'A'});expect(f.errors).toEqual([]);
});

test('preference cards: fallback notice follows the live locale without another AI call',async({page})=>{
 const f=await preferenceFixture(page,{ai:true,generation:'429'});await openPreferences(page);await page.locator('[data-pref=generate]').click();await expect(page.locator('.preference-dialog')).toContainText(preferenceMessages.en.fallback);
 for(const language of ['vi','en']){await page.locator('.preference-dialog .language-toggle select').selectOption(language);await expect(page.locator('.preference-dialog')).toContainText(preferenceMessages[language].fallback);await expect(page.locator('.preference-dialog h3')).toHaveText(bank[language][0].prompt);}
 expect(f.generations).toEqual(['en']);expect(f.errors).toEqual([]);
});


test('preference cards: delayed load and save responses follow the current locale',async({page})=>{
 const f=await preferenceFixture(page,{ai:true});f.state.source='ai';f.state.questions[0].prompt='Synthetic AI question for your interests?';f.state.answers={q1:'B'};f.state.position=1;f.controls.holdLoad=true;
 await page.locator('[data-preference-entry]').first().click();await expect.poll(()=>typeof f.controls.releaseLoad).toBe('function');
 const select=page.locator('.preference-dialog .language-toggle select');await select.selectOption('zh-TW');f.controls.releaseLoad();
 await expect(page.locator('.preference-dialog h3')).toHaveText(bank['zh-TW'][1].prompt);await expect(page.locator('progress')).toHaveAttribute('value','1');
 f.controls.holdSave=true;await page.locator('[data-pref-choice=A]').click();await expect.poll(()=>typeof f.controls.releaseSave).toBe('function');await select.selectOption('vi');f.controls.releaseSave();
 await expect(page.locator('.preference-dialog')).toHaveAttribute('aria-busy','false');await expect(page.locator('.preference-dialog h3')).toHaveText(bank.vi[2].prompt);await expect(page.locator('progress')).toHaveAttribute('value','2');
 f.controls.holdSave=false;await answer(page);expect(f.state).toMatchObject({language:'vi',source:'curated',position:3,answers:{q1:'B',q2:'A',q3:'A'}});expect(f.generations).toEqual([]);expect(f.errors).toEqual([]);
});
