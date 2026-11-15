import {test,expect} from 'playwright/test';
import {fixture} from './fixture.mjs';

async function geometry(page){
 return page.evaluate(()=>{
  const panel=document.querySelector('.tour-region').getBoundingClientRect(),arrow=document.querySelector('.tour-pointer'),box=arrow.getBoundingClientRect();
  const anchor=document.querySelector('.tour-spotlight').dataset.spotlight,target=document.querySelector(`[data-tour="${anchor}"]`).getBoundingClientRect();
  const points=Array.from(arrow.querySelector('polygon').points).map(p=>({x:box.x+p.x,y:box.y+p.y}));
  if(points.length!==3)return {ready:false};const [a,b,tip]=points,base={x:(a.x+b.x)/2,y:(a.y+b.y)/2},center={x:target.x+target.width/2,y:target.y+target.height/2};
  const dir={x:tip.x-base.x,y:tip.y-base.y},aim={x:center.x-base.x,y:center.y-base.y};
  const side=arrow.dataset.side;const touch=side==='left'?Math.abs(box.right-panel.left):side==='right'?Math.abs(box.left-panel.right):side==='top'?Math.abs(box.bottom-panel.top):Math.abs(box.top-panel.bottom);
  const inset=side==='top'||side==='bottom'?Math.min(base.x-panel.left,panel.right-base.x):Math.min(base.y-panel.top,panel.bottom-base.y);
  return {ready:true,touch,inset,cosine:(dir.x*aim.x+dir.y*aim.y)/Math.hypot(dir.x,dir.y)/Math.hypot(aim.x,aim.y),side};
 });
}
async function assertAttached(page){await expect(page.locator('.tour-pointer')).toBeVisible();await expect.poll(async()=>{const g=await geometry(page);return g.ready&&g.touch<1&&g.inset>=17&&g.cosine>.999;}).toBe(true);}
for(const language of ['zh','en'])for(const width of [1280,390])test(`arrow geometry ${language} ${width}`,async({page})=>{
 await page.setViewportSize({width,height:width===390?844:800});const f=await fixture(page,{language,populated:true});await page.locator('[data-tour=tour-launcher]').click();await page.locator('.tour-region .tour-actions button').first().click();await expect(page.locator('.tour-region')).toHaveAttribute('data-step','welcome.language');
 if(width===390){await expect(page.locator('.tour-pointer')).toBeHidden();await expect(page.locator('.tour-spotlight')).toBeVisible();await page.setViewportSize({width:1280,height:800});await assertAttached(page);await page.setViewportSize({width:390,height:844});await expect(page.locator('.tour-pointer')).toBeHidden();}
 else{
  await assertAttached(page);
  await page.evaluate(()=>{document.documentElement.dir='rtl';window.dispatchEvent(new Event('resize'));});await assertAttached(page);
  // Force each real placement through the same observed target, then flip on resize.
  for(const [side,rect] of [['left',{left:60,top:160,width:40,height:40}],['right',{left:1150,top:160,width:40,height:40}],['top',{left:20,top:20,width:1150,height:40}],['bottom',{left:20,top:730,width:1150,height:40}]]){
   await page.locator('[data-tour=language]').evaluate((el,r)=>{Object.assign(el.style,{position:'fixed',left:`${r.left}px`,top:`${r.top}px`,width:`${r.width}px`,height:`${r.height}px`});window.dispatchEvent(new Event('resize'));},rect);
   await assertAttached(page);await expect(page.locator('.tour-pointer')).toHaveAttribute('data-side',side);
  }
  // Scroll notifications and step changes remeasure without detaching the arrow.
  await page.evaluate(()=>window.dispatchEvent(new Event('scroll')));await assertAttached(page);
  await page.locator('[data-tour=language]').evaluate(el=>el.removeAttribute('style'));
  await page.locator('.tour-region .tour-actions button').nth(3).click();await expect(page.locator('.tour-region')).toHaveAttribute('data-step','profile.interests');
  await page.locator('.tour-region .tour-actions button').first().click();await expect(page.locator('.tour-spotlight')).toHaveAttribute('data-spotlight','profile-interests');await assertAttached(page);
 }
 expect(f.errors).toEqual([]);
});
