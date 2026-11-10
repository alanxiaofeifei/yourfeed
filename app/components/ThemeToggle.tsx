'use client';
import { branding } from '../../data/branding';

import { useEffect, useRef } from 'react';
import { Moon, Sun } from 'lucide-react';
import { useI18n } from '../i18n';

type Theme = 'light' | 'dark';
const storageKey = branding.themeStorageKey;
const isTheme = (value: string | null): value is Theme => value === 'light' || value === 'dark';

function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
}

/** The label and icon are CSS-controlled, so SSR and first hydration match. */
export default function ThemeToggle() {
  const {t}=useI18n();
  const explicitChoice = useRef<Theme | null>(null);

  useEffect(() => {
    const preference = window.matchMedia('(prefers-color-scheme: dark)');
    try {
      const saved = localStorage.getItem(storageKey);
      if (isTheme(saved)) explicitChoice.current = saved;
    } catch { /* A private browser can still switch theme for this visit. */ }

    const followSystem = () => {
      if (!explicitChoice.current) applyTheme(preference.matches ? 'dark' : 'light');
    };
    const followOtherTab = (event: StorageEvent) => {
      if (event.key !== storageKey) return;
      explicitChoice.current = isTheme(event.newValue) ? event.newValue : null;
      applyTheme(explicitChoice.current || (preference.matches ? 'dark' : 'light'));
    };
    preference.addEventListener('change', followSystem);
    window.addEventListener('storage', followOtherTab);
    return () => {
      preference.removeEventListener('change', followSystem);
      window.removeEventListener('storage', followOtherTab);
    };
  }, []);

  const toggle = () => {
    const next = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
    explicitChoice.current = next;
    applyTheme(next);
    try { localStorage.setItem(storageKey, next); } catch { /* Session-only choice. */ }
  };

  return <button type="button" className="theme-toggle" onClick={toggle} aria-label={t('切换浅色或深色模式','Switch light or dark theme')} title={t('切换浅色 / 深色模式','Switch light / dark theme')}>
    <Sun size={14} className="theme-light" aria-hidden="true" />
    <Moon size={14} className="theme-dark" aria-hidden="true" />
    <span className="theme-light">{t('浅色','Light')}</span>
    <span className="theme-dark">{t('深色','Dark')}</span>
  </button>;
}
