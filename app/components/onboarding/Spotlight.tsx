'use client';
import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

/** Geometry never enters React state. One read/write batch per frame, no polling. */
export function Spotlight({anchor,step,request,onMissing}:{anchor:string;step:string;request:number;onMissing:(missing:boolean)=>void}) {
 const ring=useRef<HTMLDivElement>(null);
 useEffect(()=>{
  let target:HTMLElement|null=null;
  let frame=0;
  let scrollPending=true;
  const reduced=window.matchMedia('(prefers-reduced-motion: reduce)');
  const resize=new ResizeObserver(()=>schedule());
  const measure=()=>{
   frame=0;
   const next=document.querySelector<HTMLElement>(`[role="dialog"] [data-tour="${anchor}"]`)||document.querySelector<HTMLElement>(`[data-tour="${anchor}"]`);
   if(next!==target){
    target?.removeAttribute('data-tour-highlight');resize.disconnect();target=next;
    if(target){target.setAttribute('data-tour-highlight','true');resize.observe(target);scrollPending=true;}
    onMissing(!target);
   }
   const overlay=ring.current;
   if(!target||!overlay){if(overlay)overlay.hidden=true;return;}
   // Scroll once on target/step changes, never during scroll/resize observation.
   if(scrollPending){scrollPending=false;target.scrollIntoView?.({block:'nearest',inline:'nearest',behavior:reduced.matches?'auto':'smooth'});}
   const rect=target.getBoundingClientRect();
   overlay.hidden=rect.width===0||rect.height===0||rect.bottom<=0||rect.top>=window.innerHeight;
   Object.assign(overlay.style,{left:`${rect.left-5}px`,top:`${rect.top-5}px`,width:`${rect.width+10}px`,height:`${rect.height+10}px`});
  };
  function schedule(){if(!frame)frame=requestAnimationFrame(measure);}
  const mutations=new MutationObserver(schedule);
  mutations.observe(document.body,{childList:true,subtree:true});
  window.addEventListener('scroll',schedule,{capture:true,passive:true});
  window.addEventListener('resize',schedule,{passive:true});
  window.visualViewport?.addEventListener('resize',schedule);
  schedule();
  return()=>{cancelAnimationFrame(frame);resize.disconnect();mutations.disconnect();window.removeEventListener('scroll',schedule,true);window.removeEventListener('resize',schedule);window.visualViewport?.removeEventListener('resize',schedule);target?.removeAttribute('data-tour-highlight');};
 },[anchor,step,request,onMissing]);
 return createPortal(<div key={step} ref={ring} className="tour-spotlight" data-spotlight={anchor} aria-hidden="true" hidden/>,document.body);
}
