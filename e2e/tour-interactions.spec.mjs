import { test, expect } from 'playwright/test';
import { fixture } from './fixture.mjs';

test('mobile modal user scroll and viewport resize preserve control access',async({page})=>{
  await page.setViewportSize({width:390,height:844});
  await fixture(page,{populated:true});
  await page.locator('[data-tour="tour-launcher"]').click();
  await page.locator('.tour-chapters select').selectOption('sources');
  const tour=page.locator('.tour-region');
  await tour.getByRole('button',{name:'Next',exact:true}).click();
  await tour.getByRole('button',{name:'Go to this control',exact:true}).click();
  const dialog=page.locator('[role="dialog"]');
  await expect(dialog.locator('.tour-region')).toBeVisible();
  const scroll=await dialog.evaluate(async el=>{
    const max=el.scrollHeight-el.clientHeight;
    el.scrollTop=Math.min(max,60);
    await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
    const chosen=el.scrollTop;
    for(let i=0;i<4;i++) await new Promise(resolve=>requestAnimationFrame(resolve));
    return {max,chosen,settled:el.scrollTop};
  });
  expect(scroll.max).toBeGreaterThan(0);
  expect(scroll.chosen).toBeGreaterThan(0);
  expect(scroll.settled).toBeCloseTo(scroll.chosen,0);
  await page.setViewportSize({width:390,height:600});
  await expect.poll(()=>tour.evaluate(el=>{
    const rect=el.getBoundingClientRect(),viewport=window.visualViewport;
    const top=viewport?.offsetTop||0,height=viewport?.height||innerHeight;
    return rect.top>=top-1&&rect.bottom<=top+height+1;
  })).toBe(true);
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  console.log('TOUR_RESIZE_GEOMETRY',await page.evaluate(()=>{
    const rect=selector=>document.querySelector(selector).getBoundingClientRect().toJSON();
    const dialog=document.querySelector('[role="dialog"]');
    return {target:rect('[data-tour="source-confirm"]'),panel:rect('.tour-region'),dialog:rect('[role="dialog"]'),maxHeight:dialog.style.maxHeight,marginBottom:dialog.style.marginBottom};
  }));
  const confirm=page.locator('[data-tour="source-confirm"]');
  await expect(confirm).toBeVisible();
  await expect.poll(()=>confirm.evaluate(el=>{
    const rect=el.getBoundingClientRect();
    const panel=document.querySelector('.tour-region').getBoundingClientRect();
    const dialog=document.querySelector('[role="dialog"]');
    return {clear:!(rect.left<panel.right&&rect.right>panel.left&&rect.top<panel.bottom&&rect.bottom>panel.top),target:rect.toJSON(),panel:panel.toJSON(),dialog:dialog.getBoundingClientRect().toJSON(),maxHeight:dialog.style.maxHeight,marginBottom:dialog.style.marginBottom};
  })).toMatchObject({clear:true});
  await page.keyboard.press('Escape');
  await expect(tour).toHaveCount(0);
  expect(await dialog.evaluate(el=>({maxHeight:el.style.maxHeight,marginBottom:el.style.marginBottom}))).toEqual({maxHeight:'',marginBottom:''});
});

for (const width of [1280,390]) {
  test(`independent keyboard navigation and Resume later ${width}`,async({page})=>{
    await page.setViewportSize({width,height:width===390?844:800});
    const f=await fixture(page,{populated:true,patchLatency:250});
    const tour=page.locator('.tour-region');
    await page.locator('[data-tour="tour-launcher"]').click();
    await tour.getByRole('button',{name:'Resume',exact:true}).click();
    await expect(tour).toHaveAttribute('data-step','welcome.language');
    await tour.locator('h2').focus();
    await page.keyboard.press('ArrowRight');
    await expect(tour).toHaveAttribute('data-step','profile.interests');
    await page.keyboard.press('ArrowLeft');
    await expect(tour).toHaveAttribute('data-step','welcome.language');
    // Native selects and disclosure summaries must keep their own arrow behavior.
    await page.locator('[data-tour="language"] select').focus();
    await page.keyboard.press('ArrowRight');
    await expect(tour).toHaveAttribute('data-step','welcome.language');
    await page.locator('[data-tour="language"] select').selectOption('en');
    await tour.locator('.tour-help summary').focus();
    await page.keyboard.press('ArrowRight');
    await expect(tour).toHaveAttribute('data-step','welcome.language');
    // All of the queued navigation persists in order even when dismissed early.
    await tour.getByRole('button',{name:'Next',exact:true}).click();
    await tour.getByRole('button',{name:'Resume later',exact:true}).click();
    await expect(tour).toHaveCount(0);
    await expect(page.locator('[data-tour="tour-launcher"]')).toBeFocused();
    await expect.poll(()=>f.state.status).toBe('dismissed');
    expect(f.state.currentStep).toBe('profile.interests');
    await page.locator('[data-tour="tour-launcher"]').click();
    await tour.getByRole('button',{name:'Resume',exact:true}).click();
    await expect(tour).toHaveAttribute('data-step','profile.interests');
    await page.keyboard.press('Escape');
    await expect(tour).toHaveCount(0);
    await expect(page.locator('[data-tour="tour-launcher"]')).toBeFocused();
    expect(f.errors).toEqual([]);
  });

  for(const language of ['zh','en','zh-TW','vi']) test(`compact tour viewport and target separation ${language} ${width}`,async({page})=>{
    await page.setViewportSize({width,height:width===390?844:800});
    await page.emulateMedia({reducedMotion:'no-preference'});
    await fixture(page,{populated:true,language});
    await page.locator('[data-tour="tour-launcher"]').click();
    await page.locator('.tour-region .tour-actions button').first().click();
    const tour=page.locator('.tour-region');
    await expect(tour).toHaveAttribute('data-step','welcome.language');
    await expect(tour.locator('.tour-help')).not.toHaveAttribute('open','');
    const title=await tour.locator('h2').textContent();
    expect(title.trim().length).toBeGreaterThan(0);
    await expect.poll(()=>page.evaluate(()=>{
      const region=document.querySelector('.tour-region').getBoundingClientRect();
      const target=document.querySelector('[data-tour="language"]').getBoundingClientRect();
      const inside=region.left>=-1&&region.right<=innerWidth+1&&region.top>=-1&&region.bottom<=innerHeight+1;
      const overlap=region.left<target.right&&region.right>target.left&&region.top<target.bottom&&region.bottom>target.top;
      return {inside,overlap};
    })).toEqual({inside:true,overlap:false});
    // Full text remains discoverable, translated, and the panel itself scrolls.
    await tour.locator('.tour-help summary').click();
    await expect(tour.locator('.tour-help')).toHaveAttribute('open','');
    await expect(tour.locator('.tour-chapters select')).toBeVisible();
  });
}
