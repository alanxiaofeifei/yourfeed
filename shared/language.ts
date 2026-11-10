/** Interface and AI output locales supported by every deployment. zh is retained for existing profiles. */
export type Language = 'zh' | 'zh-TW' | 'en' | 'vi';
export const LANGUAGE_OPTIONS: ReadonlyArray<{value:Language;label:string}> = [
  {value:'zh',label:'简体中文'},
  {value:'zh-TW',label:'繁體中文（台灣）'},
  {value:'en',label:'English'},
  {value:'vi',label:'Tiếng Việt'},
];
export function isLanguage(value:unknown):value is Language{return typeof value==='string'&&LANGUAGE_OPTIONS.some(option=>option.value===value);}
export function localeTag(language:Language):string{return language==='zh'?'zh-CN':language==='vi'?'vi-VN':language;}
/** Resolve both browser language tags and Accept-Language lists; unsupported tags use the provided fallback. */
export function localeFromTag(value:string|null|undefined,fallback:Language='en'):Language{
  if(!value)return fallback;
  for(const entry of value.split(',')){
    if(/;\s*q=0(?:\.0*)?(?:\s*;|\s*$)/i.test(entry))continue;
    const part=entry.trim().split(';')[0].toLowerCase();
    if(/^zh(?:-|$)/.test(part))return /(?:tw|hk|mo|hant)(?:-|$)/.test(part)?'zh-TW':'zh';
    if(/^vi(?:-|$)/.test(part))return 'vi';
    if(/^en(?:-|$)/.test(part))return 'en';
  }
  return fallback;
}
export function languageName(language:Language):string{return ({zh:'Simplified Chinese','zh-TW':'Traditional Chinese (Taiwan)',en:'English',vi:'Vietnamese'} as const)[language];}
