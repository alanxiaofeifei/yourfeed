'use client';

import './components/LanguageToggle.css';
import {createContext,useCallback,useContext,useEffect,useState,type ReactNode} from 'react';
import {LANGUAGE_OPTIONS,isLanguage,localeFromTag,localeTag,type Language} from '../shared/language';
import {translate,type Translate} from '../shared/locales';
export {LANGUAGE_OPTIONS,localeFromTag,localeTag,type Language,translate,type Translate};
interface I18n {language:Language;setLanguage:(language:Language)=>void;t:Translate;}
const storageKey='yourfeed-language';
const I18nContext=createContext<I18n>({language:'zh',setLanguage:()=>{},t:zh=>zh});
export function I18nProvider({children}:{children:ReactNode}) {
 const [language,updateLanguage]=useState<Language>('zh');
 const setLanguage=useCallback((value:Language)=>{if(!isLanguage(value))return;updateLanguage(value);document.documentElement.lang=localeTag(value);try{localStorage.setItem(storageKey,value);}catch{}},[]);
 useEffect(()=>{
  let saved:string|null=null;try{saved=localStorage.getItem(storageKey);}catch{}
  const value=isLanguage(saved)?saved:localeFromTag(navigator.language);updateLanguage(value);document.documentElement.lang=localeTag(value);
  const otherTab=(event:StorageEvent)=>{if(event.key===storageKey&&isLanguage(event.newValue)){updateLanguage(event.newValue);document.documentElement.lang=localeTag(event.newValue);}};
  window.addEventListener('storage',otherTab);return()=>window.removeEventListener('storage',otherTab);
 },[]);
 const t=useCallback<Translate>((zh,en)=>translate(zh,language,en),[language]);
 return <I18nContext.Provider value={{language,setLanguage,t}}>{children}</I18nContext.Provider>;
}
export const useI18n=()=>useContext(I18nContext);
/** A native select works with keyboard, touch, screen readers, and narrow login screens. */
export function LanguageToggle(){const {language,setLanguage,t}=useI18n();return <label className="language-toggle"><span aria-hidden="true">文 / A</span><select value={language} onChange={event=>setLanguage(event.target.value as Language)} aria-label={t('切换语言','Change language')} title={t('界面语言','Interface language')}>{LANGUAGE_OPTIONS.map(option=><option key={option.value} value={option.value} lang={localeTag(option.value)}>{option.label}</option>)}</select></label>;}
