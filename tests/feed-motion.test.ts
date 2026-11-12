import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  EditorialSignalMark,
  KineticHeadline,
  NewsTicker,
  computeReadingProgress,
  computeStaggerDelay,
  measureTabIndicator,
  tokenizeKineticText,
} from '../app/components/FeedMotion';

describe('homepage editorial motion module', () => {
  it('computes bounded stagger delays without unbounded growth on long feeds', () => {
    expect(computeStaggerDelay(0)).toBe('0ms');
    expect(computeStaggerDelay(1)).toBe('42ms');
    expect(computeStaggerDelay(4)).toBe('168ms');
    expect(computeStaggerDelay(25)).toBe('294ms');
    expect(computeStaggerDelay(-3)).toBe('0ms');
    expect(computeStaggerDelay(Number.NaN)).toBe('0ms');
    expect(computeStaggerDelay(2, 3, 55)).toBe('110ms');
  });

  it('normalizes reading progress into [0, 1] safely', () => {
    expect(computeReadingProgress(0, 2000, 800)).toBe(0);
    expect(computeReadingProgress(600, 2000, 800)).toBe(0.5);
    expect(computeReadingProgress(1500, 2000, 800)).toBe(1);
    expect(computeReadingProgress(-50, 2000, 800)).toBe(0);
    expect(computeReadingProgress(100, 800, 800)).toBe(0);
  });

  it('measures tab underline geometry cleanly', () => {
    expect(measureTabIndicator({ offsetLeft: 84.4, offsetWidth: 63.8 })).toEqual({
      x: 84,
      width: 64,
    });
    expect(measureTabIndicator({ offsetLeft: -4, offsetWidth: 0 })).toEqual({
      x: 0,
      width: 0,
    });
  });

  it('renders EditorialSignalMark with accessible decorative attributes and SVG fallback', () => {
    const heroHtml = renderToStaticMarkup(
      createElement(EditorialSignalMark, { variant: 'hero', mode: 'grow', syncing: true }),
    );
    expect(heroHtml).toContain('aria-hidden="true"');
    expect(heroHtml).toContain('data-variant="hero"');
    expect(heroHtml).toContain('data-mode="grow"');
    expect(heroHtml).toContain('editorial-signal-clip');
    expect(heroHtml).toContain('editorial-signal-static');

    const emptyHtml = renderToStaticMarkup(
      createElement(EditorialSignalMark, { variant: 'empty', mode: 'rest' }),
    );
    expect(emptyHtml).toContain('data-variant="empty"');
    expect(emptyHtml).toContain('data-mode="rest"');
  });

  it('renders KineticHeadline with accessible aria-label and heading semantics', () => {
    const html = renderToStaticMarkup(
      createElement(KineticHeadline, { text: '把时间，留给值得的内容。', scrambleKeyword: 'RELAX' }),
    );
    expect(html).toContain('<h1');
    expect(html).toContain('aria-label="把时间，留给值得的内容。"');
    expect(html).toContain('kinetic-headline');
    expect(html).toContain('RELAX');
  });

  it('wraps words in .kinetic-word containers with real breakable spaces and natural CJK segmentation', () => {
    const enHtml = renderToStaticMarkup(
      createElement(KineticHeadline, { text: 'Make time for what matters.', scrambleKeyword: 'RELAX' }),
    );
    expect(enHtml).toContain('aria-label="Make time for what matters."');
    expect(enHtml).toContain('class="kinetic-chars-wrapper" aria-hidden="true"');
    const wordMatches = enHtml.match(/class="kinetic-word"/g) || [];
    expect(wordMatches.length).toBe(5);
    expect(enHtml).toContain('</span> <span class="kinetic-word"');
    expect(enHtml).not.toContain('\u00A0');
    expect(enHtml).not.toContain('&nbsp;');

    const enTokens = tokenizeKineticText('Make time for what matters.');
    expect(enTokens.filter(t => t.type === 'word').map(t => t.text)).toEqual([
      'Make',
      'time',
      'for',
      'what',
      'matters.',
    ]);

    const zhTokens = tokenizeKineticText('把时间，留给值得的内容。');
    expect(zhTokens.length).toBeGreaterThan(1);
    for (const token of zhTokens) {
      expect(token.chars.length).toBeLessThanOrEqual(8);
    }
    expect(zhTokens.map(t => t.text)).toContain('间，');
    expect(zhTokens.map(t => t.text)).toContain('容。');
  });

  it('renders NewsTicker with role region and duplicate tracks for seamless marquee', () => {
    const items = [
      { id: '1', title: 'Local-first sync workflows', category: 'NEWS' },
      { id: '2', title: 'Practical AI evaluation', category: 'AI' },
    ];
    const html = renderToStaticMarkup(
      createElement(NewsTicker, { items, title: 'DISPATCH' }),
    );
    expect(html).toContain('role="region"');
    expect(html).toContain('DISPATCH');
    expect(html).toContain('Local-first sync workflows');
    expect(html).toContain('Practical AI evaluation');
    expect(html).toContain('ticker-track');
  });
});
