import type { ContentItem } from './types';
import {honestContent} from './content-coverage';

export type MarkdownVariant = 'original' | 'ai-summary';
export type ExportTranslate = (chinese: string, english?: string) => string;

const sensitiveKey = /^(?:token|access[_-]?token|refresh[_-]?token|api[_-]?key|key|auth|authorization|signature|sig|code|password|secret)$/i;

/** Original publisher URLs only. Never construct a share link to the private feed. */
export function shareableSourceUrl(input: string, privateOrigin?: string): string | null {
  try {
    if (typeof input !== 'string' || input.length > 4096 || /[\s\x00-\x1f\x7f\\]/.test(input)) return null;
    const url = new URL(input);
    const host = url.hostname.toLowerCase().replace(/\.$/, '');
    if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')) return null;
    if (!host.includes('.') || host.includes(':') || /^[\d.]+$/.test(host) || /(?:^|\.)(?:localhost|local|internal|intranet|lan|home|test|invalid|example|onion|arpa)$/i.test(host)) return null;
    if (privateOrigin && url.origin === new URL(privateOrigin).origin) return null;
    if (/(?:unsubscribe|signout|logout|oauth|callback|settings\/billing)/i.test(url.pathname)) return null;
    if ([...url.searchParams.keys()].some(key => sensitiveKey.test(key))) return null;
    const fragment = decodeURIComponent(url.hash);
    if (/[?&#](?:token|access[_-]?token|refresh[_-]?token|api[_-]?key|key|auth|authorization|signature|sig|code|password|secret)=/i.test(fragment)) return null;
    url.hostname = host;
    for (const key of [...url.searchParams.keys()]) if (/^utm_|^(?:spm_id_from|spm|ref_src|ref_url|feature|si|fbclid|gclid)$/i.test(key)) url.searchParams.delete(key);
    // Keep meaningful query parameters and story fragments: they can identify a
    // particular story or version, rather than a tracking value.
    return url.toString();
  } catch { return null; }
}

/** The cache stores plain source text. Escape it, rather than interpreting it as
 * executable HTML or publisher-supplied Markdown instructions/links. */
export function markdownText(value: string): string {
  return String(value || '').replace(/\r\n?/g, '\n').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '').replace(/[\\`*_{}\[\]()#+\-!|>]/g, '\\$&').replace(/</g, '&lt;').replace(/&(?!(?:lt|gt);)/g, '&amp;');
}

function paragraph(value: string): string { return markdownText(value).trim(); }

export function markdownFilename(title: string, variant: MarkdownVariant): string {
  const stem = Array.from(String(title || '').normalize('NFKC').replace(/[\x00-\x1f\x7f<>:"/\\|?*\u202a-\u202e\u2066-\u2069]/g, '').replace(/\s+/g, ' ').replace(/^[. ]+|[. ]+$/g, '')).slice(0, 80).join('') || 'content';
  return `${stem}-${variant}.md`;
}

export function buildContentMarkdown(item: ContentItem, variant: MarkdownVariant, t: ExportTranslate, privateOrigin?: string): { filename: string; markdown: string } {
  item=honestContent(item);
  if (variant === 'ai-summary' && !item.analysis) throw new Error('AI_SUMMARY_UNAVAILABLE');
  const source = shareableSourceUrl(item.url, privateOrigin);
  const lines = [`# ${paragraph(item.title)}`, '', `${t('来源', 'Source')}: ${paragraph(item.sourceName)} · ${paragraph(item.platform)}`];
  if (source) lines.push(`${t('原始链接', 'Original URL')}: <${source.replace(/</g, '%3C').replace(/>/g, '%3E')}>`);
  else lines.push(t('原始链接不可安全导出，请在原平台确认。', 'The original URL could not be exported safely. Check it on the source platform.'));
  if (item.dateSource!=='missing' && item.publishedAt!=='1970-01-01T00:00:00.000Z' && item.publishedAt && Number.isFinite(Date.parse(item.publishedAt))) lines.push(`${t('发布时间', 'Published')}: ${new Date(item.publishedAt).toISOString()}`);
  if (variant === 'original') {
    lines.push('', `## ${t('来源内容（本站可读取部分）', 'Available source text')}`, '', t('此文件导出本站缓存的来源文字，可能只是摘要或描述，并不保证是完整原文。请以原始链接为准。', 'This file exports source text cached by this instance. It may contain only an excerpt or description, not the complete original. Refer to the original URL.'));
    if (item.kind === 'video') lines.push('', t('视频内容仅导出可取得的标题与描述，不包含视频、音频或完整字幕。', 'For videos, this export includes the available title and description, not video, audio, or a full transcript.'));
    if (item.summary?.trim()) lines.push('', `### ${t('来源摘要 / 描述', 'Source excerpt / description')}`, '', paragraph(item.summary));
    if (item.body?.trim() && item.body.trim() !== item.summary?.trim()) lines.push('', `### ${t('可读取正文', 'Available body text')}`, '', paragraph(item.body));
    if (!item.summary?.trim() && !item.body?.trim()) lines.push('', t('本站尚未取得正文或摘要，此文件仅保留标题与来源信息。', 'No body text or excerpt is available. This file preserves only the title and source information.'));
  } else {
    const analysis = item.analysis!;
    const coverage = analysis.coverage === 'full_text' ? t('基于可读取正文', 'Based on available text') : analysis.coverage === 'excerpt' ? t('基于原文摘要', 'Based on source excerpt') : t('基于标题与元数据', 'Based on metadata');
    lines.push('', `## ${t('AI 总结', 'AI summary')}`, '', t('以下内容由 AI 生成，可能存在遗漏或错误，不是原作者的完整原文。', 'The following content was generated by AI and may contain omissions or errors. It is not the complete original text.'), '', `${t('分析依据', 'Coverage')}: ${coverage}`, `${t('模型', 'Model')}: ${paragraph(analysis.model)}`, '', `### ${t('要点', 'Key points')}`, '');
    for (const bullet of analysis.bullets || []) lines.push(`- ${paragraph(bullet).replace(/\n/g, '\n  ')}`);
    if (analysis.relevance?.trim()) lines.push('', `### ${t('与你的关联', 'Why it fits you')}`, '', paragraph(analysis.relevance));
    const references = [...new Set((analysis.references || []).map(url => shareableSourceUrl(url, privateOrigin)).filter((url): url is string => !!url))];
    if (references.length) lines.push('', `### ${t('引用来源', 'References')}`, '', ...references.map(url => `- <${url.replace(/</g, '%3C').replace(/>/g, '%3E')}>`));
  }
  const related = (item.relatedSources || []).map(entry => ({ name: entry.name, url: shareableSourceUrl(entry.url, privateOrigin) })).filter((entry): entry is { name: string; url: string } => !!entry.url && entry.url !== source);
  if (related.length) lines.push('', `## ${t('其他来源', 'Related sources')}`, '', ...related.map(entry => `- ${paragraph(entry.name)}: <${entry.url.replace(/</g, '%3C').replace(/>/g, '%3E')}>`));
  return { filename: markdownFilename(item.title, variant), markdown: lines.join('\n').trim() + '\n' };
}
