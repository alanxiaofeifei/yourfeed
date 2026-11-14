'use client';
import {useEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {useI18n} from '../i18n';
import {TOPIC_LABELS,type UserProfile} from '../../shared/profile';
import type {Source} from '../../shared/types';
import {freeAiMessages} from '../../shared/free-ai-messages';
import {preferenceMessages} from '../../shared/preference-messages';
import {curatedQuestions,newPreferenceState,preferenceStateSchema,questionsSchema,preferenceSummary,preferenceProfile,CARD_TOPICS,type PreferenceState} from '../../shared/preference-cards';
import './PreferenceCards.css';

const OPEN_EVENT='yourfeed:preference-cards';
export function PreferenceEntry({disabled=false}:{disabled?:boolean}){const {language}=useI18n();return <button type="button" data-preference-entry className="tour-launcher preference-entry" disabled={disabled} onClick={()=>window.dispatchEvent(new Event(OPEN_EVENT))}>{preferenceMessages[language].launch}</button>;}
async function request<T>(path:string,language:string,method='GET',body?:unknown,signal?:AbortSignal):Promise<T>{const response=await fetch(path,{method,headers:{'Content-Type':'application/json','Accept-Language':language},...(body===undefined?{}:{body:JSON.stringify(body)}),signal});if(!response.ok)throw Error('Preference request failed');return response.json() as Promise<T>;}
interface Props{userId:string;profile:UserProfile;aiConfigured:boolean;onProfile:(value:UserProfile)=>void;reload:()=>Promise<void>;onManual:()=>void;}
/** This controller is idle until explicitly opened, including on established accounts. */
export default function PreferenceCards(props:Props){
 const [open,setOpen]=useState(false);
 useEffect(()=>{const show=()=>{if(props.userId)setOpen(true);};window.addEventListener(OPEN_EVENT,show);return()=>window.removeEventListener(OPEN_EVENT,show);},[props.userId]);
 useEffect(()=>setOpen(false),[props.userId]);
 return open&&props.userId?<CardFlow key={props.userId} {...props} onClose={()=>setOpen(false)}/>:null;
}
function CardFlow({profile,aiConfigured,onProfile,reload,onManual,onClose}:Props&{onClose:()=>void}){
 const {language}=useI18n();const m=preferenceMessages[language];
 const [state,setState]=useState<PreferenceState>(()=>newPreferenceState(language));
 const [loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState(false),[manual,setManual]=useState(false),[done,setDone]=useState(false),[generating,setGenerating]=useState(false);
 const [notice,setNotice]=useState('');const [existing,setExisting]=useState<Source[]>([]);const [excluded,setExcluded]=useState<string[]>([]);const [created,setCreated]=useState<Source[]>([]);
 const panel=useRef<HTMLElement>(null),heading=useRef<HTMLHeadingElement>(null),locked=useRef(false),revision=useRef(0),draft=useRef(state),mounted=useRef(true),generation=useRef<AbortController|null>(null);
 const update=(next:PreferenceState)=>{draft.current=next;setState(next);};
 const load=async()=>{setLoading(true);setError(false);try{const [saved,sources]=await Promise.all([request<PreferenceState>('/api/preference-cards',language),request<{sources:Source[]}>('/api/sources',language)]);const valid=preferenceStateSchema.parse(saved);revision.current=valid.revision;update(valid.source==='curated'?{...valid,language,questions:curatedQuestions(language)}:valid);setExisting(sources.sources);setDone(false);setExcluded([]);}catch{setError(true);}finally{setLoading(false);}};
 useEffect(()=>{mounted.current=true;void load();return()=>{mounted.current=false;generation.current?.abort();};},[]);
 // Own the active focus scope even when launched from source discovery's dialog.
 useEffect(()=>{const previous=document.activeElement as HTMLElement|null;const outer=document.querySelector<HTMLElement>('[role=dialog]:not(.preference-dialog)');const wasInert=outer?.inert;if(outer)outer.inert=true;const overflow=document.body.style.overflow;document.body.style.overflow='hidden';heading.current?.focus();
  return()=>{document.body.style.overflow=overflow;if(outer)outer.inert=!!wasInert;previous?.focus();};},[]);
 useEffect(()=>{heading.current?.focus({preventScroll:true});},[state.position,manual,done,loading]);
 const persist=async(next:PreferenceState)=>{
  update(next);setError(false);
  try{const saved=preferenceStateSchema.parse(await request('/api/preference-cards',language,'PUT',{expectedRevision:revision.current,state:{...next,revision:revision.current}}));revision.current=saved.revision;update(saved);return true;}catch{setError(true);return false;}
 };
 const run=async(action:()=>Promise<void>)=>{if(locked.current)return;locked.current=true;setBusy(true);try{await action();}catch{setError(true);}finally{locked.current=false;if(mounted.current)setBusy(false);}};
 const close=()=>void run(async()=>{if(!error)await persist(draft.current);onClose();});
 const choose=(choice:'A'|'B'|'skipped')=>void run(async()=>{const current=draft.current,q=current.questions[current.position];if(!q)return;await persist({...current,completedAt:undefined,answers:{...current.answers,[q.id]:choice},position:current.position+1});});
 useEffect(()=>{const keyboard=(event:KeyboardEvent)=>{
  if(event.defaultPrevented||event.isComposing)return;
  if(event.key==='Tab'){
   const items=Array.from(panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),textarea:not(:disabled),a[href]')||[]).filter(el=>el.getClientRects().length);const first=items[0],last=items.at(-1);
   if(!panel.current?.contains(document.activeElement)||document.activeElement===heading.current){event.preventDefault();(event.shiftKey?last:first)?.focus();}else if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}event.stopImmediatePropagation();
  }
  if(event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();if(!loading&&!locked.current)close();}
  if(loading||manual||done||generating||locked.current||state.position>=10||event.altKey||event.ctrlKey||event.metaKey||event.target instanceof Element&&event.target.closest('input,textarea,[contenteditable=true]'))return;
  if(['1','2','ArrowLeft','ArrowRight'].includes(event.key)){event.preventDefault();event.stopImmediatePropagation();choose(event.key==='1'||event.key==='ArrowLeft'?'A':'B');}
 };document.addEventListener('keydown',keyboard,true);return()=>document.removeEventListener('keydown',keyboard,true);});
 const generate=()=>void run(async()=>{
  setGenerating(true);setNotice('');const abort=new AbortController();generation.current=abort;const timer=setTimeout(()=>abort.abort(),6000);
  try{const response=await request<{questions:unknown;source:'ai'|'curated'}>('/api/preference-cards/generate',language,'POST',{},abort.signal);const questions=questionsSchema.parse({questions:response.questions}).questions;await persist({...newPreferenceState(language),revision:revision.current,questions,source:response.source==='ai'?'ai':'curated'});if(response.source!=='ai')setNotice(m.fallback);}
  catch{if(mounted.current){await persist({...newPreferenceState(language),revision:revision.current,questions:curatedQuestions(language)});setNotice(m.fallback);}}
  finally{clearTimeout(timer);generation.current=null;if(mounted.current)setGenerating(false);}
 });
 const summary=preferenceSummary(state);const isExisting=(locator:string)=>existing.some(source=>source.platform==='rss'&&source.locator===locator);
 const confirm=()=>void run(async()=>{
  // First persist progress; then save only fields changed by these choices over
  // the latest profile, preserving unrelated edits from another tab.
  if(!await persist(draft.current))return;
  const latest=await request<UserProfile>('/api/profile',language);
  const saved=await request<UserProfile>('/api/profile',language,'PUT',preferenceProfile(draft.current,latest));onProfile(saved);
  const selected=preferenceSummary(draft.current).sources.filter(entry=>!isExisting(entry.locator)&&!excluded.includes(entry.id));let failed=false;
  for(let i=0;i<selected.length;i+=10){
   const batch=selected.slice(i,i+10);const result=await request<{created:(Source&{index:number})[];duplicates:{index:number;existingId:string}[];errors:{index:number}[]}>('/api/sources/import/commit',language,'POST',{candidates:batch.map(entry=>({id:entry.id,name:entry.name,platform:entry.platform,locator:entry.locator,topics:entry.topics,enabled:true}))});
   // Keep actual created IDs only. Duplicates are never eligible for Undo.
   setCreated(old=>[...old,...result.created]);setExisting(old=>[...old,...result.created,...result.duplicates.map(item=>({...batch[item.index],id:item.existingId,enabled:true}))]);
   if(result.errors.length)failed=true;
  }
  if(failed){setNotice(m.partial);await reload();return;}
  if(!await persist({...draft.current,completedAt:new Date().toISOString(),position:10}))return;
  setDone(true);await reload();
 });
 const undo=()=>void run(async()=>{for(const source of created){await request('/api/sources',language,'DELETE',{id:source.id});setCreated(old=>old.filter(entry=>entry.id!==source.id));setExisting(old=>old.filter(entry=>entry.id!==source.id));}await reload();});
 const q=state.questions[state.position];
 return createPortal(<div className="preference-backdrop"><section ref={panel} className="preference-dialog" role="dialog" aria-modal="true" aria-labelledby="preference-title" aria-busy={busy||loading}>
  <header><span className="micro-label">YOURFEED · {state.source==='ai'?m.aiLabel:m.curated}</span><button type="button" data-pref="close" disabled={busy||loading} onClick={close}>{m.close}</button></header>
  <h2 id="preference-title" tabIndex={-1} ref={heading}>{done?m.done:manual?m.manual:state.position===10?m.review:m.title}</h2>
  {loading?<p role="status">{m.loading}</p>:<>
   {error&&<div className="error-box" role="alert">{m.error}<button type="button" disabled={busy} onClick={()=>void run(async()=>{await persist(draft.current);})}>{m.retry}</button><button type="button" disabled={busy} onClick={()=>void load()}>{m.reload}</button></div>}
   {notice&&<p role="status">{notice}</p>}
   {done?<><p>{m.addedCount}: {created.length}</p><p>{m.undoNote}</p><button type="button" data-pref="undo" disabled={busy||!created.length} onClick={undo}>{m.undo}</button><button type="button" onClick={close} disabled={busy}>{m.close}</button></>:<>
    {manual?<div className="preference-manual"><label htmlFor="preference-interest">{m.manualLabel}</label><textarea id="preference-interest" maxLength={240} value={state.manualInterest} disabled={busy} onChange={e=>update({...state,manualInterest:e.target.value})}/><p>{m.manualHelp}</p><div className="preference-topics">{CARD_TOPICS.map(topic=><label key={topic}><input type="checkbox" disabled={busy} checked={state.manualTopics.includes(topic)} onChange={e=>update({...state,manualTopics:e.target.checked?[...state.manualTopics,topic]:state.manualTopics.filter(t=>t!==topic)})}/>{TOPIC_LABELS[topic][language]}</label>)}</div><button type="button" data-pref="manual-review" disabled={busy} onClick={()=>void run(async()=>{if(await persist({...draft.current,position:10}))setManual(false);})}>{m.manualReview}</button><button type="button" disabled={busy} onClick={()=>void run(async()=>{if(await persist(draft.current)){onClose();onManual();}})}>{m.settings}</button></div>:state.position<10?<>
     <p className="preference-progress" aria-live="polite">{m.progress.replace('{n}',String(state.position+1)).replace('{left}',String(9-state.position))}</p><progress value={state.position} max={10}/>
     <p className="preference-intro">{m.intro}</p><h3>{q.prompt}</h3>
     <div className="preference-choices">{(['A','B'] as const).map((choice,index)=>{const option=choice==='A'?q.optionA:q.optionB;return <button type="button" data-pref-choice={choice} key={choice} disabled={busy||error} aria-pressed={state.answers[q.id]===choice} onClick={()=>choose(choice)}><span className="preference-number">0{index+1}</span><strong>{option.label}</strong><span>{option.subtitle}</span></button>;})}</div>
     <div className="preference-controls"><button type="button" data-pref="back" disabled={busy||!state.position} onClick={()=>void run(async()=>{await persist({...draft.current,position:state.position-1});})}>{m.back}</button><button type="button" data-pref="skip" disabled={busy||error} onClick={()=>choose('skipped')}>{m.skip}</button></div>
     {state.position===0&&aiConfigured&&<p className="field-help">{freeAiMessages[language].notice}</p>}
     {state.position===0&&aiConfigured&&<button type="button" data-pref="generate" disabled={busy} onClick={generate}>{generating?m.generating:m.ai}</button>}
    </>:<>
     <p className="preference-progress" aria-live="polite">10 / 10 · {m.review}</p><progress value={10} max={10}/><p>{m.preview}</p><div className="preference-topic-summary" aria-label={m.topics}>{Object.keys(summary.topicWeights).map(topic=><span key={topic}>{TOPIC_LABELS[topic as keyof typeof TOPIC_LABELS][language]} {Math.round(summary.topicWeights[topic as keyof typeof TOPIC_LABELS]!*100)}%</span>)}</div>
     <div className="preference-source-list">{summary.sources.map(entry=><label key={entry.id}><input type="checkbox" data-pref-source={entry.id} checked={isExisting(entry.locator)||!excluded.includes(entry.id)} disabled={busy||isExisting(entry.locator)} onChange={e=>setExcluded(old=>e.target.checked?old.filter(id=>id!==entry.id):[...old,entry.id])}/><span><strong>{entry.name}</strong> · {entry.language==='zh'?'中文':'English'}{isExisting(entry.locator)&&<em> · {m.added}</em>}<small>{entry.locator}</small></span></label>)}</div>
     {!summary.sources.length&&<p>{m.empty}</p>}<button type="button" className="primary-button" data-pref="confirm" disabled={busy||error} onClick={confirm}>{m.confirm}</button>
     <button type="button" data-pref="back" disabled={busy} onClick={()=>void run(async()=>{await persist({...draft.current,position:9});})}>{m.back}</button>
    </>}
    <footer><button type="button" data-pref="manual" disabled={busy} onClick={()=>setManual(value=>!value)}>{manual?m.back:m.manual}</button><button type="button" data-pref="skip-all" disabled={busy} onClick={()=>void run(async()=>{const current=draft.current;const answers={...current.answers};for(const question of current.questions)if(!answers[question.id])answers[question.id]='skipped';await persist({...current,answers});onClose();})}>{m.skipAll}</button>{state.position===10&&<button type="button" data-pref="restart" disabled={busy} onClick={()=>void run(async()=>{if(await persist({...newPreferenceState(language),revision:revision.current})){setExcluded([]);setNotice('');}})}>{m.restart}</button>}<span role="status">{busy?m.saving:error?'':m.saved}</span></footer>
   </>}
  </>}
 </section></div>,document.body);
}
