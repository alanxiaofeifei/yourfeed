import {describe,it,expect} from 'vitest';
import {readFileSync,readdirSync,statSync} from 'node:fs';
import {join} from 'node:path';
import ts from 'typescript';
import {LANGUAGE_OPTIONS,isLanguage,localeFromTag,localeTag,languageName,type Language} from '../shared/language';
import {interfaceMessages,translate} from '../shared/locales';
import {createProfile,PRESETS,TOPIC_LABELS,topicLabel} from '../shared/profile';
import {buildSystemPrompt} from '../server/ai';

function interfaceLiterals():Set<string>{
 const result=new Set<string>();
 function visitFolder(folder:string){for(const name of readdirSync(folder)){const file=join(folder,name);if(statSync(file).isDirectory()){if(name!=='locales')visitFolder(file);continue;}if(!/\.tsx?$/.test(name))continue;
  const source=ts.createSourceFile(file,readFileSync(file,'utf8'),ts.ScriptTarget.Latest,true);
  function visit(node:ts.Node){
   if(ts.isCallExpression(node)&&ts.isIdentifier(node.expression)&&node.expression.text==='t'&&node.arguments[0]&&ts.isStringLiteralLike(node.arguments[0]))result.add(node.arguments[0].text);
   if(ts.isArrayLiteralExpression(node)&&node.elements.length===2&&node.elements.every(ts.isStringLiteralLike)){const [zh,en]=node.elements.map(value=>(value as ts.StringLiteralLike).text);if(/[\u3400-\u9fff]/.test(zh)&&!/[\u3400-\u9fff]/.test(en))result.add(zh);}
   ts.forEachChild(node,visit);
  }visit(source);
 }}visitFolder(join(process.cwd(),'app'));visitFolder(join(process.cwd(),'shared'));return result;
}

describe('four interface locales',()=>{
 it('offers unambiguous native names and preserves legacy zh profiles',()=>{
  expect(LANGUAGE_OPTIONS.map(value=>value.value)).toEqual(['zh','zh-TW','en','vi']);
  expect(LANGUAGE_OPTIONS.find(value=>value.value==='zh-TW')?.label).toBe('繁體中文（台灣）');
  expect(isLanguage('zh')).toBe(true);expect(isLanguage('zh-TW')).toBe(true);expect(isLanguage('vi')).toBe(true);expect(isLanguage('fr')).toBe(false);
  expect(createProfile().language).toBe('zh');
 });
 it.each([['zh-TW','zh-TW'],['zh-Hant-HK','zh-TW'],['zh-Hant','zh-TW'],['zh-CN','zh'],['zh-Hans','zh'],['vi-VN','vi'],['vi','vi'],['en-US','en'],['fr-CA, vi;q=0.8','vi'],['zh;q=0,vi-VN;q=0.8','vi']])('resolves %s into %s',(tag,wanted)=>expect(localeFromTag(tag)).toBe(wanted));
 it('uses full browser/HTML tags and safe fallbacks',()=>{
  expect(localeTag('zh')).toBe('zh-CN');expect(localeTag('zh-TW')).toBe('zh-TW');expect(localeTag('vi')).toBe('vi-VN');
  expect(localeFromTag(undefined,'zh')).toBe('zh');expect(localeFromTag('fr-FR','vi')).toBe('vi');
 });
 it('contains every static interface literal and diagnostic tuple in each translation',()=>{
  const missing:string[]=[];
  for(const key of interfaceLiterals())for(const [locale,messages] of Object.entries(interfaceMessages))if(!messages[key])missing.push(`${locale}: ${key}`);
  expect(missing).toEqual([]);
 });
 it('keeps dictionary keys aligned and Vietnamese values free of untranslated Chinese UI',()=>{
  const keys=Object.keys(interfaceMessages.en).sort();
  expect(Object.keys(interfaceMessages['zh-TW']).sort()).toEqual(keys);
  expect(Object.keys(interfaceMessages.vi).sort()).toEqual(keys);
  expect(Object.values(interfaceMessages.vi).filter(value=>/[\u3400-\u9fff]/.test(value))).toEqual([]);
 });
 it('translates runtime counters while preserving embedded original titles',()=>{
  expect(translate('7 条发现','vi')).toBe('7 nội dung');
  expect(translate('已检查 3 个来源 · 还有 12 个','zh-TW')).toBe('已檢查 3 個來源 · 還有 12 個');
  expect(translate('观看 原始标题','vi')).toBe('Xem 原始标题');
  expect(translate('已添加 2 个来源，跳过 1 个重复，0 个未完成。','en')).toBe('Added 2 sources, skipped 1 duplicates, 0 not added.');
 });
 it('uses Taiwan terminology and a localized safe error instead of leaking unknown server diagnostics',()=>{
  expect(translate('人工智能','zh-TW')).toBe('人工智慧');
  expect(translate('网络基础','zh-TW')).toBe('網路基礎');
  expect(translate('未能读取临时服务。','vi')).toBe(interfaceMessages.vi['未能完成此操作，请检查设置后重试。']);
  expect(translate('未能读取临时服务。','zh-TW')).toBe(interfaceMessages['zh-TW']['未能完成此操作，请检查设置后重试。']);
 });
 it.each(LANGUAGE_OPTIONS.map(option=>[option.value] as [Language]))('provides %s preset/topic labels and exact AI output language',(language)=>{
  for(const preset of Object.keys(PRESETS) as Array<keyof typeof PRESETS>){const profile=createProfile(preset,language);expect(profile.language).toBe(language);expect(profile.goals.length).toBeGreaterThan(0);expect(PRESETS[preset].name[language]).toBeTruthy();}
  for(const topic of Object.keys(TOPIC_LABELS) as Array<keyof typeof TOPIC_LABELS>)expect(topicLabel(topic,language)).toBeTruthy();
  expect(buildSystemPrompt(createProfile('explorer',language))).toContain(languageName(language));
 });
});
