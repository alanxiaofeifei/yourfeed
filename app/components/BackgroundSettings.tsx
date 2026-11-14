'use client';
import {useRef,useState} from 'react';
import {useI18n} from '../i18n';
import {refreshMessages} from '../../shared/refresh-messages';
import type {RefreshPolicy,RefreshStatus,RefreshMode} from '../../shared/refresh-policy';
export default function BackgroundSettings({policy,onChange,loadFailed,onRetry}:{policy:RefreshStatus|null;onChange:(value:RefreshStatus)=>void;loadFailed:boolean;onRetry:()=>void}){
 const {language}=useI18n(),m=refreshMessages[language];
 const [message,setMessage]=useState(''),[busy,setBusy]=useState(false),[pending,setPending]=useState<Partial<RefreshPolicy>>({}),saving=useRef(false);
 const current=policy?{...policy,...pending,effectiveRefreshMode:pending.refreshMode??policy.effectiveRefreshMode}:null;
 const save=async(patch:Partial<RefreshPolicy>)=>{
  if(saving.current)return;saving.current=true;setBusy(true);setPending(patch);setMessage('');
  try{const r=await fetch('/api/background',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(patch)});if(!r.ok)throw Error();onChange(await r.json() as RefreshStatus);setMessage('saved');}
  catch{setMessage('failed');}finally{saving.current=false;setBusy(false);setPending({});}
 };
 return <section className="settings-card refresh-settings" aria-labelledby="refresh-title">
  <h2 id="refresh-title">{m.title}</h2>
  <p id="refresh-cost">{m.cost}</p>
  {current?<>
   <label htmlFor="refresh-mode">{m.mode}</label>
   <select id="refresh-mode" aria-describedby="refresh-cost refresh-timing" disabled={busy} value={current.effectiveRefreshMode} onChange={e=>void save({refreshMode:e.target.value as RefreshMode})}>
    <option value="manual">{m.manual}</option><option value="on_open">{m.on_open}</option><option value="scheduled" disabled={!current.schedulerConfigured}>{m.scheduled}</option>
   </select>
   <label htmlFor="refresh-interval">{m.interval}</label>
   <select id="refresh-interval" disabled={busy||current.effectiveRefreshMode==='manual'} value={current.intervalHours} onChange={e=>void save({intervalHours:Number(e.target.value)})}>
    {[...new Set([1,2,4,6,12,24,current.intervalHours])].sort((a,b)=>a-b).map(h=><option key={h} value={h}>{h}</option>)}
   </select>
   {!current.schedulerConfigured&&<p role="status" id="refresh-unavailable">{m.unavailable}</p>}
   <label className="storage-choice"><input type="checkbox" disabled={busy||current.effectiveRefreshMode!=='scheduled'} checked={current.aiEnabled} onChange={e=>void save({aiEnabled:e.target.checked})}/>{m.ai}</label>
  </>:<p role="status">{loadFailed?<>{m.loadFailed} <button type="button" className="small-button" onClick={onRetry}>{m.retry}</button></>:m.loading}</p>}
  <p id="refresh-timing">{m.timing}</p>
  <p role={message==='failed'?'alert':'status'}>{message==='saved'?m.saved:message==='failed'?m.failed:''}</p>
 </section>;
}
