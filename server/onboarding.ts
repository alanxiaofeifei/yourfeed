import type {Env} from './db';
import type {ProviderConfig} from '../shared/types';
import {getConfig,getSecret} from './db';
import {authMode} from './auth';
import {HttpError} from './security';
import {normalizeProfile} from './profile';
import {createProfile} from '../shared/profile';
import {ONBOARDING_STEPS,isStepId,type OnboardingMutation,type OnboardingState,type OnboardingResponse,type OnboardingEvidence,type OnboardingSourceEvidence} from '../shared/onboarding';

/** Physical scope is the existing reader DB; identity never comes from JSON input. */
export function onboardingKey(env:Env,userId:string):string {
  return 'onboarding:'+JSON.stringify([authMode(env),userId,'first-use',1]);
}
export interface TestReceiptIdentity {userId:string;origin:string;}
export interface TestReceiptMetadata {nonce:string;testedAt:string;expiresAt:string;credentialRevision:string;configRevision:string;}
const RECEIPT_TTL=10*60_000;
const receiptFields=['provider','model','baseUrl','protocol','temperature','maxOutputTokens','timeoutSeconds','responseFormat','reasoningEffort','inputPricePerMillion','outputPricePerMillion'] as const;
const encode=(value:string)=>btoa(value).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
const decode=(value:string)=>atob(value.replace(/-/g,'+').replace(/_/g,'/'));
/** The only credential derivative is an opaque transient MAC, never persisted.
 * Origin plus per-instance encryption material/namespace bind this capability to
 * its reader instance; authenticated identity comes only from the API adapter. */
async function receiptKey(env:Env):Promise<CryptoKey> {
  const master=env.APP_ENCRYPTION_KEY;if(typeof master!=='string')throw Error('Receipt unavailable');
  const bytes=/^[a-f0-9]{64}$/i.test(master)?Uint8Array.from(master.match(/../g)!,value=>parseInt(value,16)):Uint8Array.from(atob(master),value=>value.charCodeAt(0));
  if(bytes.length!==32)throw Error('Receipt unavailable');
  return crypto.subtle.importKey('raw',bytes,{name:'HMAC',hash:'SHA-256'},false,['sign','verify']);
}
async function receiptDomain(env:Env,create=false):Promise<string> {
  const key='onboarding:receipt-domain:v1';
  if(create)await env.DB.prepare('INSERT OR IGNORE INTO meta(key,value) VALUES (?,?)').bind(key,crypto.randomUUID()).run();
  const row=await env.DB.prepare('SELECT value FROM meta WHERE key=?').bind(key).first<{value:string}>();
  if(!row||!row.value.match(/^[0-9a-f-]{36}$/))throw Error('Receipt domain unavailable');
  return row.value;
}
function receiptMessage(env:Env,domain:string,identity:TestReceiptIdentity,config:ProviderConfig,credential:string,payload:{v:number;nonce:string;issuedAt:number;expiresAt:number}) {
  return new TextEncoder().encode(JSON.stringify(['yourfeed:connection-test:v1',domain,onboardingKey(env,identity.userId),identity.origin,env.INSTANCE_ID??null,env.SECRET_NAMESPACE??'yourfeed',payload,receiptFields.map(field=>config[field]??null),credential]));
}
/** Called only after testProvider confirms a visible successful response. Failure
 * to create optional proof must never turn an already billed test into failure. */
export async function issueTestReceipt(env:Env,identity:TestReceiptIdentity,config:ProviderConfig,credential:string,now=Date.now()):Promise<string|undefined> {
  try {
    const payload={v:1,nonce:crypto.randomUUID(),issuedAt:now,expiresAt:now+RECEIPT_TTL};
    const signature=await crypto.subtle.sign('HMAC',await receiptKey(env),receiptMessage(env,await receiptDomain(env,true),identity,config,credential,payload));
    return encode(JSON.stringify({...payload,tag:encode(String.fromCharCode(...new Uint8Array(signature)))}));
  }catch{return undefined;}
}
/** Invalid proof is ignored, not a failed product save. Expiry is absolute; replay
 * cannot extend it. A matching receipt can acknowledge only this exact config/key. */
export async function verifyTestReceipt(env:Env,identity:TestReceiptIdentity,config:ProviderConfig,credential:string,token:unknown,now=Date.now()):Promise<{nonce:string;testedAt:string;expiresAt:string}|undefined> {
  try {
    if(typeof token!=='string'||token.length>1024||!token.match(/^[A-Za-z0-9_-]+$/))return;
    const value=JSON.parse(decode(token));
    if(!value||value.v!==1||Object.keys(value).sort().join(',')!=='expiresAt,issuedAt,nonce,tag,v'||typeof value.nonce!=='string'||!value.nonce.match(/^[0-9a-f-]{36}$/)||!Number.isSafeInteger(value.issuedAt)||!Number.isSafeInteger(value.expiresAt)||value.issuedAt>now||value.expiresAt<=now||value.expiresAt-value.issuedAt!==RECEIPT_TTL||typeof value.tag!=='string')return;
    const {v,nonce,issuedAt,expiresAt}=value,signature=Uint8Array.from(decode(value.tag),char=>char.charCodeAt(0));
    if(signature.length!==32||!await crypto.subtle.verify('HMAC',await receiptKey(env),signature,receiptMessage(env,await receiptDomain(env),identity,config,credential,{v,nonce,issuedAt,expiresAt})))return;
    return {nonce,testedAt:new Date(issuedAt).toISOString(),expiresAt:new Date(expiresAt).toISOString()};
  }catch{return undefined;}
}
export const testReceiptStorageKey=(env:Env,userId:string)=>onboardingKey(env,userId)+':ai-test';
async function verifiedConnection(env:Env,userId:string|undefined,provider:string,now:number):Promise<{aiTested:boolean;aiVerification:'not_recorded'|'connection_test';aiTestedAt?:string}> {
  const unverified={aiTested:false,aiVerification:'not_recorded' as const};if(!userId)return unverified;
  try {
    const [proof,key,config]=await Promise.all([
      env.DB.prepare('SELECT json FROM settings WHERE id=?').bind(testReceiptStorageKey(env,userId)).first<{json:string}>(),
      env.DB.prepare("SELECT json_extract(json,'$.credentialRevision') revision FROM settings WHERE id=?").bind('key:'+provider).first<{revision:unknown}>(),
      env.DB.prepare("SELECT json_extract(json,'$.configRevision') revision FROM settings WHERE id=?").bind('config').first<{revision:unknown}>(),
    ]);
    if(!proof||typeof key?.revision!=='string'||typeof config?.revision!=='string')return unverified;
    const value=JSON.parse(proof.json);
    if(value.credentialRevision!==key.revision||value.configRevision!==config.revision||!timestamp(value.testedAt)||!timestamp(value.expiresAt)||Date.parse(value.testedAt)>now||Date.parse(value.expiresAt)<=now||Date.parse(value.expiresAt)-Date.parse(value.testedAt)!==RECEIPT_TTL)return unverified;
    return {aiTested:true,aiVerification:'connection_test',aiTestedAt:value.testedAt};
  }catch{return unverified;}
}
const epoch='1970-01-01T00:00:00.000Z';
const timestamp=(value:unknown):value is string=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}T/.test(value)&&Number.isFinite(Date.parse(value));
const freshState=():OnboardingState=>({schemaVersion:1,tourVersion:1,revision:0,status:'not_started',currentStep:'welcome.language',skippedSteps:[],viewedSteps:[],updatedAt:epoch});
function parseState(raw:string):OnboardingState|null {
  try {
    const value=JSON.parse(raw);
    if(!value||typeof value!=='object'||Array.isArray(value)||value.schemaVersion!==1||value.tourVersion!==1||!Number.isSafeInteger(value.revision)||value.revision<1||!['not_started','in_progress','dismissed','completed'].includes(value.status)||!isStepId(value.currentStep)||!timestamp(value.updatedAt))return null;
    for(const field of ['skippedSteps','viewedSteps'])if(!Array.isArray(value[field])||value[field].length>ONBOARDING_STEPS.length||value[field].some((step:unknown)=>!isStepId(step))||new Set(value[field]).size!==value[field].length)return null;
    if(value.firstOfferedAt!==undefined&&!timestamp(value.firstOfferedAt)||value.completedAt!==undefined&&!timestamp(value.completedAt))return null;
    // Explicit projection: legacy/corrupt fields can never leak user text or secrets.
    return {schemaVersion:1,tourVersion:1,revision:value.revision,status:value.status,currentStep:value.currentStep,skippedSteps:value.skippedSteps,viewedSteps:value.viewedSteps,updatedAt:value.updatedAt,...(value.firstOfferedAt?{firstOfferedAt:value.firstOfferedAt}:{}),...(value.completedAt?{completedAt:value.completedAt}:{})};
  } catch {return null;}
}
export function validateOnboardingMutation(input:Record<string,unknown>):OnboardingMutation {
  if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(key=>!['action','expectedRevision','step'].includes(key))||!['start','back','next','skip','dismiss','resume','restart','finish'].includes(String(input.action))||typeof input.action!=='string'||!Number.isSafeInteger(input.expectedRevision)||Number(input.expectedRevision)<0||Number(input.expectedRevision)>=Number.MAX_SAFE_INTEGER)throw new HttpError(400,'引导操作无效。');
  if(input.step!==undefined&&(!isStepId(input.step)||input.action!=='resume'))throw new HttpError(400,'引导章节无效。');
  return input as unknown as OnboardingMutation;
}
/** No implicit enablement date: release operators must approve the actual cutoff.
 * Sites has no trustworthy account creation timestamp and is always manual-only.
 * A session creation date, first request, empty feed or seeded-v1 is NOT account age. */
async function eligible(env:Env,userId:string,now:number):Promise<boolean> {
  if(authMode(env)!=='standalone'||!timestamp(env.ONBOARDING_AUTO_OFFER_CUTOFF))return false;
  const cutoff=Date.parse(env.ONBOARDING_AUTO_OFFER_CUTOFF);
  if(cutoff>now)return false;
  const row=await env.DB.prepare('SELECT created_at FROM auth_user WHERE id=?').bind(userId).first<{created_at:number}>();
  return typeof row?.created_at==='number'&&Number.isSafeInteger(row.created_at)&&row.created_at>=cutoff&&row.created_at<=now;
}
async function credentialConfigured(env:Env,id:string,baseUrl?:string):Promise<boolean> {
  // Do not even select ciphertext or last4 when deriving public tour evidence.
  const row=await env.DB.prepare("SELECT json_extract(json,'$.boundBaseUrl') AS boundBaseUrl FROM settings WHERE id=?").bind('key:'+id).first<{boundBaseUrl:string|null}>();
  if(row)return id!=='custom'||row.boundBaseUrl===baseUrl;
  return !!(await getSecret(env,id)); // Existing hosted policy forbids environment-key fallback.
}
export async function onboardingEvidence(env:Env,now=Date.now(),userId?:string):Promise<OnboardingEvidence> {
  const profile=await env.DB.prepare('SELECT json FROM settings WHERE id=?').bind('profile:user').first<{json:string}>();
  let hasSavedProfile=false,profileReady=false;
  if(profile)try {
    const raw=JSON.parse(profile.json);
    // Explicit stored values only; getProfile's nonempty defaults prove nothing.
    if(raw&&typeof raw==='object'&&!Array.isArray(raw)&&Array.isArray(raw.goals)&&raw.topicWeights&&typeof raw.topicWeights==='object') {
      const normalized=normalizeProfile(raw,createProfile());hasSavedProfile=true;
      profileReady=normalized.goals.some(goal=>goal.trim().length>0)&&Object.values(normalized.topicWeights).some(weight=>typeof weight==='number'&&weight>0);
    }
  }catch{/* Malformed/default-only records are not saved-profile evidence. */}
  const rows=await env.DB.prepare("SELECT s.id,json_extract(s.json,'$.platform') AS platform,json_extract(s.json,'$.enabled') AS enabled,json_extract(s.json,'$.blocked') AS blocked,json_extract(s.json,'$.status') AS status,json_extract(s.json,'$.lastSuccess') AS lastSuccess,EXISTS(SELECT 1 FROM content c WHERE (c.source_id=s.id OR EXISTS(SELECT 1 FROM content_sources cs WHERE cs.content_id=c.id AND cs.source_id=s.id)) AND json_valid(c.json) AND length(trim(COALESCE(json_extract(c.json,'$.title'),'')))>0 AND length(COALESCE(c.url,''))>0) AS hasContent FROM sources s WHERE json_valid(s.json) AND json_extract(s.json,'$.platform') IN ('rss','youtube') ORDER BY s.id LIMIT 200").all<{id:string;platform:'rss'|'youtube';enabled:number;blocked:number|null;status:string|null;lastSuccess:unknown;hasContent:number}>();
  const sources:OnboardingSourceEvidence[]=rows.results.map(row=>{
    const enabled=row.enabled===1&&!row.blocked;
    const lastSuccess=timestamp(row.lastSuccess)&&Date.parse(row.lastSuccess)<=now?row.lastSuccess:undefined;
    const hasContent=!!row.hasContent;
    const health:OnboardingSourceEvidence['health']=row.blocked?'blocked':row.status==='error'?'error':enabled&&row.status==='ok'&&lastSuccess?(hasContent?'ready':'checked_empty'):'pending';
    return {id:row.id,platform:row.platform,enabled,health,hasContent,...(lastSuccess?{lastSuccess}:{})};
  });
  const rss=sources.filter(source=>source.platform==='rss'&&source.enabled),youtube=sources.filter(source=>source.platform==='youtube'&&source.enabled);
  const config=await getConfig(env);
  const [aiConfigured,youtubeConfigured]=await Promise.all([credentialConfigured(env,config.provider,config.baseUrl),credentialConfigured(env,'youtube')]);
  const verification=aiConfigured?await verifiedConnection(env,userId,config.provider,now):{aiTested:false,aiVerification:'not_recorded' as const};
  return {hasSavedProfile,profileReady,hasRssSource:rss.length>0,hasRssContent:rss.some(source=>source.hasContent),rssReady:rss.some(source=>source.health==='ready'),aiConfigured,aiEnabled:config.enabled===true,...verification,youtubeConfigured,hasYoutubeSource:youtube.length>0,hasYoutubeContent:youtube.some(source=>source.hasContent),youtubeReady:youtubeConfigured&&youtube.some(source=>source.health==='ready'),sources};
}
async function stored(env:Env,userId:string) {
  const row=await env.DB.prepare('SELECT json FROM settings WHERE id=?').bind(onboardingKey(env,userId)).first<{json:string}>();
  const parsed=row?parseState(row.json):null;
  return {raw:row?.json,state:parsed??freshState(),storage:row?(parsed?'saved':'invalid'):'new'} as const;
}
export async function getOnboarding(env:Env,userId:string):Promise<OnboardingResponse> {
  const record=await stored(env,userId),now=Date.now();
  return {state:record.state,storage:record.storage,evidence:await onboardingEvidence(env,now,userId),autoOffer:record.storage==='new'&&await eligible(env,userId,now)};
}
/** Strict CAS: stale actions (including repeated next) return 409, never advance twice.
 * GET is read-only, including during backup windows. Product writes are independent
 * of tour writes; a tour failure cannot turn a successful settings save into failure. */
export async function mutateOnboarding(env:Env,userId:string,input:Record<string,unknown>):Promise<OnboardingResponse> {
  const action=validateOnboardingMutation(input),record=await stored(env,userId),old=record.state;
  if(action.expectedRevision!==old.revision)throw new HttpError(409,'引导进度已更新，请重新读取后重试。');
  if(record.storage==='invalid'&&action.action!=='restart')throw new HttpError(409,'引导记录不可用，请从头查看。');
  const now=new Date().toISOString(),next:OnboardingState={...old,revision:old.revision+1,updatedAt:now,firstOfferedAt:old.firstOfferedAt??now,skippedSteps:[...old.skippedSteps],viewedSteps:[...old.viewedSteps]};
  const index=ONBOARDING_STEPS.indexOf(old.currentStep);
  switch(action.action) {
    case 'start':
      if(old.status!=='not_started')throw new HttpError(409,'引导已开始，请继续或从头查看。');
      next.status='in_progress';break;
    case 'resume':next.status='in_progress';next.currentStep=action.step??old.currentStep;break;
    case 'restart':next.status='in_progress';next.currentStep='welcome.language';break;
    case 'dismiss':next.status='dismissed';break;
    case 'finish':
      if(old.status!=='in_progress'||old.currentStep!=='finish')throw new HttpError(400,'请先查看最后一步。');
      next.status='completed';next.completedAt=now;break;
    default:
      if(old.status!=='in_progress')throw new HttpError(409,'请先继续引导。');
      if(action.action==='back')next.currentStep=ONBOARDING_STEPS[Math.max(0,index-1)];
      else {
        if(action.action==='skip'&&!next.skippedSteps.includes(old.currentStep))next.skippedSteps.push(old.currentStep);
        next.currentStep=ONBOARDING_STEPS[Math.min(ONBOARDING_STEPS.length-1,index+1)];
      }
  }
  // Restart changes position only; evidence, viewed/skipped history and prior
  // completion time survive reviewing the tour. No product data is ever reset.
  if(!next.viewedSteps.includes(old.currentStep))next.viewedSteps.push(old.currentStep);
  if(next.status==='in_progress'&&!next.viewedSteps.includes(next.currentStep))next.viewedSteps.push(next.currentStep);
  const key=onboardingKey(env,userId),json=JSON.stringify(next);
  const result=record.raw===undefined
    ?await env.DB.prepare('INSERT OR IGNORE INTO settings(id,json) VALUES (?,?)').bind(key,json).run()
    :await env.DB.prepare('UPDATE settings SET json=? WHERE id=? AND json=?').bind(json,key,record.raw).run();
  if(result.meta.changes!==1)throw new HttpError(409,'引导进度已更新，请重新读取后重试。');
  return getOnboarding(env,userId);
}
