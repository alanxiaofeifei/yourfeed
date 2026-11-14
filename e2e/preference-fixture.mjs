import {readFileSync} from 'node:fs';
import {expect} from 'playwright/test';
import {fixture} from './fixture.mjs';
const bank=JSON.parse(readFileSync(new URL('../shared/preference-bank.json',import.meta.url),'utf8'));
export async function preferenceFixture(page,{language='en',ai=false,free=false,generation='valid',failSave=false}={}){
 const f=await fixture(page,{language,populated:true});
 let state={revision:0,answers:{},source:'curated',questions:structuredClone(bank[language]),language,position:0,manualInterest:'',manualTopics:[]};
 let sources=[{id:'existing-github',name:'GitHub Blog',platform:'rss',locator:'https://github.blog/feed/',topics:['code'],enabled:true}];
 let profile={version:1,displayName:'Synthetic reader',preset:'explorer',language,summaryLanguage:language,timezone:'UTC',goals:['Read science'],topicWeights:{science:1}};
 const commits=[],deletes=[],saves=[],generations=[];const controls={failSave};
 await page.route('**/api/**',async route=>{
  const req=route.request(),p=new URL(req.url()).pathname,method=req.method();
  if(p==='/api/preference-cards'){
   if(method==='PUT'){
    const body=req.postDataJSON();saves.push(body);
    if(controls.failSave)return route.fulfill({status:503,json:{error:'Synthetic save failure'}});
    if(body.expectedRevision!==state.revision)return route.fulfill({status:409,json:{error:'Synthetic conflict'}});
    state={...body.state,revision:state.revision+1};
   }
   return route.fulfill({json:state});
  }
  if(p==='/api/preference-cards/generate'){
   generations.push('generate');if(generation==='timeout'||generation==='slow-valid')await new Promise(resolve=>setTimeout(resolve,generation==='timeout'?9500:7500));
   if(generation==='curated')return route.fulfill({json:{source:'curated',questions:bank[language]}});
   if(generation==='429')return route.fulfill({status:429,json:{error:'Synthetic limit'}});
   const questions=structuredClone(bank[language]);if(generation==='invalid')questions[0].optionA.sourceIds=['invented'];else questions[0].prompt='Synthetic AI question for your interests?';
   if(generation==='timeout')return route.fulfill({json:{source:'ai',questions}}).catch(()=>{});
   return route.fulfill({json:{source:'ai',questions}});
  }
  if(p==='/api/profile'){if(method==='PUT')profile={...req.postDataJSON(),version:profile.version+1};return route.fulfill({json:profile});}
  if(p==='/api/sources'&&method==='GET')return route.fulfill({json:{sources}});
  if(p==='/api/sources'&&method==='DELETE'){const {id}=req.postDataJSON();deletes.push(id);sources=sources.filter(s=>s.id!==id);return route.fulfill({json:{ok:true}});}
  if(p==='/api/sources/import/commit'){
   const body=req.postDataJSON();commits.push(body);const created=[],duplicates=[];
   for(const [index,candidate] of body.candidates.entries()){
    const existing=sources.find(s=>s.locator===candidate.locator);
    if(existing)duplicates.push({index,existingId:existing.id});else{const source={...candidate,id:`created-${commits.length}-${index}`};sources.push(source);created.push({...source,index});}
   }
   return route.fulfill({json:{created,duplicates,errors:[]}});
  }
  if(p==='/api/settings')return route.fulfill({json:{provider:'openai',model:'gpt-6.1-sol',enabled:false,monthlyBudget:20,dailyLimit:20,configured:ai,freeAiAvailable:free,usingFreeAi:free,providers:[],youtubeConfigured:false}});
  return route.fallback();
 });
 await page.reload();
 await expect(page.locator('[data-preference-entry]').first()).toBeEnabled();
 return {...f,commits,deletes,saves,generations,controls,get state(){return state;},get sources(){return sources;},get profile(){return profile;}};
}
export async function openPreferences(page){await page.locator('[data-preference-entry]').first().click();await expect(page.locator('.preference-dialog')).toHaveAttribute('aria-busy','false');await expect(page.locator('[data-pref-choice=A]')).toBeVisible();}
export async function answer(page,choice='A'){await page.locator(`[data-pref-choice=${choice}]`).click();await expect(page.locator('.preference-dialog')).toHaveAttribute('aria-busy','false');}
