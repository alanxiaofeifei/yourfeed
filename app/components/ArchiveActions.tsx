'use client';
import {useEffect,useRef,useState} from 'react';
import {Download,Loader2,X} from 'lucide-react';
import {archiveFiles,buildTarArchive,fetchArchivePages} from '../../shared/library-archive';
import {useI18n} from '../i18n';
import './StorageSettings.css';

export interface ArchiveActionsProps {scope?:'all'|'liked'|'saved';notify?:(message:string)=>void;}
export default function ArchiveActions({scope='all',notify}:ArchiveActionsProps){
 const {t}=useI18n(),[busy,setBusy]=useState(false),[count,setCount]=useState(0),[message,setMessage]=useState('');
 const request=useRef<AbortController|null>(null),mounted=useRef(true);
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;request.current?.abort();};},[]);
 const download=async()=>{
  if(request.current)return;const controller=new AbortController();request.current=controller;setBusy(true);setCount(0);setMessage('');
  try{
   const pages=await fetchArchivePages(controller.signal,setCount,scope);if(controller.signal.aborted)return;
   const archive=buildTarArchive(archiveFiles(pages,t,window.location.origin));
   const url=URL.createObjectURL(new Blob([archive as BlobPart],{type:'application/x-tar'}));
   const link=document.createElement('a');link.href=url;link.download=`yourfeed-${scope}-${new Date().toISOString().slice(0,10)}.tar`;document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),15000);
   const done=t('归档文件已准备，请确认浏览器下载。','Archive prepared. Check your browser downloads.');setMessage(done);notify?.(done);
  }catch(error){if(!controller.signal.aborted)setMessage((error as Error).message==='ARCHIVE_TOO_LARGE'?t('归档超过 50 MB，请缩小范围或分批导出。','The archive exceeds 50 MB. Export a smaller selection in batches.'):t('归档未完成，请重新登录或稍后重试。','The archive could not be completed. Sign in again or try later.'));}
  finally{if(mounted.current)setBusy(false);request.current=null;}
 };
 return <div className="archive-actions"><div className="storage-button-row"><button type="button" className="primary-button" disabled={busy} onClick={()=>void download()}>{busy?<Loader2 size={17} className="spin"/>:<Download size={17}/>} {t('下载阅读归档','Download reading archive')}</button>{busy&&<button type="button" className="small-button" onClick={()=>{request.current?.abort();setMessage(t('已取消归档。','Archive cancelled.'));}}><X size={15}/>{t('取消','Cancel')}</button>}</div><p className="field-help">{t('包含 Markdown、已有 AI 笔记、订阅和偏好的 JSON。不会发起新的 AI 分析，不包含密钥或登录会话。','Includes Markdown, existing AI notes, and JSON with sources and preferences. No new AI analysis, API keys, or sign-in sessions.')}</p><p className="field-help">{t('文件包含个人阅读数据，请妥善保存。下载到电脑的副本无法远程撤回。','This file contains personal reading data. Keep it private. Downloaded copies cannot be remotely revoked.')}</p><div role="status" aria-live="polite">{busy?t('正在整理归档：','Preparing archive:')+' '+count:message}</div></div>;
}
