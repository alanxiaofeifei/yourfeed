'use client';

import {useEffect,useRef,useState} from 'react';
import {ArrowRight,Loader2,Sparkles} from 'lucide-react';
import type {Language,UserProfile} from '../../shared/profile';
import type {ProfileAdviceBasis,ProfileAdviceResponse,ProfileAdviceResult} from '../../shared/profile-advice';
import {useI18n} from '../i18n';
import './ProfileAdvice.css';

interface Props {profile:UserProfile;aiConfigured?:boolean;onOpenAiSettings?:()=>void;onUsageChange?:()=>void;}
function snapshot(profile:UserProfile,language:Language):string{return JSON.stringify([language,profile.goals,Object.entries(profile.topicWeights).sort(([a],[b])=>a.localeCompare(b))]);}

export default function ProfileAdvice({profile,aiConfigured,onOpenAiSettings,onUsageChange}:Props){
  const {t,language}=useI18n();const [busy,setBusy]=useState(false);const [error,setError]=useState('');const [needsConfiguration,setNeedsConfiguration]=useState(false);
  const [result,setResult]=useState<{value:ProfileAdviceResult;snapshot:string}|null>(null);const requestRef=useRef<AbortController|null>(null);
  useEffect(()=>()=>requestRef.current?.abort(),[]);
  const basisLabel=(basis:ProfileAdviceBasis)=>({goals:t('你填写的目标','Your stated goals'),interest_weights:t('兴趣权重','Interest weights'),source_topics:t('来源主题','Source topics'),feedback_topics:t('内容反馈','Content feedback')})[basis];
  const currentSnapshot=snapshot(profile,language);const stale=!!result&&result.snapshot!==currentSnapshot;
  const generate=async()=>{
    if(busy||requestRef.current)return;
    if(aiConfigured===false){setNeedsConfiguration(true);return;}
    const controller=new AbortController();requestRef.current=controller;const inputSnapshot=currentSnapshot;
    setBusy(true);setError('');setNeedsConfiguration(false);
    try{
      const response=await fetch('/api/profile/advice',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({profile,language}),signal:controller.signal});
      const data=await response.json() as ProfileAdviceResponse&{error?:string};
      if(!response.ok)throw new Error(typeof data.error==='string'?data.error:'AI 画像建议暂时无法生成，请稍后重试。');
      if(data.needsConfiguration){setNeedsConfiguration(true);return;}
      if(!data.advice||typeof data.advice.description!=='string')throw new Error('AI 画像建议格式不完整或缺少依据，请重试；偏好没有被更改。');
      setResult({value:data,snapshot:inputSnapshot});
    }catch(cause){if(!controller.signal.aborted)setError(cause instanceof Error?cause.message:'AI 画像建议暂时无法生成，请稍后重试。');}
    finally{if(!controller.signal.aborted){setBusy(false);onUsageChange?.();}if(requestRef.current===controller)requestRef.current=null;}
  };
  return <div className="profile-advice">
    <div className="profile-advice-intro"><span className="profile-advice-icon"><Sparkles size={22} aria-hidden="true"/></span><div><h3>{t('让 AI 帮你看看当前方向','Let AI reflect on your direction')}</h3><p>{t('根据当前偏好草稿、已启用来源的主题和有限的内容反馈，生成一份兴趣画像与下一步建议。','Generate a preference portrait and next-step suggestions from your current draft, enabled source topics, and a limited feedback sample.')}</p></div></div>
    <button type="button" className="primary-button profile-advice-generate" onClick={()=>void generate()} disabled={busy}>{busy?<Loader2 size={18} className="spin" aria-hidden="true"/>:<Sparkles size={18} aria-hidden="true"/>}{busy?t('正在生成画像与建议…','Generating your portrait…'):result?t('重新生成画像与建议','Regenerate portrait & advice'):t('AI 生成画像与建议','Generate portrait & advice')}</button>
    <p className="profile-advice-note">{t('使用已保存的 AI 服务商，计入本站每日任务与月预算。生成结果不会自动保存偏好、改变权重或添加来源。','Uses your saved AI provider and counts toward daily tasks and the monthly budget. It will not save preferences, change weights, or add sources.')}</p>
    {(needsConfiguration||aiConfigured===false)&&<div className="profile-advice-setup"><p>{t('先保存所选 AI 服务商的 API Key，再生成画像；无需开启自动 AI 阅读。','Save an API key for the selected provider first. Automatic AI reading can stay off.')}</p>{onOpenAiSettings&&<button type="button" className="small-button" onClick={onOpenAiSettings}>{t('前往 AI 设置','Open AI settings')}<ArrowRight size={15} aria-hidden="true"/></button>}</div>}
    {busy&&<p className="profile-advice-status" role="status">{t('正在整理你的偏好，原有设置保持不变。','Reflecting on your preferences. Your settings remain as they are.')}</p>}
    {error&&<div className="error-box" role="alert">{t(error)}</div>}
    {result&&<section className="profile-advice-report" aria-label={t('AI 兴趣画像与建议','AI preference portrait and advice')}>
      <div className="profile-advice-report-title"><strong>{t('当前兴趣画像','Preference portrait')}</strong><span>{result.value.model}</span></div>
      {stale&&<p className="profile-advice-stale" role="status">{t('你已修改偏好或语言，这份结果基于生成时的草稿。点击重新生成可更新。','Your preferences or language changed. This result reflects the draft at generation time; regenerate to update it.')}</p>}
      <p className="profile-advice-description">{result.value.advice.description}</p><p className="profile-advice-basis">{t('依据','Based on')}: {result.value.advice.descriptionBasis.map(basisLabel).join(' · ')}</p>
      <h4>{t('适合你的内容建议','Content suggestions')}</h4><ul className="profile-advice-recommendations">{result.value.advice.recommendations.map((item,index)=><li key={index}><strong>{item.title}</strong><p>{item.detail}</p><span className="profile-advice-basis">{t('依据','Based on')}: {item.basis.map(basisLabel).join(' · ')}</span></li>)}</ul>
      <h4>{t('可以尝试的下一步','Next steps to try')}</h4><ol className="profile-advice-next">{result.value.advice.nextSteps.map((step,index)=><li key={index}>{step}</li>)}</ol>
      <p className="profile-advice-evidence">{t('已启用来源','Enabled sources')}: {result.value.evidence.sourceCount} · {t('匹配到的反馈样本','Matching feedback sample')}: {result.value.evidence.feedbackCount} / {result.value.evidence.feedbackSampleLimit}</p>
      <p className="profile-advice-note">{t('这是对内容偏好的 AI 解读，不代表你的身份、能力或完整人生经历。建议仅供参考，由你决定是否调整。','This is an AI interpretation of content preferences, not your identity, abilities, or life history. You decide whether to act on any suggestion.')}</p>
    </section>}
  </div>;
}
