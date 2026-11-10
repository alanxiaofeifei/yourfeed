import type { Topic } from '../shared/types';
import { createProfile, PRESETS, TOPIC_LABELS, type UserProfile, type ProfilePreset, type Language } from '../shared/profile';
import type { Env } from './db';
import { HttpError } from './security';

const PROFILE_KEY='profile:user';
function language(value:unknown,fallback:Language):Language {if(value===undefined)return fallback;if(value!=='zh'&&value!=='en')throw new HttpError(400,'请选择中文或 English。');return value;}
function normalize(input:Record<string,unknown>,old:UserProfile):UserProfile {
  const preset=input.preset===undefined?old.preset:input.preset;
  if(typeof preset!=='string'||!Object.hasOwn(PRESETS,preset))throw new HttpError(400,'请选择有效的兴趣预设。');
  const uiLanguage=language(input.language,old.language);const changedPreset=preset!==old.preset;
  const defaults=changedPreset?createProfile(preset as ProfilePreset,uiLanguage):old;
  const displayName=input.displayName===undefined?old.displayName:input.displayName;
  if(typeof displayName!=='string'||displayName.length>80||/[\u0000-\u001f\u007f]/.test(displayName))throw new HttpError(400,'显示名称应为不超过 80 字的文字。');
  const timezone=input.timezone===undefined?old.timezone:input.timezone;
  if(typeof timezone!=='string'||timezone.length>80)throw new HttpError(400,'请选择有效的时区。');
  try{new Intl.DateTimeFormat('en',{timeZone:timezone}).format();}catch{throw new HttpError(400,'请选择有效的时区。');}
  const rawGoals=input.goals===undefined?defaults.goals:input.goals;
  if(!Array.isArray(rawGoals)||rawGoals.length>8||rawGoals.some(goal=>typeof goal!=='string'||goal.length>240||/[\u0000-\u001f\u007f]/.test(goal)))throw new HttpError(400,'目标最多 8 条，每条不超过 240 字。');
  const goals=[...new Set(rawGoals.map(goal=>(goal as string).trim()).filter(Boolean))];
  const rawWeights=input.topicWeights===undefined?defaults.topicWeights:input.topicWeights;
  if(!rawWeights||typeof rawWeights!=='object'||Array.isArray(rawWeights))throw new HttpError(400,'兴趣权重格式不正确。');
  const topicWeights:Partial<Record<Topic,number>>={};
  for(const [topic,value] of Object.entries(rawWeights)){
    if(!Object.hasOwn(TOPIC_LABELS,topic)||typeof value!=='number'||!Number.isFinite(value)||value<0||value>1)throw new HttpError(400,'兴趣权重应为 0–1，且使用支持的主题。');
    topicWeights[topic as Topic]=value;
  }
  if(!Object.values(topicWeights).some(weight=>weight!>0))throw new HttpError(400,'请至少保留一个感兴趣的主题。');
  const next:UserProfile={version:old.version,displayName:displayName.trim(),preset:preset as ProfilePreset,language:uiLanguage,summaryLanguage:language(input.summaryLanguage,old.summaryLanguage),timezone,goals,topicWeights};
  const semantic=(profile:UserProfile)=>JSON.stringify([profile.preset,profile.summaryLanguage,profile.goals,Object.entries(profile.topicWeights).sort(([a],[b])=>a.localeCompare(b))]);
  if(semantic(next)!==semantic(old))next.version=old.version+1;
  return next;
}
export async function getProfile(env:Env):Promise<UserProfile> {
  const row=await env.DB.prepare('SELECT json FROM settings WHERE id=?').bind(PROFILE_KEY).first<{json:string}>();
  if(!row)return createProfile();
  try{
    const stored=JSON.parse(row.json);const base=createProfile();const parsed=normalize(stored,{...base,version:Math.max(1,Number.isSafeInteger(stored.version)?stored.version:1)});
    return {...parsed,version:Math.max(1,Number.isSafeInteger(stored.version)?stored.version:1)};
  }catch{return createProfile();}
}
export async function saveProfile(env:Env,input:Record<string,unknown>):Promise<UserProfile> {
  const old=await getProfile(env);const next=normalize(input,old);
  await env.DB.prepare('INSERT INTO settings(id,json) VALUES (?,?) ON CONFLICT(id) DO UPDATE SET json=excluded.json').bind(PROFILE_KEY,JSON.stringify(next)).run();return next;
}
