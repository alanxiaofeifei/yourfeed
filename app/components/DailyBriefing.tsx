'use client';

import { useEffect, useState } from 'react';
import { ArrowUpRight, Clock3, Loader2, Newspaper, RefreshCw, Sparkles } from 'lucide-react';
import type { ContentItem } from '../../shared/types';
import './DailyBriefing.css';
import { useI18n, localeTag } from '../i18n';
import ContentActions from './ContentActions';

interface Briefing {
  date: string;
  timeZone: string;
  window: 'today' | 'recent' | 'empty';
  items: { item: ContentItem; reason: string; signal: string }[];
  lastUpdated?: string;
}

export default function DailyBriefing({ revision, onOpen, onNews }: {
  revision: number;
  onOpen: (item: ContentItem) => void;
  onNews: () => void;
}) {
  const {language,t}=useI18n();
  const [briefing, setBriefing] = useState<Briefing>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const timer=setInterval(()=>{if(!briefing?.date)return;const parts=new Intl.DateTimeFormat('en',{timeZone:briefing.timeZone||'UTC',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());const values=Object.fromEntries(parts.map(part=>[part.type,part.value]));if(`${values.year}-${values.month}-${values.day}`!==briefing.date)setRetry(value=>value+1);},60000);
    return()=>clearInterval(timer);
  },[briefing?.date,briefing?.timeZone]);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError('');
    void fetch('/api/briefing', { signal: controller.signal, headers:{'Accept-Language':language} })
      .then(async response => {
        if (!response.ok) throw new Error(t('今日精选暂时未能加载。','Daily picks could not be loaded.'));
        return response.json() as Promise<Briefing>;
      })
      .then(data => { if (!controller.signal.aborted) setBriefing(data); })
      .catch(cause => { if (!controller.signal.aborted) setError((cause as Error).message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [revision, retry, language]);

  return <section className="daily-briefing" aria-labelledby="daily-briefing-title" aria-busy={loading}>
    <header className="daily-briefing-heading">
      <div className="daily-briefing-label"><span className="daily-briefing-icon"><Newspaper size={17}/></span><div>
        <div className="daily-briefing-eyebrow">YOUR DAILY SIGNAL</div>
        <h2 id="daily-briefing-title">{t('今日必看','Daily picks')} <span>{briefing?.window === 'recent' ? t('近 7 天精选','Past 7 days') : t('为你精选','For you')}</span></h2>
      </div></div>
      <button className="daily-briefing-all" onClick={onNews}>{t('全部新闻','All news')} <ArrowUpRight size={13}/></button>
    </header>
    <p className="daily-briefing-intro">{t('按你的兴趣与目标筛选，最多 3 条值得关注的变化。','Up to 3 worthwhile changes, selected for your interests and goals.')}</p>
    {briefing?.window === 'recent' && <div className="daily-briefing-window"><Clock3 size={11}/>{t('今日暂无合适的重大更新，以下来自最近 7 天，日期见各条来源。','No matching major updates today. These picks are from the past 7 days; see each source date.')}</div>}
    {error ? <div className="daily-briefing-empty" role="status"><span>{error}</span><button onClick={() => setRetry(value => value + 1)}><RefreshCw size={12}/>{t('重试','Retry')}</button></div>
      : !briefing && loading ? <div className="daily-briefing-empty" role="status"><Loader2 size={14} className="spin"/>{t('正在挑选重要信号…','Finding worthwhile signals…')}</div>
      : briefing?.items.length ? <div className="daily-briefing-list">{briefing.items.map(({ item, reason, signal }, index) => {
        const sourceDate = new Date(item.publishedAt);
        const published = Number.isFinite(sourceDate.getTime()) ? sourceDate.toLocaleDateString(localeTag(language), { timeZone:briefing?.timeZone||'UTC', month: 'numeric', day: 'numeric' }) : '';
        return <article className="daily-pick" key={item.id}>
          <span className="daily-pick-number" aria-hidden="true">0{index + 1}</span>
          <div className="daily-pick-content">
            <div className="daily-pick-meta"><span className="daily-pick-signal">{signal}</span><span>{item.sourceName}</span><time dateTime={item.publishedAt}>{published}</time>{item.relatedSources && item.relatedSources.length > 1 && <span>{item.relatedSources.length} {t('个来源','sources')}</span>}</div>
            <button className="daily-pick-open" onClick={() => onOpen(item)}><h3>{item.title}</h3><ArrowUpRight size={14}/></button>
            <p className="daily-pick-summary">{item.analysis?.bullets[0] || item.summary}</p>
            <p className="daily-pick-reason"><Sparkles size={11}/><span><strong>{t('与你有关','Why it matters')}</strong> {reason}</span></p>
            <ContentActions item={item} onOpen={() => onOpen(item)}/>
          </div>
        </article>;
      })}</div> : <div className="daily-briefing-empty" role="status"><span>{t('暂未发现相关的重要更新。添加来源并更新内容后，会在这里精选。','No relevant major updates yet. Add sources and refresh your library to find daily picks.')}</span></div>}
    <footer className="daily-briefing-footer"><span>{t('按重要性与个人关联筛选 · 保留原始出处','Selected for importance and relevance · original sources preserved')}</span>{briefing?.date && <time dateTime={briefing.date}>{briefing.date.replaceAll('-', '.')}</time>}</footer>
  </section>;
}
