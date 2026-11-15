'use client';
import { useLayoutEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

const clamp=(value:number,min:number,max:number)=>Math.max(min,Math.min(value,Math.max(min,max)));
/** One persistent spotlight; layout reads/writes are coalesced, never React state. */
export function Spotlight({anchor,step,request,onMissing,highlight=true}:{anchor:string;step:string;request:number;onMissing:(missing:boolean)=>void;highlight?:boolean}) {
 const ring=useRef<HTMLDivElement>(null);
 const arrow=useRef<SVGSVGElement>(null);
 useLayoutEffect(()=>{
  let target:HTMLElement|null=null,frame=0,scrollPending=true,lastW=0,lastH=0,confirmSeen=false;
  const panel=document.querySelector<HTMLElement>('.tour-region');
  if(!panel)return;
  const reduced=window.matchMedia('(prefers-reduced-motion: reduce)');
  const dialog=panel.closest<HTMLElement>('[role="dialog"]');
  const originalDialog=dialog?{maxHeight:dialog.style.maxHeight,marginBottom:dialog.style.marginBottom}:null;
  const resize=new ResizeObserver(()=>schedule());resize.observe(panel);
  const measure=()=>{
   frame=0;
   const candidate=document.querySelector<HTMLElement>(`[role="dialog"] [data-tour="${anchor}"]`)||document.querySelector<HTMLElement>(`[data-tour="${anchor}"]`);
   const next=candidate&&candidate.getClientRects().length?candidate:null;
   if(next!==target){target?.removeAttribute('data-tour-highlight');if(target)resize.unobserve(target);target=next;if(target){scrollPending=true;if(highlight)target.setAttribute('data-tour-highlight','true');resize.observe(target);}onMissing(!target);}
   const viewport=window.visualViewport;
   const left=viewport?.offsetLeft||0,top=viewport?.offsetTop||0,w=viewport?.width||innerWidth,h=viewport?.height||innerHeight;
   const mobile=w<=600;
   panel.style.maxHeight=`${Math.max(80,Math.min(h-24,mobile?h*.6-16:h-24))}px`;
   const pw=Math.min(mobile?w-24:360,w-24),ph=panel.getBoundingClientRect().height;
   // In a modal reserve an actual nonoverlapping scroll area above the sheet,
   // including its sticky confirmation footer (not just the highlighted list).
   if(dialog&&originalDialog){
    dialog.style.maxHeight=mobile?`${Math.max(80,h-ph-36)}px`:originalDialog.maxHeight;
    dialog.style.marginBottom=mobile?`${ph+24}px`:originalDialog.marginBottom;
   }
   const confirm=dialog?.querySelector<HTMLElement>('[data-tour="source-confirm"]');
   const resized=w!==lastW||h!==lastH||(Boolean(confirm)&&!confirmSeen);
   lastW=w;lastH=h;if(confirm)confirmSeen=true;
   const correctOverlap=scrollPending||resized;
   if(scrollPending&&target){scrollPending=false;target.scrollIntoView?.({block:'nearest',inline:'nearest',behavior:'instant'});}
   if(mobile&&dialog&&confirm&&correctOverlap){
    const cr=confirm.getBoundingClientRect(),dr=dialog.getBoundingClientRect();
    if(cr.height>0&&cr.bottom>dr.bottom)dialog.scrollBy({top:cr.bottom-dr.bottom,behavior:'instant'});
   }
   let rect=target?.getBoundingClientRect();
   // A compact mobile sheet reserves the opposite side for the live target.
   let x=left+(w-pw)/2,y=top+h-ph-12;
   if(rect){
    if(mobile){
     if(!dialog&&rect.top>top+h/2)y=top+12;
     const overlaps=()=>rect!.left<x+pw&&rect!.right>x&&rect!.top<y+ph+12&&rect!.bottom>y-12;
     // Never fight a user's subsequent scroll: correct only on target/request change.
     if(!dialog&&correctOverlap&&overlaps()){
      const delta=y>top+h/2?rect.bottom-(y-18):rect.top-(y+ph+18);
      window.scrollBy({top:delta,behavior:'instant'});
      rect=target?.getBoundingClientRect();
     }
    }else{
     const gap=18;
     const placements=[{x:rect.right+gap,y:rect.top},{x:rect.left-pw-gap,y:rect.top},{x:rect.left,y:rect.bottom+gap},{x:rect.left,y:rect.top-ph-gap}];
     const fits=placements.find(p=>p.x>=left+12&&p.x+pw<=left+w-12&&p.y>=top+12&&p.y+ph<=top+h-12);
     const best=fits||placements[rect.left>left+w/2?1:0];x=best.x;y=best.y;
    }
   }
   const px=clamp(x,left+12,left+w-pw-12),py=clamp(y,top+12,top+h-ph-12);
   Object.assign(panel.style,{width:`${pw}px`,left:`${clamp(x,left+12,left+w-pw-12)}px`,top:`${clamp(y,top+12,top+h-ph-12)}px`});
   const overlay=ring.current;if(!overlay)return;
   overlay.hidden=!highlight||!rect||rect.width===0||rect.height===0||rect.bottom<=top||rect.top>=top+h;
   if(!rect&&arrow.current)arrow.current.style.display='none';
   if(rect){
    Object.assign(overlay.style,{width:`${rect.width+10}px`,height:`${rect.height+10}px`,transform:`translate3d(${rect.left-5}px,${rect.top-5}px,0)`});
    const pointer=arrow.current;
    if(pointer){
     // The arrow belongs to the popover, never the highlighted target. Physical
     // viewport coordinates also work when the document's inline direction is RTL.
     const side=rect.right<=px?'left':rect.left>=px+pw?'right':rect.bottom<=py?'top':rect.top>=py+ph?'bottom':null;
     pointer.style.display=!highlight||overlay.hidden||mobile||!side?'none':'block';
     if(side){
      const horizontal=side==='top'||side==='bottom';
      const cx=rect.left+rect.width/2,cy=rect.top+rect.height/2;
      const bx=horizontal?clamp(cx,px+18,px+pw-18):side==='left'?px:px+pw;
      const by=horizontal?(side==='top'?py:py+ph):clamp(cy,py+18,py+ph-18);
      const dx=cx-bx,dy=cy-by,length=Math.hypot(dx,dy)||1;
      const tx=bx+dx/length*12,ty=by+dy/length*12;
      const points=horizontal?[[bx-8,by],[bx+8,by],[tx,ty]]:[[bx,by-8],[bx,by+8],[tx,ty]];
      const ax=Math.min(...points.map(p=>p[0])),ay=Math.min(...points.map(p=>p[1]));
      Object.assign(pointer.style,{left:`${ax}px`,top:`${ay}px`,width:`${Math.max(...points.map(p=>p[0]))-ax}px`,height:`${Math.max(...points.map(p=>p[1]))-ay}px`});
      pointer.dataset.side=side;
      pointer.firstElementChild?.setAttribute('points',points.map(p=>`${p[0]-ax},${p[1]-ay}`).join(' '));
     }
    }
   }
  };
  function schedule(){if(!frame)frame=requestAnimationFrame(measure);}
  const mutations=new MutationObserver(schedule);mutations.observe(document.body,{childList:true,subtree:true});
  window.addEventListener('scroll',schedule,{capture:true,passive:true});window.addEventListener('resize',schedule,{passive:true});
  window.visualViewport?.addEventListener('resize',schedule);window.visualViewport?.addEventListener('scroll',schedule);
  measure();
  return()=>{cancelAnimationFrame(frame);resize.disconnect();mutations.disconnect();window.removeEventListener('scroll',schedule,true);window.removeEventListener('resize',schedule);window.visualViewport?.removeEventListener('resize',schedule);window.visualViewport?.removeEventListener('scroll',schedule);target?.removeAttribute('data-tour-highlight');if(dialog&&originalDialog)Object.assign(dialog.style,originalDialog);};
 },[anchor,step,request,onMissing,highlight]);
 return createPortal(<><div ref={ring} className="tour-spotlight" data-spotlight={anchor} aria-hidden="true" hidden></div><svg ref={arrow} className="tour-pointer" aria-hidden="true"><polygon/></svg></>,document.querySelector('[role="dialog"]')?.closest('.modal-backdrop')||document.body);
}
