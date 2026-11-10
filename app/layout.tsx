import './globals.css';
import { branding } from '../data/branding';
import type { ReactNode } from 'react';
import { I18nProvider } from './i18n';

export const metadata = { title: branding.title, description: branding.description };

const themeBootstrap = `(function(){var saved=null;try{saved=localStorage.getItem(${JSON.stringify(branding.themeStorageKey)})}catch(e){}var theme=saved==='light'||saved==='dark'?saved:window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';document.documentElement.dataset.theme=theme;document.documentElement.style.colorScheme=theme;var lang=null;try{lang=localStorage.getItem('yourfeed-language')}catch(e){}var nativeLang=navigator.language.toLowerCase();var locale=lang==='zh'||lang==='zh-TW'||lang==='en'||lang==='vi'?lang:/^zh/.test(nativeLang)?/(?:tw|hk|mo|hant)(?:-|$)/.test(nativeLang)?'zh-TW':'zh':/^vi/.test(nativeLang)?'vi':'en';document.documentElement.lang=locale==='zh'?'zh-CN':locale==='vi'?'vi-VN':locale})()`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return <html lang="zh-CN" suppressHydrationWarning><head><script dangerouslySetInnerHTML={{ __html: themeBootstrap }} /></head><body><I18nProvider>{children}</I18nProvider></body></html>;
}
