import {beforeEach,describe,it,expect} from 'vitest';
import {getProfile,saveProfile} from '../server/profile';
import {createProfile,profileDate} from '../shared/profile';

const rows=new Map<string,string>();
const env={DB:{prepare:()=>{let values:any[]=[];return {bind:(...input:any[])=>{values=input;return {first:async()=>rows.has(values[0])?{json:rows.get(values[0])}:null,run:async()=>{rows.set(values[0],values[1]);return {};}};}};}}} as any;
beforeEach(()=>rows.clear());
describe('Editable portable reading profile',()=>{
 it('starts from a balanced generic preset without importing a personal archive',async()=>{
  const profile=await getProfile(env);expect(profile.preset).toBe('explorer');expect(profile.displayName).toBe('');expect(profile.goals.length).toBeGreaterThan(0);expect(profile.topicWeights.science).toBeGreaterThan(profile.topicWeights.it!);
 });
 it('persists display preferences, timezone and editable weighted topics',async()=>{
  const saved=await saveProfile(env,{displayName:'Example Reader',language:'en',summaryLanguage:'en',timezone:'America/New_York',goals:['Understand food science'],topicWeights:{cooking:1,science:.8,ai:.1}});
  expect(await getProfile(env)).toEqual(saved);expect(saved.version).toBe(2);expect(saved.topicWeights.cooking).toBe(1);
 });
 it('does not invalidate AI revision for UI language, display name or timezone alone',async()=>{
  const first=await getProfile(env);const next=await saveProfile(env,{language:'en',displayName:'Reader',timezone:'UTC'});expect(next.version).toBe(first.version);expect(next.summaryLanguage).toBe('zh');
  const revised=await saveProfile(env,{summaryLanguage:'en'});expect(revised.version).toBe(first.version+1);
 });
 it('applies a selected preset and retains explicit goal overrides',async()=>{
  const profile=await saveProfile(env,{preset:'creator',language:'en',goals:['Make documentary projects']});expect(profile.preset).toBe('creator');expect(profile.goals).toEqual(['Make documentary projects']);expect(profile.topicWeights.making).toBe(1);expect(profile.version).toBe(2);
 });
 it('rejects invalid language/timezone/weights and oversized goals',async()=>{
  for(const input of [{language:'xx'},{summaryLanguage:'xx'},{timezone:'not/a-zone'},{topicWeights:{science:-1}},{topicWeights:{science:NaN}},{topicWeights:{private_topic:1}},{goals:['x'.repeat(241)]},{goals:Array(9).fill('goal')}])await expect(saveProfile(env,input)).rejects.toThrow();
 });
 it('formats dates in the selected timezone including DST and day boundaries',()=>{
  const now=new Date('2026-11-10T03:00:00Z');expect(profileDate(now,'Asia/Taipei')).toBe('2026-11-10');expect(profileDate(now,'America/Los_Angeles')).toBe('2026-11-09');expect(profileDate(new Date('2026-03-08T10:30:00Z'),'America/Los_Angeles')).toBe('2026-03-08');
 });
 it('returns independent preset instances so edits do not mutate defaults',()=>{
  const one=createProfile();one.goals.push('new goal');one.topicWeights.ai=0;const two=createProfile();expect(two.goals).not.toContain('new goal');expect(two.topicWeights.ai).toBe(.5);
 });
});
