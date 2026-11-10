import './globals.css';
import { branding } from '../data/branding';
import type { ReactNode } from 'react';
import { I18nProvider } from './i18n';

export const metadata = { title: branding.title, description: branding.description };

const themeBootstrap = `(function(){var saved=null;try{saved=localStorage.getItem(${JSON.stringify(branding.themeStorageKey)})}catch(e){}var theme=saved==='light'||saved==='dark'?saved:window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';document.documentElement.dataset.theme=theme;document.documentElement.style.colorScheme=theme;var lang=null;try{lang=localStorage.getItem('yourfeed-language')}catch(e){}document.documentElement.lang=(lang==='zh'||lang==='en'?lang:navigator.language.toLowerCase().startsWith('zh')?'zh':'en')==='zh'?'zh-CN':'en'})()`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return <html lang="zh-CN" suppressHydrationWarning><head><script dangerouslySetInnerHTML={{ __html: themeBootstrap }} /></head><body><I18nProvider>{children}</I18nProvider></body></html>;
}
