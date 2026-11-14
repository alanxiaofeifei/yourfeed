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

type TourOptions = {userId:string;ready:boolean;onNavigate:(target:TourTarget)=>boolean};
/** Keep high-frequency tour progress/busy updates out of the entire feed tree. */
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
function TourPresence({children}:{children:React.ReactNode}) {
 const last=useRef(children);if(children)last.current=children;
 const [retained,setRetained]=useState(!!children);
 const visible=!!children;
 useEffect(()=>{if(visible){setRetained(true);return;}if(window.matchMedia('(prefers-reduced-motion: reduce)').matches){setRetained(false);return;}const timer=window.setTimeout(()=>setRetained(false),180);return()=>clearTimeout(timer);},[visible]);
 return children?<>{children}</>:retained?<div className="tour-exiting" inert>{last.current}</div>:null;
}
function useTourState({userId,ready,onNavigate}:TourOptions) {
 const {language}=useI18n();const messages=getOnboardingMessages(language);
 const [data,setData]=useState<OnboardingResponse|null>(null);const [open,setOpen]=useState(false);const [welcome,setWelcome]=useState(false);const [menu,setMenu]=useState(false);const [busy,setBusy]=useState(false);const [error,setError]=useState(false);const [missing,setMissing]=useState(false);
 const offerShown=useRef(false);const busyRef=useRef(false);const sequence=useRef(0);
 const launcher=useRef<HTMLButtonElement>(null);const epoch=useRef(0);const request=useRef<AbortController|null>(null);const dataRef=useRef(data);dataRef.current=data;
 const refresh=useCallback(async (_event?:TourBusinessEvent)=>{if(!userId)return;const token=epoch.current;const serial=++sequence.current;try{const response=await fetch('/api/onboarding',{cache:'no-store',signal:request.current?.signal});if(!response.ok)throw new Error();const value=parseTourResponse(await response.json());if(token!==epoch.current||serial!==sequence.current||value.state.revision<(dataRef.current?.state.revision??0))return;dataRef.current=value;setData(value);setError(false);if(value.state.status==='dismissed'||value.state.status==='completed'){setOpen(false);setWelcome(false);}return value;}catch{if(token===epoch.current&&serial===sequence.current&&!request.current?.signal.aborted)setError(true);}},[userId]);
 useEffect(()=>{epoch.current++;request.current?.abort();request.current=new AbortController();offerShown.current=false;busyRef.current=false;dataRef.current=null;setBusy(false);setData(null);setOpen(false);setWelcome(false);setMenu(false);if(userId)void refresh();return()=>{epoch.current++;request.current?.abort();};},[userId,refresh]);
 useEffect(()=>{const reread=()=>{if(document.visibilityState==='visible')void refresh();};window.addEventListener('focus',reread);document.addEventListener('visibilitychange',reread);return()=>{window.removeEventListener('focus',reread);document.removeEventListener('visibilitychange',reread);};},[refresh]);
 useEffect(()=>{if(!ready||error){setWelcome(false);return;}if(userId&&data?.autoOffer&&data.state.status!=='dismissed'&&data.state.status!=='completed'&&!offerShown.current){offerShown.current=true;setWelcome(true);}},[ready,error,userId,data]);
 const restoreFocus=()=>{const modal=document.querySelector<HTMLElement>('[role=dialog]');if(modal)modal.querySelector<HTMLElement>('button:not([disabled]),input:not([disabled])')?.focus();else launcher.current?.focus();};
 const act=async(action:OnboardingAction,step?:StepId)=>{const current=dataRef.current;if(!current||busyRef.current)return;busyRef.current=true;sequence.current++;setBusy(true);setError(false);const token=epoch.current;try{const response=await fetch('/api/onboarding',{method:'PATCH',signal:request.current?.signal,headers:{'Content-Type':'application/json'},body:JSON.stringify({action,expectedRevision:current.state.revision,...(step?{step}:{})})});if(response.status===409){await refresh();throw new Error();}if(!response.ok)throw new Error();const value=parseTourResponse(await response.json());if(token!==epoch.current||value.state.revision<(dataRef.current?.state.revision??0))return;dataRef.current=value;setData(value);setWelcome(false);setMenu(false);if(action==='dismiss'||action==='finish'){setOpen(false);restoreFocus();}else setOpen(true);}catch{if(token===epoch.current)setError(true);}finally{if(token===epoch.current){busyRef.current=false;setBusy(false);}}};
 const pause=()=>{if(busyRef.current)return;setOpen(false);setWelcome(false);setMenu(false);restoreFocus();void act('dismiss');};
 useEffect(()=>{if(!open&&!welcome&&!menu)return;const escape=(event:KeyboardEvent)=>{if(event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();pause();}};document.addEventListener('keydown',escape,true);return()=>document.removeEventListener('keydown',escape,true);},[open,welcome,menu,busy,data]);
 const step=data?.state.currentStep||ONBOARDING_STEPS[0];const index=ONBOARDING_STEPS.indexOf(step);const target=targetForStep(step);
 const [targetRequest,setTargetRequest]=useState(0);
 const openTarget=()=>{if(onNavigate(target))setTargetRequest(value=>value+1);};
 const title=useRef<HTMLHeadingElement>(null);
 useEffect(()=>{if(open)title.current?.focus({preventScroll:true});},[open,step]);
 const chapters=['welcome','profile','sources','feed','ai','youtube','finish'] as const;
 const evidence=data?.evidence;const configured=step.startsWith('profile.')?evidence?.profileReady:step.startsWith('sources.')||step.startsWith('feed.')?evidence?.hasRssSource:step.startsWith('ai.')?evidence?.aiConfigured:step.startsWith('youtube.')?evidence?.youtubeConfigured:undefined;
 const verified=step.startsWith('sources.')||step.startsWith('feed.')?evidence?.rssReady:step.startsWith('youtube.')?evidence?.youtubeReady:step.startsWith('ai.')?evidence?.aiTested:undefined;
 // Account initialization resets the menu; do not let an early click open it before then.
 const launch=<button ref={launcher} type="button" data-tour="tour-launcher" className="tour-launcher" disabled={!userId} aria-expanded={menu||open||welcome} onClick={()=>{setOpen(false);setWelcome(false);setMenu(value=>!value);if(!data)void refresh();}}>{messages.actions.launch}</button>;
 const region=(open||menu||welcome)?<section className="tour-region" data-step={open?step:"menu"} role="region" aria-labelledby="tour-title" aria-describedby="tour-body">
 <div className="tour-heading"><h2 id="tour-title" ref={title} tabIndex={-1}>{open?messages.steps[step].title:messages.help.title}</h2><button type="button" className="small-button" onClick={pause} disabled={busy}>{messages.actions.close}</button></div>
 <p id="tour-body" key={step} className="tour-step-body">{open?messages.steps[step].body:welcome?messages.help.welcome:messages.help.summary}</p>
 {error&&<p role="status">{messages.status.error} <button type="button" onClick={()=>void refresh()}>{messages.actions.refresh}</button></p>}
 {welcome&&!open?<div className="tour-actions"><button type="button" disabled={busy||!data} onClick={()=>void act('start')}>{messages.actions.start}</button><button type="button" disabled={busy||!data} onClick={pause}>{messages.actions.browse}</button></div>:null}
 {menu&&!open&&data?.state.status==='completed'&&<p role="status">{messages.status.complete} · {messages.status.viewed}: {data.state.viewedSteps.length} · {messages.status.skipped}: {data.state.skippedSteps.length}</p>}
 {menu&&!open?<div className="tour-actions"><button type="button" disabled={busy||!data} onClick={()=>void act('resume')}>{messages.actions.resume}</button><button type="button" disabled={busy||!data} onClick={()=>void act('restart')}>{messages.actions.restart}</button></div>:null}
 {(open||menu)&&<label className="tour-chapters">{messages.a11y.chapter.replace('{chapter}',messages.chapters[step.split('.')[0] as typeof chapters[number]])}<select aria-label={messages.a11y.chapter.replace('{chapter}',messages.chapters[step.split('.')[0] as typeof chapters[number]])} value={step.split('.')[0]} disabled={busy||!data} onChange={event=>{const first=ONBOARDING_STEPS.find(value=>value.split('.')[0]===event.target.value);if(first)void act('resume',first);}}>{chapters.map(chapter=><option key={chapter} value={chapter}>{messages.chapters[chapter]}</option>)}</select></label>}
 {open&&data&&<><p className="tour-progress" aria-live="polite" aria-atomic="true"><span className="tour-announcement">{messages.steps[step].title} · </span>{messages.status.progress.replace('{current}',String(index+1)).replace('{total}',String(ONBOARDING_STEPS.length))}</p><div className="tour-evidence"><span>{data.state.viewedSteps.includes(step)?messages.status.viewed:messages.status.pending}</span>{data.state.skippedSteps.includes(step)&&<span>{messages.status.skipped}</span>}{configured!==undefined&&<span>{configured?messages.status.configured:messages.status.notConfigured}</span>}{verified!==undefined&&<span>{verified?(step.startsWith('ai.')?messages.status.connectionTested:messages.status.verified):messages.status.notVerified}</span>}</div>{missing&&<p role="status">{messages.help.unavailable}</p>}<div className="tour-actions"><button type="button" onClick={openTarget}>{messages.actions.openTarget}</button><button type="button" onClick={()=>void refresh()} disabled={busy}>{messages.actions.refresh}</button><button type="button" disabled={busy||index===0} title={index===0?messages.a11y.firstStep:undefined} onClick={()=>void act('back')}>{messages.actions.back}</button><button type="button" disabled={busy} onClick={()=>void act('skip')}>{messages.actions.skip}</button><button type="button" disabled={busy} onClick={()=>void act(step==='finish'?'finish':'next')}>{step==='finish'?messages.actions.finish:messages.actions.next}</button><button type="button" disabled={busy} onClick={pause}>{messages.actions.dismiss}</button></div>{step==='finish'&&<ul className="tour-checklist">{(['profile','sources','ai','youtube'] as const).map(chapter=><li key={chapter}>{messages.chapters[chapter]}: {(chapter==='profile'?evidence?.profileReady:chapter==='sources'?evidence?.hasRssSource:chapter==='ai'?evidence?.aiConfigured:evidence?.youtubeConfigured)?messages.status.configured:messages.status.notConfigured} · {(chapter==='sources'?evidence?.rssReady:chapter==='youtube'?evidence?.youtubeReady:chapter==='ai'?evidence?.aiTested:false)?(chapter==='ai'?messages.status.connectionTested:messages.status.verified):messages.status.notVerified}</li>)}<li>{messages.status.viewed}: {data.state.viewedSteps.length} · {messages.status.skipped}: {data.state.skippedSteps.length}</li></ul>}<TourHelp step={step}/></>}
 {open&&<Spotlight anchor={target.anchor} step={step} request={targetRequest} onMissing={setMissing}/>}
 </section>:null;
 return {launch,region,refresh,active:open||welcome||menu,dirtyConfirm:messages.help.dirtyConfirm};
}
function TourHelp({step}:{step:StepId}){const {language}=useI18n();const messages=getOnboardingMessages(language);if(!step.startsWith('ai.')&&!step.startsWith('youtube.'))return null;const guides=step.startsWith('youtube.')?[messages.guides.youtube]:Object.values(messages.guides.ai);return <details className="tour-help"><summary>{messages.actions.help}</summary><p>{messages.help.checkedAt}</p><p>{messages.help.privacy}</p><p>{messages.help.costWarning}</p>{guides.map(guide=><section key={guide.title}><h3>{guide.title}</h3><p>{guide.summary}</p><ol>{guide.steps.map((text,index)=><li key={index}>{text}</li>)}</ol>{guide.links.map(link=><p key={link.url}><a href={link.url} target="_blank" rel="noopener noreferrer">{messages.a11y.externalLink.replace('{label}',link.label)} ↗</a></p>)}</section>)}</details>;}
