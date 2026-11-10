import type { Topic } from './types';

export type Language = 'zh' | 'en';
export type ProfilePreset = 'it-ai' | 'creator' | 'explorer';
export interface UserProfile {
  /** AI-personalization revision; interface-language-only edits do not increment it. */
  version: number;
  displayName: string;
  preset: ProfilePreset;
  language: Language;
  summaryLanguage: Language;
  timezone: string;
  goals: string[];
  topicWeights: Partial<Record<Topic, number>>;
}
export const TOPIC_LABELS: Record<Topic, {zh:string;en:string}> = {
  ai:{zh:'人工智能',en:'Artificial intelligence'},automation:{zh:'自动化',en:'Automation'},network:{zh:'网络基础',en:'Networking'},linux:{zh:'Linux',en:'Linux'},it:{zh:'IT 实践',en:'IT practice'},code:{zh:'编程',en:'Programming'},making:{zh:'动手制作',en:'Making'},cooking:{zh:'烹饪科学',en:'Food science'},science:{zh:'科学探索',en:'Science'},humanities:{zh:'人文历史',en:'Humanities'},english:{zh:'语言学习',en:'Languages'},tools:{zh:'实用工具',en:'Useful tools'},
};
export const PRESETS: Record<ProfilePreset, {name:{zh:string;en:string};description:{zh:string;en:string};goals:{zh:string[];en:string[]};topicWeights:Partial<Record<Topic,number>>}> = {
  'it-ai': {name:{zh:'IT 与 AI 实践',en:'IT & AI practice'},description:{zh:'关注系统、网络、自动化与 AI 的实际应用。',en:'Practical systems, networking, automation and AI.'},goals:{zh:['理解计算机、网络与系统基础','探索可验证的 AI 应用与自动化工作流'],en:['Understand computing, networking and systems fundamentals','Explore verifiable AI applications and automation workflows']},topicWeights:{ai:.8,automation:.9,network:1,linux:.9,it:1,code:.8,making:.4,cooking:.2,science:.5,humanities:.3,english:.5,tools:.8}},
  creator: {name:{zh:'开发者与创作者',en:'Developers & creators'},description:{zh:'关注代码、制作过程、创意工具与清晰表达。',en:'Code, the creative process, useful tools and clear communication.'},goals:{zh:['通过真实项目提升开发与制作能力','发现有用的创意工具与表达方法'],en:['Develop coding and making skills through real projects','Discover useful creative tools and communication methods']},topicWeights:{ai:.7,automation:.7,network:.3,linux:.3,it:.3,code:1,making:1,cooking:.3,science:.6,humanities:.7,english:.7,tools:1}},
  explorer: {name:{zh:'知识探索',en:'Knowledge explorer'},description:{zh:'在科学、人文、生活与技术之间保持好奇。',en:'Stay curious across science, humanities, everyday life and technology.'},goals:{zh:['理解有证据支持的科学与人文知识','发现值得深入阅读和动手尝试的新主题'],en:['Understand evidence-based science and humanities','Discover subjects worth reading deeply and trying first-hand']},topicWeights:{ai:.5,automation:.4,network:.4,linux:.4,it:.4,code:.5,making:.8,cooking:.8,science:1,humanities:1,english:.7,tools:.7}},
};
export function createProfile(preset:ProfilePreset='explorer',language:Language='zh'):UserProfile {
  return {version:1,displayName:'',preset,language,summaryLanguage:language,timezone:'Asia/Taipei',goals:[...PRESETS[preset].goals[language]],topicWeights:{...PRESETS[preset].topicWeights}};
}
export const defaultProfile: UserProfile = createProfile();
export function profileDate(value:Date,timezone:string):string {
  const parts=new Intl.DateTimeFormat('en-US',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(value);
  const values=Object.fromEntries(parts.map(part=>[part.type,part.value]));return `${values.year}-${values.month}-${values.day}`;
}
export function topicLabel(topic:Topic,language:Language='zh'):string {return TOPIC_LABELS[topic]?.[language]||topic;}
