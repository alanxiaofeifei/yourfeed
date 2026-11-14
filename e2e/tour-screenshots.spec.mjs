import { test, expect } from 'playwright/test';
import { mkdir } from 'node:fs/promises';
import { fixture } from './fixture.mjs';

for (const shot of [
  { file:'desktop-tour-zh-CN.png', width:1280, height:800, language:'zh' },
  { file:'mobile-tour-zh-CN.png', width:390, height:844, language:'zh' },
  { file:'desktop-tour-en.png', width:1280, height:800, language:'en' },
  { file:'reduced-motion.png', width:1280, height:800, language:'zh', reduced:true },
]) test(`phase A screenshot ${shot.file}`, async ({ page }) => {
  test.skip(process.env.TOUR_SCREENSHOTS !== '1', 'Opt-in synthetic screenshot evidence');
  await page.setViewportSize({width:shot.width,height:shot.height});
  await page.emulateMedia({reducedMotion:shot.reduced?'reduce':'no-preference'});
  const f = await fixture(page,{populated:true,language:shot.language});
  await page.locator('[data-tour="tour-launcher"]').click();
  // Menu's primary action is Resume in either locale; target by stable order.
  await page.locator('.tour-region .tour-actions button').first().click();
  await expect(page.locator('.tour-region')).toHaveAttribute('data-step','welcome.language');
  await expect(page.locator('.tour-spotlight')).toBeVisible();
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
  });
  const directory = '/workspace/yourfeed-onboarding-20261112/phaseA-shots';
  await mkdir(directory,{recursive:true});
  await page.screenshot({path:`${directory}/${shot.file}`,animations:'disabled'});
  expect(f.errors).toEqual([]);
});
