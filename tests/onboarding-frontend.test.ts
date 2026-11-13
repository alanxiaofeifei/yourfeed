import { describe, expect, it } from 'vitest';
import { ONBOARDING_STEPS } from '../shared/onboarding';
import { targetForStep } from '../app/components/onboarding/navigation';
import { readFileSync } from 'node:fs';
import {parseTourResponse} from '../app/components/onboarding/response';

describe('tour declarative navigation', () => {
 it('provides a stable destination and anchor for all nineteen steps', () => {
  expect(ONBOARDING_STEPS).toHaveLength(19);
  for (const step of ONBOARDING_STEPS) {
   const target=targetForStep(step);
   expect(['feed','sources','settings']).toContain(target.view);
   expect(target.anchor).toMatch(/^[a-z-]+$/);
  }
 });
 it('opens the actual discovery and manual source entries, not invented routes', () => {
  expect(targetForStep('sources.curated')).toEqual({view:'sources',sourceEntry:'curated',anchor:'curated-list'});
  expect(targetForStep('youtube.channel')).toEqual({view:'sources',sourceEntry:'manual',anchor:'source-add'});
  expect(targetForStep('profile.save').settingsTab).toBe('profile');
  expect(targetForStep('youtube.save').settingsTab).toBe('ai');
 });
 it('separates update, search, shuffle and key/test/save targets', () => {
  const anchors=['feed.update','feed.search','feed.shuffle','ai.credentials','ai.test','ai.save'].map(step=>targetForStep(step as typeof ONBOARDING_STEPS[number]).anchor);
  expect(new Set(anchors).size).toBe(6);
 });
});

describe('malformed tour responses fail closed',()=>{
 const valid={state:{schemaVersion:1,tourVersion:1,revision:0,status:'not_started',currentStep:'welcome.language',viewedSteps:[],skippedSteps:[],updatedAt:'2026-11-12T00:00:00Z'},autoOffer:false,storage:'new',evidence:{hasSavedProfile:false,profileReady:false,hasRssSource:false,hasRssContent:false,rssReady:false,aiConfigured:false,aiEnabled:false,aiTested:false,aiVerification:'not_recorded',youtubeConfigured:false,hasYoutubeSource:false,hasYoutubeContent:false,youtubeReady:false,sources:[]}};
 it('accepts the sanitized server contract without inventing eligibility',()=>{expect(parseTourResponse(valid).autoOffer).toBe(false);});
 it('rejects partial payloads and unknown step/version rather than rendering a welcome',()=>{
  for(const value of [null,{}, {...valid,state:{...valid.state,currentStep:'unknown'}},{...valid,state:{...valid.state,tourVersion:2}},{...valid,state:{...valid.state,viewedSteps:null}},{...valid,evidence:{...valid.evidence,aiConfigured:'yes'}}])expect(()=>parseTourResponse(value)).toThrow('TOUR_RESPONSE_INVALID');
 });
});

describe('frontend tour safety boundaries', () => {
 const tour=readFileSync(new URL('../app/components/onboarding/Tour.tsx',import.meta.url),'utf8');
 const home=readFileSync(new URL('../app/page.tsx',import.meta.url),'utf8');
 it('does not simulate business clicks, persist credentials, or submit evidence',()=>{
  expect(tour).not.toMatch(/\.click\(|localStorage|sessionStorage|input\.value|youtubeKey|keyLast4/);
  expect(tour).toContain('expectedRevision:current.state.revision');
  expect(tour).toContain("cache:'no-store'");
 });
 it('does not compete with the old automatic empty-feed interest onboarding',()=>{
  expect(home).toContain('<div hidden={tour.active}><ProfileOnboarding');
  expect(home).toContain('tour.launch');
  expect(home).toContain('!sourceModal&&tour.region');
 });
 it('gates auto welcome on successful account-scoped initial product reads and clears terminal welcomes',()=>{
  expect(home).toContain('ready:!!sessionUserId&&sidebarReadyFor===sessionUserId');
  expect(tour).toContain('if(!ready||error){setWelcome(false);return;}');
  expect(tour).toContain("if(value.state.status==='dismissed'||value.state.status==='completed'){setOpen(false);setWelcome(false);}");
 });
 it('retains forms until explicit guarded destination navigation',()=>{
  expect(home).toContain('leavesForm&&dirtyForm.current&&!window.confirm(tour.dirtyConfirm)');
  expect(tour).toContain('onNavigate(target)');
  expect(tour).toContain("window.matchMedia('(prefers-reduced-motion: reduce)')");
 });
});
