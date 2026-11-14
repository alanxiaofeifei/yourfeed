'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Spotlight } from './Spotlight';
import { ONBOARDING_STEPS, type StepId, type OnboardingAction, type OnboardingResponse } from '../../../shared/onboarding';
import { getOnboardingMessages } from '../../../shared/onboarding-messages';
import { useI18n } from '../../i18n';
import { targetForStep, type TourTarget, type TourBusinessEvent } from './navigation';
import './Tour.css';
import {parseTourResponse} from './response';
import {TourConflict, TourQueue, tourSummary} from './optimistic';

type TourOptions = {userId:string;ready:boolean;onNavigate:(target:TourTarget)=>boolean};
/** Keep high-frequency tour progress updates out of the entire feed tree. */
export function useTour(options: TourOptions) {
 const {language}=useI18n();
 const [active,setActive]=useState(false);
 const [slot,setSlot]=useState<HTMLDivElement|null>(null);
 const slots=useRef(new Set<HTMLDivElement>());
 const registerSlot=useCallback((node:HTMLDivElement|null)=>{if(!node)return;slots.current.add(node);setSlot(node);return()=>{slots.current.delete(node);setSlot(Array.from(slots.current).at(-1)||null);};},[]);
 const api=useRef<{refresh:(event?:TourBusinessEvent)=>Promise<OnboardingResponse|undefined>}|null>(null);
 const refresh=useCallback((event?:TourBusinessEvent)=>api.current?.refresh(event),[]);
 return {launch:<TourController {...options} slot={slot} api={api} onActive={setActive}/>,region:<div className="tour-slot" ref={registerSlot}/>,active,refresh,dirtyConfirm:getOnboardingMessages(language).help.dirtyConfirm};
}
function TourController({slot,api,onActive,...options}:TourOptions & {slot:HTMLDivElement|null;api:React.RefObject<{refresh:(event?:TourBusinessEvent)=>Promise<OnboardingResponse|undefined>}|null>;onActive:(active:boolean)=>void}) {
 const tour=useTourState(options);
 api.current={refresh:tour.refresh};
 useEffect(()=>onActive(tour.active),[tour.active,onActive]);
 return <>{tour.launch}{slot&&createPortal(<TourPresence>{tour.region}</TourPresence>,slot)}</>;
}
/** Do not retain an exiting subtree with its observers and layout work. */
function TourPresence({children}:{children:React.ReactNode}) {return <>{children}</>;}
function useTourState({userId,ready,onNavigate}:TourOptions) {
 const {language}=useI18n();const messages=getOnboardingMessages(language);
 const [data,setData]=useState<OnboardingResponse|null>(null);
 const [open,setOpen]=useState(false);const [welcome,setWelcome]=useState(false);const [menu,setMenu]=useState(false);
 const [error,setError]=useState(false);const [missing,setMissing]=useState(false);
 const offerShown=useRef(false);const epoch=useRef(0);const queue=useRef<TourQueue|null>(null);
 const launcher=useRef<HTMLButtonElement>(null);const title=useRef<HTMLHeadingElement>(null);
 const returnFocus=useRef<HTMLElement|null>(null);
 const refresh=useCallback(async (_event?:TourBusinessEvent)=>queue.current?.refresh(),[]);
 useEffect(()=>{
  const token=++epoch.current,request=new AbortController();
  offerShown.current=false;setData(null);setOpen(false);setWelcome(false);setMenu(false);setError(false);setMissing(false);returnFocus.current=null;
  const read=async()=>{
   const response=await fetch('/api/onboarding',{cache:'no-store',signal:request.signal});
   if(!response.ok)throw new Error();return parseTourResponse(await response.json());
  };
  const controller=new TourQueue({read,write:async(intent,revision)=>{
   const current={state:{revision}};
   const response=await fetch('/api/onboarding',{method:'PATCH',signal:request.signal,headers:{'Content-Type':'application/json'},body:JSON.stringify({...intent,expectedRevision:current.state.revision})});
   if(response.status===409)throw new TourConflict();
   if(!response.ok)throw new Error();return parseTourResponse(await response.json());
  }},(value,failed,event)=>{
   if(token!==epoch.current)return;
   setData(value);setError(failed);
   if(event==='read'||event==='confirmed'){
    if(value&&(value.state.status==='dismissed'||value.state.status==='completed')&&regionRef.current?.contains(document.activeElement))restoreFocus();
    if(value&&(value.state.status==='dismissed'||value.state.status==='completed')){setOpen(false);setWelcome(false);}
   }
   if(event==='failure'){
    setWelcome(false);
    // A failed dismiss must not strand the error in a hidden panel. An external
    // dismissal stays authoritative: show the launcher menu, never auto-resume.
    setOpen(value?.state.status==='in_progress');setMenu(value?.state.status!=='in_progress');
   }
  });
  queue.current=userId?controller:null;if(userId)void controller.refresh();
  return()=>{epoch.current++;request.abort();controller.dispose();if(queue.current===controller)queue.current=null;};
 },[userId]);
 useEffect(()=>{const reread=()=>{if(document.visibilityState==='visible')void refresh();};window.addEventListener('focus',reread);document.addEventListener('visibilitychange',reread);return()=>{window.removeEventListener('focus',reread);document.removeEventListener('visibilitychange',reread);};},[refresh]);
 useEffect(()=>{if(!ready||error){setWelcome(false);return;}if(userId&&data?.autoOffer&&data.state.status!=='dismissed'&&data.state.status!=='completed'&&!offerShown.current){offerShown.current=true;returnFocus.current=document.activeElement instanceof HTMLElement?document.activeElement:null;setWelcome(true);}},[ready,error,userId,data]);
 const restoreFocus=()=>{
  const previous=returnFocus.current;
  const modal=document.querySelector<HTMLElement>('[role=dialog]');
  if(previous?.isConnected&&previous!==document.body&&(!modal||modal.contains(previous))){previous.focus({preventScroll:true});return;}
  if(modal)modal.querySelector<HTMLElement>('button:not([disabled]),input:not([disabled])')?.focus({preventScroll:true});
  else launcher.current?.focus({preventScroll:true});
 };
 const act=(action:OnboardingAction,step?:StepId)=>{
  if(!queue.current?.enqueue({action,...(step?{step}:{})}))return;
  offerShown.current=true;setWelcome(false);setMenu(false);
  if(action==='dismiss'||action==='finish'){setOpen(false);restoreFocus();}else setOpen(true);
 };
 const pause=()=>{setOpen(false);setWelcome(false);setMenu(false);restoreFocus();act('dismiss');};
 const step=data?.state.currentStep||ONBOARDING_STEPS[0];const index=ONBOARDING_STEPS.indexOf(step);const target=targetForStep(step);
 const regionRef=useRef<HTMLElement>(null);
 useEffect(()=>{
  if(!open&&!welcome&&!menu)return;
  const keyboard=(event:KeyboardEvent)=>{
   if(event.defaultPrevented||event.isComposing)return;
   if(event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();pause();return;}
   if(!open||event.altKey||event.ctrlKey||event.metaKey||event.shiftKey||!(event.target instanceof Element)||!regionRef.current?.contains(event.target))return;
   if(event.target.closest('input,select,textarea,summary,details,[contenteditable]:not([contenteditable="false"]),[role="textbox"],[role="combobox"],[role="slider"],[role="spinbutton"],[role="listbox"],[role="menu"],[role="tablist"]'))return;
   if(event.key==='ArrowLeft'&&index>0){event.preventDefault();act('back');}
   if(event.key==='ArrowRight'){event.preventDefault();act(step==='finish'?'finish':'next');}
  };
  document.addEventListener('keydown',keyboard,true);return()=>document.removeEventListener('keydown',keyboard,true);
 });
 const [targetRequest,setTargetRequest]=useState(0);
 const openTarget=()=>{if(onNavigate(target))setTargetRequest(value=>value+1);};
 useEffect(()=>{if(open||welcome||menu)title.current?.focus({preventScroll:true});},[open,welcome,menu,step,error]);
 const chapters=['welcome','profile','sources','feed','ai','youtube','finish'] as const;
 const evidence=data?.evidence;const configured=step.startsWith('profile.')?evidence?.profileReady:step.startsWith('sources.')||step.startsWith('feed.')?evidence?.hasRssSource:step.startsWith('ai.')?evidence?.aiConfigured:step.startsWith('youtube.')?evidence?.youtubeConfigured:undefined;
 const verified=step.startsWith('sources.')||step.startsWith('feed.')?evidence?.rssReady:step.startsWith('youtube.')?evidence?.youtubeReady:step.startsWith('ai.')?evidence?.aiTested:undefined;
 const chapterControl=<label className="tour-chapters">{messages.a11y.chapter.replace('{chapter}',messages.chapters[step.split('.')[0] as typeof chapters[number]])}<select aria-label={messages.a11y.chapter.replace('{chapter}',messages.chapters[step.split('.')[0] as typeof chapters[number]])} value={step.split('.')[0]} disabled={!data} onChange={event=>{const first=ONBOARDING_STEPS.find(value=>value.split('.')[0]===event.target.value);if(first)act('resume',first);}}>{chapters.map(chapter=><option key={chapter} value={chapter}>{messages.chapters[chapter]}</option>)}</select></label>;
 const launch=<button ref={launcher} type="button" data-tour="tour-launcher" className="tour-launcher" disabled={!userId} aria-expanded={menu||open||welcome} onClick={event=>{returnFocus.current=event.currentTarget;setOpen(false);setWelcome(false);setMenu(value=>!value);if(!data)void refresh();}}>{messages.actions.launch}</button>;
 const body=open?messages.steps[step].body:welcome?messages.help.welcome:messages.help.summary;
 const region=(open||menu||welcome)?<section ref={regionRef} className="tour-region" data-step={open?step:'menu'} role="region" aria-labelledby="tour-title" aria-describedby="tour-body">
  <div className="tour-heading"><h2 id="tour-title" ref={title} tabIndex={-1}>{open?messages.steps[step].title:messages.help.title}</h2><button type="button" className="small-button" onClick={pause} aria-label={messages.a11y.close}>{messages.actions.close}</button></div>
  <p id="tour-body" key={step} className="tour-step-body">{tourSummary(body)}</p>
  {error&&<p role="status" aria-live="assertive">{messages.status.progressUnavailable} <button type="button" onClick={()=>void refresh()}>{messages.actions.refresh}</button></p>}
  {welcome&&!open?<div className="tour-actions"><button type="button" disabled={!data} onClick={()=>act('start')}>{messages.actions.start}</button><button type="button" disabled={!data} onClick={pause}>{messages.actions.browse}</button></div>:null}
  {menu&&!open&&data?.state.status==='completed'&&<p role="status">{messages.status.complete} · {messages.status.viewed}: {data.state.viewedSteps.length} · {messages.status.skipped}: {data.state.skippedSteps.length}</p>}
  {menu&&!open?<><div className="tour-actions"><button type="button" disabled={!data} onClick={()=>act('resume')}>{messages.actions.resume}</button><button type="button" disabled={!data} onClick={()=>act('restart')}>{messages.actions.restart}</button></div>{chapterControl}</>:null}
  {open&&data&&<>
   <p className="tour-progress" aria-live="polite" aria-atomic="true"><span className="tour-announcement">{messages.steps[step].title} · </span>{messages.status.progress.replace('{current}',String(index+1)).replace('{total}',String(ONBOARDING_STEPS.length))}</p>
   <div className="tour-actions">
    <button type="button" onClick={openTarget}>{messages.actions.openTarget}</button>
    <button type="button" disabled={index===0} title={index===0?messages.a11y.firstStep:undefined} onClick={()=>act('back')}>{messages.actions.back}</button>
    <button type="button" onClick={()=>act('skip')}>{messages.actions.skip}</button>
    <button type="button" onClick={()=>act(step==='finish'?'finish':'next')}>{step==='finish'?messages.actions.finish:messages.actions.next}</button>
    <button type="button" onClick={pause}>{messages.actions.dismiss}</button>
    <button type="button" onClick={pause}>{messages.actions.later}</button>
   </div>
   <details className="tour-help" key={step}><summary>{messages.actions.help}</summary>
    <p>{body}</p>{chapterControl}
    <div className="tour-evidence"><span>{data.state.viewedSteps.includes(step)?messages.status.viewed:messages.status.pending}</span>{data.state.skippedSteps.includes(step)&&<span>{messages.status.skipped}</span>}{configured!==undefined&&<span>{configured?messages.status.configured:messages.status.notConfigured}</span>}{verified!==undefined&&<span>{verified?(step.startsWith('ai.')?messages.status.connectionTested:messages.status.verified):messages.status.notVerified}</span>}</div>
    {missing&&<p role="status">{messages.help.unavailable}</p>}
    <button type="button" onClick={()=>void refresh()}>{messages.actions.refresh}</button>
    {step==='finish'&&<ul className="tour-checklist" aria-label={messages.a11y.checklist}>{(['profile','sources','ai','youtube'] as const).map(chapter=><li key={chapter}>{messages.chapters[chapter]}: {(chapter==='profile'?evidence?.profileReady:chapter==='sources'?evidence?.hasRssSource:chapter==='ai'?evidence?.aiConfigured:evidence?.youtubeConfigured)?messages.status.configured:messages.status.notConfigured} · {(chapter==='sources'?evidence?.rssReady:chapter==='youtube'?evidence?.youtubeReady:chapter==='ai'?evidence?.aiTested:undefined)?(chapter==='ai'?messages.status.connectionTested:messages.status.verified):messages.status.notVerified}</li>)}<li>{messages.status.viewed}: {data.state.viewedSteps.length} · {messages.status.skipped}: {data.state.skippedSteps.length}</li></ul>}
    <TourHelp step={step}/>
   </details>
  </>}
  <Spotlight anchor={open?target.anchor:'tour-launcher'} step={open?step:'menu'} request={targetRequest} onMissing={setMissing} highlight={open}/>
 </section>:null;
 return {launch,region,refresh,active:open||welcome||menu,dirtyConfirm:messages.help.dirtyConfirm};
}
function TourHelp({step}:{step:StepId}){
 const {language}=useI18n();const messages=getOnboardingMessages(language);
 if(!step.startsWith('ai.')&&!step.startsWith('youtube.'))return null;
 const guides=step.startsWith('youtube.')?[messages.guides.youtube]:Object.values(messages.guides.ai);
 return <><p>{messages.help.checkedAt}</p><p>{messages.help.privacy}</p><p>{messages.help.costWarning}</p>{guides.map(guide=><section key={guide.title}><h3>{guide.title}</h3><p>{guide.summary}</p><ol>{guide.steps.map((text,index)=><li key={index}>{text}</li>)}</ol>{guide.links.map(link=><p key={link.url}><a href={link.url} target="_blank" rel="noopener noreferrer">{messages.a11y.externalLink.replace('{label}',link.label)} ↗</a></p>)}</section>)}</>;
}
