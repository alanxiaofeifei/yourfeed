'use client';

import { useId, useRef, useState } from 'react';
import { ArrowUpRight, Copy, Download, FileText, Share2, Sparkles } from 'lucide-react';
import type { ContentItem } from '../../shared/types';
import { buildContentMarkdown, shareableSourceUrl, type MarkdownVariant } from '../../shared/content-export';
import { useI18n } from '../i18n';
import NotebookShare from './NotebookShare';
import './ContentActions.css';

export default function ContentActions({ item, onOpen }: { item: ContentItem; onOpen?: () => void }) {
  const { t } = useI18n();
  const [panel, setPanel] = useState<'download' | 'share' | null>(null);
  const [status, setStatus] = useState('');
  const [manualCopy, setManualCopy] = useState(false);
  const [busy, setBusy] = useState(false);
  const copying = useRef(false);
  const toolbar = useRef<HTMLDivElement>(null);
  const id = useId();
  const source = shareableSourceUrl(item.url, typeof window === 'undefined' ? undefined : window.location.origin);
  const toggle = (value: 'download' | 'share') => { setPanel(old => old === value ? null : value); setStatus(''); setManualCopy(false); };
  const download = (variant: MarkdownVariant) => {
    try {
      const file = buildContentMarkdown(item, variant, t, window.location.origin);
      const url = URL.createObjectURL(new Blob([file.markdown], { type: 'text/markdown;charset=utf-8' }));
      const link = document.createElement('a');
      link.href = url; link.download = file.filename; link.style.display = 'none';
      document.body.appendChild(link);
      try { link.click(); } finally { link.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 1000); }
      setStatus(t('已开始下载 Markdown 文件。', 'Your Markdown download has started.'));
    } catch { setStatus(t('下载未完成，请重试。已有内容仍然保留。', 'The download could not be started. Please try again. Your content is retained.')); }
  };
  const copySource = async () => {
    if (!source || copying.current) return;
    copying.current = true; setBusy(true); setStatus(''); setManualCopy(false);
    try {
      if (!navigator.clipboard?.writeText) throw new Error('CLIPBOARD_UNAVAILABLE');
      await navigator.clipboard.writeText(source);
      setStatus(t('已复制原文链接，可以分享给其他人。', 'Original URL copied. You can share it with others.'));
    } catch {
      setManualCopy(true);
      setStatus(t('浏览器不允许自动复制。请选择下方链接并复制，再粘贴到需要的地方。', 'Automatic copying is unavailable. Select and copy the URL below, then paste it where you need it.'));
    } finally { copying.current = false; setBusy(false); }
  };
  return <div className="content-actions" onKeyDown={event => { if (event.key === 'Escape' && panel) { event.stopPropagation(); toolbar.current?.querySelector<HTMLButtonElement>('[aria-expanded="true"]')?.focus(); setPanel(null); } }}>
    <div className="content-actions-toolbar" ref={toolbar} role="group" aria-label={t('下载与分享', 'Download and share')}>
      <button type="button" aria-expanded={panel === 'download'} aria-controls={`${id}-download`} onClick={() => toggle('download')}><Download size={15}/><span>{t('下载 Markdown', 'Download Markdown')}</span></button>
      <button type="button" aria-expanded={panel === 'share'} aria-controls={`${id}-share`} onClick={() => toggle('share')}><Share2 size={15}/><span>{t('分享', 'Share')}</span></button>
    </div>
    {panel === 'download' && <section className="content-action-panel" id={`${id}-download`} aria-label={t('选择 Markdown 内容', 'Choose Markdown content')}>
      <button type="button" onClick={() => download('original')}><FileText size={17}/><span><strong>{t('下载来源原文', 'Download source text')}</strong><small>{t('本站可读取的文字 · .md', 'Available source text · .md')}</small></span><Download size={15}/></button>
      <button type="button" disabled={!item.analysis} onClick={() => download('ai-summary')}><Sparkles size={17}/><span><strong>{t('下载 AI 总结', 'Download AI summary')}</strong><small>{item.analysis ? t('要点、个人关联与引用 · .md', 'Key points, relevance, and references · .md') : t('尚未生成 AI 总结', 'No AI summary yet')}</small></span><Download size={15}/></button>
      <p>{t('只导出已有内容，不额外调用 AI。来源文字可能不完整；视频不含完整字幕。', 'Exports existing content without an AI call. Source text may be incomplete; videos do not include a full transcript.')}</p>
      {!item.analysis && onOpen && <button type="button" className="content-action-link" onClick={onOpen}>{t('打开内容生成 AI 总结', 'Open item to generate AI notes')}<ArrowUpRight size={13}/></button>}
    </section>}
    {panel === 'share' && <section className="content-action-panel" id={`${id}-share`} aria-label={t('分享原始来源', 'Share the original source')}>
      <button type="button" disabled={!source || busy} onClick={() => void copySource()}><Copy size={17}/><span><strong>{t('复制原文链接', 'Copy original URL')}</strong><small>{t('分享原始网站，任何人都可按其访问规则阅读', 'Share the publisher URL, subject to its access rules')}</small></span></button>
      {source ? <NotebookShare itemId={item.id} sourceUrl={source} title={item.title}/> : <p>{t('此来源链接暂时无法安全分享，请在原平台确认。', 'This source URL cannot be shared safely. Check it on the original platform.')}</p>}
      <p>{t('只分享原文链接，不会分享你的画像、笔记或 API 设置。', 'Only the original URL is shared. Your profile, notes, and API settings stay private.')}</p>
      {manualCopy && source && <label className="content-manual-copy">{t('手动复制原文链接', 'Copy original URL manually')}<input aria-label={t('原文链接', 'Original URL')} readOnly value={source} onFocus={event => event.currentTarget.select()}/></label>}
    </section>}
    {status && <p className="content-action-status" role="status">{status}</p>}
  </div>;
}
