'use client';

import { useEffect, useRef, useState } from 'react';
import './FeedMotion.css';

export function computeStaggerDelay(index: number, maxItems = 7, stepMs = 42): string {
  const safeIndex = Number.isFinite(index) && index > 0 ? Math.min(Math.floor(index), maxItems) : 0;
  return `${safeIndex * stepMs}ms`;
}

export function computeReadingProgress(scrollTop: number, scrollHeight: number, clientHeight: number): number {
  const maxScroll = scrollHeight - clientHeight;
  if (!Number.isFinite(maxScroll) || maxScroll <= 0) return 0;
  const raw = scrollTop / maxScroll;
  return Math.min(1, Math.max(0, Number(raw.toFixed(4))));
}

export function measureTabIndicator(
  tabOffset: { offsetLeft: number; offsetWidth: number },
): { x: number; width: number } {
  return {
    x: Math.max(0, Math.round(tabOffset.offsetLeft)),
    width: Math.max(0, Math.round(tabOffset.offsetWidth)),
  };
}

export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduced(media.matches);
    const onChange = (event: MediaQueryListEvent) => setReduced(event.matches);
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);
  return reduced;
}

export function EditorialSignalMark({
  variant = 'hero',
  mode = 'rest',
  syncing = false,
  className = '',
}: {
  variant?: 'hero' | 'empty';
  mode?: 'rest' | 'grow';
  syncing?: boolean;
  className?: string;
}) {
  const reducedMotion = useReducedMotion();
  return (
    <span
      className={`editorial-signal-mark editorial-signal-${variant} ${syncing ? 'is-syncing' : ''} ${className}`.trim()}
      data-variant={variant}
      data-mode={mode}
      data-reduced-motion={reducedMotion ? 'true' : 'false'}
      aria-hidden="true"
    >
      {!reducedMotion && <span className="editorial-signal-clip" />}
      <svg
        className="editorial-signal-static"
        viewBox="0 0 64 64"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <circle className="signal-ring-outer" cx="32" cy="32" r="26" strokeWidth="1.2" />
        <circle className="signal-ring-inner" cx="32" cy="32" r="18.5" strokeWidth="1" strokeDasharray="3 3" />
        <path
          className="signal-ticks"
          d="M32 3.5V8.5M32 55.5V60.5M3.5 32H8.5M55.5 32H60.5M11.8 11.8L14.8 14.8M49.2 49.2L52.2 52.2M52.2 11.8L49.2 14.8M14.8 49.2L11.8 52.2"
          strokeWidth="1.3"
          strokeLinecap="round"
        />
        <path
          className="signal-arc"
          d="M32 6 A26 26 0 0 1 56.5 23.2"
          strokeWidth="2"
          strokeLinecap="round"
        />
        <circle className="signal-bead" cx="56.5" cy="23.2" r="2.6" />
        <g className="signal-star" transform="translate(32 32) rotate(10)">
          <line x1="-11.5" y1="0" x2="11.5" y2="0" strokeWidth="2.2" strokeLinecap="round" />
          <line x1="-5.75" y1="-9.96" x2="5.75" y2="9.96" strokeWidth="1.85" strokeLinecap="round" />
          <line x1="5.75" y1="-9.96" x2="-5.75" y2="9.96" strokeWidth="1.85" strokeLinecap="round" />
          <circle cx="0" cy="0" r="2.2" />
        </g>
      </svg>
    </span>
  );
}

const SCRAMBLE_CHARS = '0123456789ABCDEF!@#$%&*?_~';

export function KineticHeadline({
  text,
  scrambleKeyword,
  className = '',
  as = 'h1',
}: {
  text: string;
  scrambleKeyword?: string;
  className?: string;
  as?: 'h1' | 'h2';
}) {
  const reducedMotion = useReducedMotion();
  const [scrambled, setScrambled] = useState(scrambleKeyword || '');
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    if (!scrambleKeyword || reducedMotion) return;

    let iteration = 0;
    const target = scrambleKeyword;
    const maxIterations = target.length * 3;
    const interval = setInterval(() => {
      setScrambled(
        target
          .split('')
          .map((char, index) => {
            if (char === ' ') return ' ';
            if (index < iteration / 3) return target[index];
            return SCRAMBLE_CHARS[Math.floor(Math.random() * SCRAMBLE_CHARS.length)];
          })
          .join(''),
      );
      iteration++;
      if (iteration >= maxIterations) {
        setScrambled(target);
        clearInterval(interval);
      }
    }, 45);

    return () => clearInterval(interval);
  }, [scrambleKeyword, reducedMotion]);

  const Tag = as;

  if (reducedMotion || !mounted) {
    return (
      <Tag className={`kinetic-headline ${className}`.trim()} aria-label={text}>
        {text}
        {scrambleKeyword && <span className="kinetic-scramble-tag"> [{scrambleKeyword}]</span>}
      </Tag>
    );
  }

  // Split text into characters for kinetic typographic entrance
  const chars = Array.from(text);

  return (
    <Tag className={`kinetic-headline ${className}`.trim()} aria-label={text}>
      <span className="kinetic-chars-wrapper" aria-hidden="true">
        {chars.map((char, index) => (
          <span
            key={`${index}-${char}`}
            className="kinetic-char"
            style={{
              '--char-index': index,
              animationDelay: `${index * 38}ms`,
            } as React.CSSProperties}
          >
            {char === ' ' ? '\u00A0' : char}
          </span>
        ))}
      </span>
      {scrambleKeyword && (
        <span className="kinetic-scramble-badge" aria-hidden="true">
          <span className="scramble-dot" />
          <span className="scramble-code">{scrambled}</span>
        </span>
      )}
    </Tag>
  );
}

export interface NewsTickerItem {
  id: string;
  title: string;
  category?: string;
  url?: string;
}

export function NewsTicker({
  items,
  title = 'DISPATCH',
  className = '',
  onSelect,
}: {
  items: NewsTickerItem[];
  title?: string;
  className?: string;
  onSelect?: (item: NewsTickerItem) => void;
}) {
  const reducedMotion = useReducedMotion();
  if (!items || items.length === 0) return null;

  // Duplicate items to make seamless continuous loop
  const displayItems = [...items, ...items];

  return (
    <div
      className={`editorial-ticker ${className}`.trim()}
      role="region"
      aria-label="Breaking news ticker"
    >
      <div className="ticker-badge">
        <span className="ticker-pulse" />
        <span className="ticker-title">{title}</span>
      </div>
      <div className="ticker-viewport">
        <div className={`ticker-track ${reducedMotion ? 'reduced' : ''}`}>
          {displayItems.map((item, index) => (
            <button
              key={`${item.id}-${index}`}
              className="ticker-item"
              onClick={() => onSelect?.(item)}
              type="button"
            >
              {item.category && <span className="ticker-item-category">{item.category}</span>}
              <span className="ticker-item-title">{item.title}</span>
              <span className="ticker-divider" aria-hidden="true">
                ✦
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

export function useGlidingTabs<T extends string>(activeKey: T, extraDeps: unknown[] = []) {
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const update = () => {
      const selected =
        container.querySelector<HTMLElement>(`[data-tab-id="${activeKey}"]`) ||
        container.querySelector<HTMLElement>('.selected');
      if (!selected) {
        container.style.setProperty('--tab-indicator-opacity', '0');
        return;
      }
      const { x, width } = measureTabIndicator(selected);
      container.style.setProperty('--tab-indicator-x', `${x}px`);
      container.style.setProperty('--tab-indicator-w', `${width}px`);
      container.style.setProperty('--tab-indicator-opacity', '1');
    };

    update();
    const observer =
      typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => update()) : null;
    observer?.observe(container);
    window.addEventListener('resize', update, { passive: true });
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', update);
    };
  }, [activeKey, ...extraDeps]);

  return containerRef;
}

export function useEditorialScroll(modalActive = false) {
  const topbarRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const topbar = topbarRef.current;
    if (!topbar) return;

    let frame = 0;
    const syncScroll = () => {
      frame = 0;
      const doc = document.documentElement;
      const scrollTop = window.scrollY || doc.scrollTop || 0;
      const progress = computeReadingProgress(scrollTop, doc.scrollHeight, doc.clientHeight);
      topbar.dataset.scrolled = scrollTop > 14 ? 'true' : 'false';
      topbar.style.setProperty('--reading-progress', String(progress));
    };

    const onScroll = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(syncScroll);
    };

    syncScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll, { passive: true });
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    };
  }, [modalActive]);

  return topbarRef;
}

export function useStickyToolbarProgress() {
  const toolbarRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const toolbar = toolbarRef.current;
    if (!toolbar) return;

    let frame = 0;
    const sync = () => {
      frame = 0;
      const doc = document.documentElement;
      const scrollTop = window.scrollY || doc.scrollTop || 0;
      const mainArea = document.querySelector('.main-area') as HTMLElement | null;
      if (!mainArea) return;
      const areaRect = mainArea.getBoundingClientRect();
      const areaTop = scrollTop + areaRect.top;
      const areaHeight = mainArea.offsetHeight;
      const scrolledInArea = Math.max(0, scrollTop - areaTop);
      const progress = areaHeight > 0 ? Math.min(1, Math.max(0, scrolledInArea / (areaHeight - 400))) : 0;
      toolbar.style.setProperty('--section-progress', String(progress.toFixed(4)));
    };

    const onScroll = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(sync);
    };

    sync();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll, { passive: true });
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    };
  }, []);

  return toolbarRef;
}

export function useFeedReveal(deps: unknown[]) {
  const gridRef = useRef<HTMLDivElement | null>(null);
  const reducedMotion = useReducedMotion();

  useEffect(() => {
    const grid = gridRef.current;
    if (!grid) return;
    const cards = Array.from(grid.querySelectorAll<HTMLElement>('.content-card'));
    if (!cards.length) return;

    if (reducedMotion || typeof IntersectionObserver === 'undefined') {
      for (const card of cards) card.dataset.visible = 'true';
      return;
    }

    const viewportH = window.innerHeight || 800;
    const observer = new IntersectionObserver(
      entries => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            (entry.target as HTMLElement).dataset.visible = 'true';
            observer.unobserve(entry.target);
          }
        }
      },
      { rootMargin: '0px 0px -40px 0px', threshold: 0.08 },
    );

    for (const card of cards) {
      const rect = card.getBoundingClientRect();
      if (rect.top < viewportH * 0.92) {
        card.dataset.visible = 'true';
      } else {
        card.dataset.visible = 'false';
        observer.observe(card);
      }
    }

    return () => observer.disconnect();
  }, [reducedMotion, ...deps]);

  return gridRef;
}
