import type { Topic } from './types';

import type {Language} from './language';
export type {Language} from './language';
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
export const TOPIC_LABELS: Record<Topic, Record<Language,string>> = {
  ai:{zh:"人工智能",en:"Artificial intelligence",'zh-TW':"人工智慧",vi:"Trí tuệ nhân tạo"},automation:{zh:"自动化",en:"Automation",'zh-TW':"自動化",vi:"Tự động hóa"},network:{zh:"网络基础",en:"Networking",'zh-TW':"網路基礎",vi:"Mạng máy tính"},linux:{zh:"Linux",en:"Linux",'zh-TW':"Linux",vi:"Linux"},it:{zh:"IT 实践",en:"IT practice",'zh-TW':"IT 實踐",vi:"Thực hành CNTT"},code:{zh:"编程",en:"Programming",'zh-TW':"程式設計",vi:"Lập trình"},making:{zh:"动手制作",en:"Making",'zh-TW':"動手製作",vi:"Chế tác"},cooking:{zh:"烹饪科学",en:"Food science",'zh-TW':"烹飪科學",vi:"Khoa học ẩm thực"},science:{zh:"科学探索",en:"Science",'zh-TW':"科學探索",vi:"Khoa học"},humanities:{zh:"人文历史",en:"Humanities",'zh-TW':"人文歷史",vi:"Nhân văn và lịch sử"},english:{zh:"语言学习",en:"Languages",'zh-TW':"語言學習",vi:"Học ngoại ngữ"},tools:{zh:"实用工具",en:"Useful tools",'zh-TW':"實用工具",vi:"Công cụ hữu ích"},
};
export const PRESETS: Record<ProfilePreset, {name:Record<Language,string>;description:Record<Language,string>;goals:Record<Language,string[]>;topicWeights:Partial<Record<Topic,number>>}> = {
  'it-ai': {name:{zh:"IT 与 AI 实践",en:"IT & AI practice",'zh-TW':"IT 與 AI 實踐",vi:"Thực hành CNTT và AI"},description:{zh:"关注系统、网络、自动化与 AI 的实际应用。",en:"Practical systems, networking, automation and AI.",'zh-TW':"關注系統、網路、自動化與 AI 的實際應用。",vi:"Ứng dụng thực tế về hệ thống, mạng, tự động hóa và AI."},goals:{zh:["理解计算机、网络与系统基础", "探索可验证的 AI 应用与自动化工作流"],en:["Understand computing, networking and systems fundamentals", "Explore verifiable AI applications and automation workflows"],'zh-TW':["理解計算機、網路與系統基礎", "探索可驗證的 AI 應用與自動化工作流"],vi:["Hiểu nền tảng máy tính, mạng và hệ thống", "Khám phá ứng dụng AI có thể kiểm chứng và quy trình tự động hóa"]},topicWeights:{ai:.8,automation:.9,network:1,linux:.9,it:1,code:.8,making:.4,cooking:.2,science:.5,humanities:.3,english:.5,tools:.8}},
  creator: {name:{zh:"开发者与创作者",en:"Developers & creators",'zh-TW':"開發者與創作者",vi:"Lập trình viên và nhà sáng tạo"},description:{zh:"关注代码、制作过程、创意工具与清晰表达。",en:"Code, the creative process, useful tools and clear communication.",'zh-TW':"關注程式碼、製作過程、創意工具與清晰表達。",vi:"Lập trình, quy trình sáng tạo, công cụ hữu ích và giao tiếp rõ ràng."},goals:{zh:["通过真实项目提升开发与制作能力", "发现有用的创意工具与表达方法"],en:["Develop coding and making skills through real projects", "Discover useful creative tools and communication methods"],'zh-TW':["透過真實專案提升開發與製作能力", "發現有用的創意工具與表達方法"],vi:["Rèn kỹ năng lập trình và chế tác qua các dự án thực tế", "Khám phá công cụ sáng tạo và phương pháp giao tiếp hữu ích"]},topicWeights:{ai:.7,automation:.7,network:.3,linux:.3,it:.3,code:1,making:1,cooking:.3,science:.6,humanities:.7,english:.7,tools:1}},
  explorer: {name:{zh:"知识探索",en:"Knowledge explorer",'zh-TW':"知識探索",vi:"Khám phá tri thức"},description:{zh:"在科学、人文、生活与技术之间保持好奇。",en:"Stay curious across science, humanities, everyday life and technology.",'zh-TW':"在科學、人文、生活與技術之間保持好奇。",vi:"Giữ sự tò mò với khoa học, nhân văn, đời sống và công nghệ."},goals:{zh:["理解有证据支持的科学与人文知识", "发现值得深入阅读和动手尝试的新主题"],en:["Understand evidence-based science and humanities", "Discover subjects worth reading deeply and trying first-hand"],'zh-TW':["理解有證據支援的科學與人文知識", "發現值得深入閱讀和動手嘗試的新主題"],vi:["Hiểu khoa học và nhân văn dựa trên bằng chứng", "Khám phá chủ đề đáng đọc sâu và tự trải nghiệm"]},topicWeights:{ai:.5,automation:.4,network:.4,linux:.4,it:.4,code:.5,making:.8,cooking:.8,science:1,humanities:1,english:.7,tools:.7}},
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
