import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  EditorialSignalMark,
  computeReadingProgress,
  computeStaggerDelay,
  measureTabIndicator,
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
});
