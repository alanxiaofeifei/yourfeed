import {describe,it,expect} from 'vitest';
import {createElement,type ComponentType} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {I18nProvider} from '../app/i18n';
import {settingsMessages} from '../shared/settings-messages';
import {settingStatus,searchSettings,settingsSearchIndex} from '../shared/settings-search-index';
import {LANGUAGE_OPTIONS} from '../shared/language';
import SettingsSaveBar from '../app/components/SettingsSaveBar';
import AiSettings from '../app/components/AiSettings';
import StorageSettings from '../app/components/StorageSettings';
import {SidebarPrivacyNote} from '../app/components/Sidebar';
const noop=()=>{};
const config={provider:'openai' as const,model:'synthetic-model',enabled:false,monthlyBudget:20,dailyLimit:20,freeAiAvailable:true,usingFreeAi:true};
const usage={month:'2026-11',cost:0,inputTokens:0,outputTokens:0,analyzedToday:0};
const render=<P extends object>(value:ComponentType<P>,props:P,language:'zh'|'en'|'zh-TW'|'vi')=>renderToStaticMarkup(createElement(I18nProvider,{initialLanguage:language,children:createElement(value,props)}));
describe('settings experience evidence and four-language presentation',()=>{
 it('E1 never promotes defaults, failed loads or dirty drafts to saved',()=>{
  expect(settingStatus(undefined,false)).toBe('loading');expect(settingStatus(false,true,true)).toBe('unavailable');expect(settingStatus(true,false)).toBe('notConfigured');expect(settingStatus(true,true)).toBe('saved');expect(settingStatus(true,true,true)).toBe('unsaved');
 });
 for(const {value:language} of LANGUAGE_OPTIONS){const m=settingsMessages[language];
  it(`E2 common save states and disabled unmodified form in ${language}`,()=>{
   for(const status of ['saved','unsaved','saving','error'] as const){const html=render(SettingsSaveBar,{status,onSave:noop,disabled:status==='saved'||status==='saving'},language);expect(html).toContain(m[status]);expect(html).toContain('aria-live="polite"');if(status==='saved'||status==='saving')expect(html).toContain('disabled=""');}
  });
  it(`initial save feedback never calls an unconfigured or unavailable profile saved in ${language}`,()=>{for(const initialStatus of ['notConfigured','unavailable'] as const){const html=render(SettingsSaveBar,{status:'saved' as const,onSave:noop,disabled:true,initialStatus},language);expect(html).toContain(m[initialStatus]);expect(html).not.toContain('>'+m.saved+'<');}});
  it(`E3/E4/E5 basic AI, bounded test/cost explanation and source return in ${language}`,()=>{
   const html=render(AiSettings,{settings:config,onChange:noop,usage,notify:noop,reload:async()=>{},onOpenSources:noop,returningToSources:true},language);
   expect(html).toContain('id="ai-model"');expect(html).toContain('id="ai-key"');expect(html).toContain('<details class="ai-advanced">');expect(html).not.toContain('<details class="ai-advanced" open');expect(html).toContain(m.cost);expect(html).toContain(m.test);expect(html).toContain(m.returnSources);expect(html).toContain(m.youtubeHelp);
  });
  it(`E6 separates device cache, retention and portable archives in ${language}`,()=>{
   const html=render(StorageSettings,{userId:'synthetic-reader'},language);for(const text of [m.device,m.server,m.archive,m.deviceNo,m.serverYes,m.archiveNo,m.archiveRestore])expect(html).toContain(text);expect(html).not.toMatch(/已备份|Backed up/);
  });
  it(`E7 static search locates time zone, budget, YouTube and storage in ${language}`,()=>{
   for(const item of settingsSearchIndex)expect(searchSettings(item.labels[language].split(' ')[0],language).some(match=>match.id===item.id)).toBe(true);
   expect(searchSettings('nonexistent-synthetic-key-123',language)).toEqual([]);expect(searchSettings('',language)).toEqual([]);expect(searchSettings('AI',language).some(item=>item.tab==='domain'||item.id==='daily-limit')).toBe(false);
  });
  it(`privacy line has no second account control in ${language}`,()=>{const html=render(SidebarPrivacyNote,{},language);expect(html).toContain(m.privacy);expect(html).not.toMatch(/<button|<a\b|端到端|end-to-end|管理员/);});
 }
});
