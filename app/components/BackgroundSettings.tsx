'use client';
import {useEffect,useState} from 'react';
import {useI18n} from '../i18n';
interface Policy {enabled:boolean;aiEnabled:boolean;intervalHours:number;schedulerConfigured:boolean;}
export default function BackgroundSettings(){
 const {t}=useI18n(),[policy,setPolicy]=useState<Policy|null>(null),[message,setMessage]=useState(''),[busy,setBusy]=useState(false);
 useEffect(()=>{const abort=new AbortController();fetch('/api/background',{signal:abort.signal,cache:'no-store'}).then(async r=>{if(!r.ok)throw Error();return r.json();}).then(p=>setPolicy(p as Policy)).catch(()=>{});return()=>abort.abort();},[]);
 const save=async(patch:Partial<Policy>)=>{setBusy(true);try{const r=await fetch('/api/background',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(patch)});if(!r.ok)throw Error();setPolicy(await r.json() as Policy);setMessage(t('后台设置已保存。','Background settings saved.'));}catch{setMessage(t('设置未保存，请重新验证身份后重试。','Settings were not saved. Reauthenticate and retry.'));}finally{setBusy(false);}};
 return <section className="settings-card"><h2>{t('可选后台更新','Optional background updates')}</h2><p>{t('抓取、AI 和邮件费用分别计算。后台任务默认关闭。','Fetching, AI, and email have separate quotas and costs. Background tasks are off by default.')}</p>{policy&&<><label className="storage-choice"><input type="checkbox" disabled={busy} checked={policy.enabled} onChange={e=>void save({enabled:e.target.checked})}/>{t('每 6 小时后台抓取来源','Fetch sources in the background every 6 hours')}</label><label className="storage-choice"><input type="checkbox" disabled={busy} checked={policy.aiEnabled} onChange={e=>void save({aiEnabled:e.target.checked})}/>{t('允许后台 AI 分析，使用我的 Key 与预算','Allow background AI analysis using my key and budget')}</label>{!policy.schedulerConfigured&&<p role="status">{t('平台定时器尚未配置；保存开关不会自动创建定时任务。','No platform scheduler is configured. Saving these switches does not create a scheduled task.')}</p>}</>}<p role="status">{message}</p></section>;
}
