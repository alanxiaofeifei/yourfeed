'use client';
import {useEffect,useRef,useState} from 'react';
import {Loader2,Sparkles} from 'lucide-react';
import {useI18n,localeTag} from '../i18n';
import {digestReasonText,type DigestResponse} from '../../shared/digest';
import type {ContentItem} from '../../shared/types';
import './DailyDigest.css';

export function useDailyDigest({ready,hasPicks,revision,onOpen,onAiSettings}:{ready:boolean;hasPicks:boolean;revision:number|string;onOpen:(item:ContentItem)=>void;onAiSettings?:()=>void}){
 const {language,t}=useI18n();const [data,setData]=useState<DigestResponse>();const [busy,setBusy]=useState(false);const [networkError,setNetworkError]=useState(false);const [now,setNow]=useState(Date.now());
 const mounted=useRef(true),generation=useRef(false),sequence=useRef(0);
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
 // Wait for the independently rendered briefing; cache reads never gate it.
 useEffect(()=>{if(!ready)return;const abort=new AbortController(),id=++sequence.current;const timer=setTimeout(()=>{void fetch('/api/briefing/digest',{headers:{'Accept-Language':localeTag(language)},signal:abort.signal}).then(async response=>{if(!response.ok)throw Error();return response.json() as Promise<DigestResponse>;}).then(value=>{if(!abort.signal.aborted&&id===sequence.current&&!generation.current){setData(value);setNetworkError(false);}}).catch(()=>{/* Cached reading is optional; an explicit click can retry. */});},0);return()=>{clearTimeout(timer);abort.abort();};},[ready,revision,language]);
 const openReader=async(item:ContentItem)=>{
  try{const response=await fetch(`/api/content?id=${encodeURIComponent(item.id)}`,{headers:{'Accept-Language':localeTag(language)}});if(response.ok){const current=await response.json() as ContentItem;if(current.id===item.id&&mounted.current){onOpen(current);return;}}}catch{/* A cached source can still be opened if it has left the library. */}
  if(mounted.current)onOpen(item);
 };
 const nextAllowedAt=data?.nextAllowedAt||0;
 useEffect(()=>{if(nextAllowedAt<=Date.now())return;const tick=setInterval(()=>{const current=Date.now();setNow(current);if(current>=nextAllowedAt)clearInterval(tick);},1000);return()=>clearInterval(tick);},[nextAllowedAt]);
 const generate=async(force=false)=>{
  if(generation.current)return;generation.current=true;++sequence.current;setBusy(true);setNetworkError(false);
  try{const response=await fetch('/api/briefing/digest',{method:'POST',headers:{'Content-Type':'application/json','Accept-Language':localeTag(language)},body:JSON.stringify({language:localeTag(language),force})});const value=await response.json() as DigestResponse;if(!['fresh','stale','none'].includes(value.status))throw Error();if(mounted.current){setData(value);setNow(Date.now());}}
  catch{if(mounted.current)setNetworkError(true);}finally{generation.current=false;if(mounted.current)setBusy(false);}
 };
 const blocked=busy||nextAllowedAt>now;const disabled=blocked||!hasPicks;
 const explanation=!hasPicks?t('今天还没有可总结的内容。'):blocked?t('请稍等 60 秒再生成，已有速览仍可阅读。'):undefined;
 const digest=data?.digest, fallback=digest?undefined:data?.fallback,channel=data?.channel||'free';const items=fallback?fallback.items.map(row=>row.item):digest?.items||[];
 const reason=networkError?'network':data?.reason;
 const mismatch=digest&&digest.language!==language;
 const notice=channel==='own'?t('使用你自己的 AI Key，费用由服务商向你收取。'):t('免费公共通道：共享且有限，可能失败；每次生成计入每日免费额度。条目标题与摘要会发送给第三方。');
 const button=<span className="digest-trigger"><button type="button" data-digest-generate disabled={disabled} title={explanation||notice} aria-describedby={!hasPicks?'digest-empty':undefined} onClick={()=>void generate(false)}><Sparkles size={13} aria-hidden="true"/>{t('AI 速览')}</button>{!hasPicks&&<span id="digest-empty" className="digest-empty-hint">{t('今天还没有可总结的内容。')}</span>}</span>;
 const card=<div className="digest-region" aria-live="polite" aria-busy={busy}>
  {busy&&<p className="digest-loading" role="status"><Loader2 size={14} className="spin" aria-hidden="true"/>{t('正在整理速览…')}</p>}
  {(digest||fallback||reason)&&<section className="daily-digest" aria-label={t('AI 速览')}>
   <div className="digest-heading"><strong>{fallback?t('快速清单 · 非 AI 生成'):t('AI 速览')}</strong>{data?.status==='stale'&&<span className="digest-badge">{t('有更新')}</span>}</div>
   {reason&&<p className="digest-notice" role="status">{t(digestReasonText[reason])} {reason==='own_key'&&onAiSettings&&<button type="button" onClick={onAiSettings}>{t('前往 AI 设置')}</button>}</p>}
   {mismatch&&<p className="digest-language">{t('用当前语言重新生成')}</p>}
   {fallback?<ul className="digest-points">{fallback.items.map(({item,text})=><li key={item.id}>{text}</li>)}</ul>:digest&&<><p className="digest-overview">{digest.result.overview}</p><ul className="digest-points">{digest.result.points.map((point,index)=><li key={index}>{point.text} <span className="digest-markers">{point.itemIds.map(id=>{const n=items.findIndex(item=>item.id===id);return n<0?null:<a key={id} href={`#digest-source-${n+1}`} aria-label={`${t('来源')} ${n+1}`}>[{n+1}]</a>;})}</span></li>)}</ul></>}
   {items.length>0&&<ol className="digest-sources">{items.map((item,index)=><li key={item.id} id={`digest-source-${index+1}`}><div><span className="digest-source-number">[{index+1}]</span><strong>{item.title}</strong></div><p><span>{item.sourceName}</span><time dateTime={item.publishedAt}>{Number.isFinite(Date.parse(item.publishedAt))?new Date(item.publishedAt).toLocaleDateString(localeTag(language),{timeZone:digest?.timeZone||'UTC',month:'short',day:'numeric'}):item.publishedAt}</time>{/^https?:\/\//i.test(item.url)&&<a href={item.url} target="_blank" rel="noopener noreferrer">{t('查看原文')}</a>}<button type="button" onClick={()=>void openReader(item)}>{t('打开阅读器')}</button></p></li>)}</ol>}
   <footer className="digest-footer"><div>{digest&&!fallback&&<><time dateTime={digest.createdAt}>{t('生成于')} {new Date(digest.createdAt).toLocaleString(localeTag(language))}</time><span>{digest.channel==='free'?t('免费公共通道'):digest.model}</span>{digest.window==='recent'&&<span>{t('近 7 天精选')}</span>}</>}</div><button type="button" data-digest-regenerate disabled={disabled} title={explanation} onClick={()=>void generate(true)}>{mismatch?t('用当前语言重新生成'):t('重新生成')}</button><p>{notice}</p>{blocked&&!busy&&<p>{t('请稍等 60 秒再生成，已有速览仍可阅读。')}</p>}</footer>
  </section>}
 </div>;
 return {button,card};
}
