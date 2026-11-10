'use client';

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';

export type Language = 'zh' | 'en';
export type Translate = (chinese: string, english?: string) => string;
interface I18n { language: Language; setLanguage: (language: Language) => void; t: Translate; }
const storageKey = 'yourfeed-language';
const messages: Record<string,string> = {
  'YourFeed 首页':'YourFeed home','我的偏好':'My profile','AI 与接口':'AI & APIs','部署与域名':'Deployment & domain','管理来源':'Manage sources','YouTube / B 站':'YouTube / Bilibili','RSS 与阅读':'RSS & reading','稍后看':'Save for later',
  '你的空间':'Your space','为你发现':'For you','稍后再看':'Watch later','我喜欢的':'Favorites','阅读足迹':'History','让内容跟随你':'Make it yours','内容来源':'Sources','偏好与 AI 设置':'Preferences & AI','我的空间':'My space','收藏链接':'Save a link','仅自己可见':'Only you can see this','你的私人空间':'Your private space','少一点噪声，':'A little less noise,','多一点自己的方向。':'a little more direction.',
  '留给下一次的好内容':'Good finds for your next break','那些让你停下来看的内容':'The things that caught your attention','好奇心走过的地方':'Where your curiosity has been','把时间，留给值得的内容。':'Make time for what matters.','让好奇，走向真正的能力。':'Turn curiosity into capability.','从一个有趣的视频、一篇好文章开始。享受这段属于你的时间。':'Start with a good video or a thoughtful read. This moment is yours.','从真实的问题出发，积累能带到下一阶段的知识与经验。':'Explore useful ideas and build knowledge that goes with you.','把有价值的发现留下来，随时回来接着看。':'Keep your good discoveries and come back whenever you like.',
  '休息一下':'Take a break','想学一点':'Learn something','正在更新':'Updating','更新内容':'Refresh','全部内容':'All content','视频':'Videos','长文阅读':'Articles','新闻':'News','帖子':'Posts','开源项目':'Open source','搜索内容':'Search content','在你的内容花园里搜索…':'Search your content garden…','清除搜索':'Clear search','今日的好奇心菜单':'A menu for your curiosity','值得投入的下一步':'Your next worthwhile step','你的个人片库':'Your library','按与你的关联推荐':'Selected for your interests','再发现一些好内容':'Discover a little more','好内容不必一次看完':'Good things can wait for another moment',
  '暂时没有找到匹配内容':'No matching content yet','给下次休息，留一点期待':'Save something for your next break','喜欢的内容会在这里相遇':'Your favorites will meet you here','你的阅读足迹从这里开始':'Your reading journey starts here','你的内容花园，正在生长':'Your content garden starts here','换个关键词，或者看看其他类型。':'Try another keyword or explore another type.','点击更新连接已启用的内容源，或先收藏一条你喜欢的链接。':'Add a source or save a link to start your own collection.','在内容卡片上保存、点赞或标记读过，即可在这里找到。':'Save, like, or mark an item as read to find it here.','更新我的内容库':'Refresh my library','去发现好内容':'Discover something good','重新加载':'Try again',
  '此刻，为自己':'A MOMENT FOR YOU','放松，也可以有收获。':'Rest can be rewarding.','一点一滴，变得更有底气。':'Build confidence, one idea at a time.','保留真实的兴趣，不急着把每一次好奇变成任务。':'Enjoy your interests. Every spark of curiosity need not become a task.','根据你的目标和内容偏好，挑选值得投入的下一步。':'Find your next worthwhile step through your own goals and preferences.','由你掌控的推荐':'Recommendations you control','你的兴趣雷达':'Your interest radar','让熟悉的兴趣，也遇见新可能。':'Familiar interests, unexpected possibilities.','来源于你的订阅、Stars 与反馈':'Shaped by your sources, stars, and feedback','好内容，从这里来':'Where good content comes from','视频发现':'A video discovery','橘鸦早报与阅读':'Newsletters & reading','资讯':'Reading','开源':'Open source','来源状态可在设置中查看':'Check source health in settings','管理':'Manage','你看过什么，':'What you discover','会慢慢变成你的一部分。':'becomes a little part of you.','按需更新 · 不打扰你的时间':'On-demand updates · at your pace','你的来源，你的节奏。':'Your sources. Your pace.','让好奇有所归处':'A home for your curiosity',
  '人工智能':'Artificial intelligence','自动化':'Automation','网络技术':'Networking','Linux':'Linux','现场 IT':'IT operations','编程基础':'Programming','动手制作':'Making','烹饪科学':'Food science','科学探索':'Science','人文历史':'Humanities','英语':'English','实用工具':'Useful tools',
  '今天':'Today','昨天':'Yesterday','已加入稍后看。':'Saved for later.','已从稍后看移除。':'Removed from saved items.','会减少这类推荐。':'We will recommend less like this.','AI 阅读已完成。':'AI reading is ready.','分析任务已提交。':'Analysis has been submitted.','已保存到你的内容库。':'Saved to your library.','内容库已更新。':'Your library is up to date.','已保存更新进度，下次打开可继续。':'Progress saved. Updates will resume when you return.','正在检查内容源…':'Checking your sources…','更新完成':'Up to date','操作未完成，请稍后重试。':'The action could not be completed. Please try again.','服务暂时没有响应，请稍后重试。':'The service is not responding. Please try again.','请使用你的 ChatGPT 账号打开这个私人空间。':'Sign in with ChatGPT to open your space.',
  '关闭导航':'Close navigation','打开导航':'Open navigation','关闭内容':'Close content','已保存':'Saved','已读过':'Read','标记读过':'Mark as read','标记未读':'Mark as unread','原始来源':'Original source','AI 阅读笔记':'AI reading notes','基于可读取正文':'Based on available text','基于原文摘要':'Based on source excerpt','基于标题与元数据':'Based on metadata','与你的关联':'Why it fits you','正在阅读与整理…':'Reading and organizing…','用 AI 帮我读一下':'Read with AI','提炼要点与个人关联':'Key points and personal relevance','项目介绍':'About the project','来源内容':'Source content','保留原始出处':'Original attribution preserved','到原始来源继续阅读':'Continue at the source','同一事件的其他来源':'More sources for this story','你喜欢这条内容':'You like this','喜欢这条内容':'Like this','屏蔽这个来源':'Block this source','取消喜欢':'Unlike','喜欢':'Like','取消稍后看':'Unsave','不感兴趣':'Not interested','打开内容':'Open item','AI 已读':'AI notes','打开原始来源，继续探索这条发现。':'Open the original source to explore this discovery.','来自你的 GitHub Stars':'From your GitHub stars','来自你选择的内容来源':'From a source you chose','平台播放器 · 若受地区或嵌入限制':'Platform player · if playback is restricted','到原平台观看':'Watch on the platform','此视频可在原平台观看':'Watch this video on its original platform',
  '关闭导入':'Close import','把一个好发现，留在这里。':'Keep a good find.','粘贴视频、文章、X 帖子或 GitHub 项目链接，整理进你的私人内容库。':'Save a video, article, X post, or GitHub project to your own collection.','内容链接':'Content URL','正在保存…':'Saving…','加入我的内容库':'Add to my library','收藏内容仅自己可见':'Your saved content stays in your space','关闭提示':'Dismiss notification',
};

export function translate(chinese:string, language:Language, english?:string):string {
  if(language==='zh')return chinese;
  if(english)return english;
  if(messages[chinese])return messages[chinese];
  const patterns:[RegExp,(match:RegExpMatchArray)=>string][]=[
    [/^(\d+) 天前$/,m=>`${m[1]} days ago`],[/^(\d+) 条发现$/,m=>`${m[1]} discoveries`],[/^(\d+) 个来源$/,m=>`${m[1]} sources`],
    [/^已检查 (\d+) 个来源 · 还有 (\d+) 个$/,m=>`Checked ${m[1]} sources · ${m[2]} remaining`],
    [/^AI 正在整理阅读笔记 · 已完成 (\d+) 条$/,m=>`AI reading · ${m[1]} notes ready`],
    [/^已为 (\d+) 条内容整理 AI 阅读笔记。$/,m=>`AI notes are ready for ${m[1]} items.`],
    [/^已屏蔽 (.+)，可在内容来源恢复。$/,m=>`Blocked ${m[1]}. Restore it in Sources.`],
    [/^观看 (.+)$/,m=>`Watch ${m[1]}`],[/^已连接 (\d+) 个来源$/,m=>`${m[1]} sources connected`],[/^(\d+) 个来源已连接$/,m=>`${m[1]} sources connected`],
    [/^上次更新 · (.+)$/,m=>`Last updated · ${translate(m[1],language)}`],[/^依据来源 (\d+)$/,m=>`Source ${m[1]}`],
  ];
  for(const [pattern,render] of patterns){const match=chinese.match(pattern);if(match)return render(match);}
  if(/[\u4e00-\u9fff]/.test(chinese)&&/请|未能|失败|无效|错误|不存在|不可|不足|上限|暂时/.test(chinese))return 'This action could not be completed. Check your settings and try again.';
  return chinese;
}

const I18nContext=createContext<I18n>({language:'zh',setLanguage:()=>{},t:(zh)=>zh});
export function I18nProvider({children}:{children:ReactNode}) {
  const [language,updateLanguage]=useState<Language>('zh');
  const setLanguage=useCallback((value:Language)=>{updateLanguage(value);document.documentElement.lang=value==='zh'?'zh-CN':'en';try{localStorage.setItem(storageKey,value);}catch{}},[]);
  useEffect(()=>{let saved:string|null=null;try{saved=localStorage.getItem(storageKey);}catch{};const value=saved==='zh'||saved==='en'?saved:navigator.language.toLowerCase().startsWith('zh')?'zh':'en';updateLanguage(value);document.documentElement.lang=value==='zh'?'zh-CN':'en';const otherTab=(event:StorageEvent)=>{if(event.key===storageKey&&(event.newValue==='zh'||event.newValue==='en')){updateLanguage(event.newValue);document.documentElement.lang=event.newValue==='zh'?'zh-CN':'en';}};window.addEventListener('storage',otherTab);return()=>window.removeEventListener('storage',otherTab);},[]);
  const t=useCallback<Translate>((zh,en)=>translate(zh,language,en),[language]);
  return <I18nContext.Provider value={{language,setLanguage,t}}>{children}</I18nContext.Provider>;
}
export const useI18n=()=>useContext(I18nContext);

export function LanguageToggle() {const {language,setLanguage,t}=useI18n();return <button type="button" className="language-toggle" onClick={()=>setLanguage(language==='zh'?'en':'zh')} aria-label={t('切换为英文','Switch to Chinese')} title={language==='zh'?'Switch to English':'切换为中文'}><span aria-hidden="true">文 / A</span><span>{language==='zh'?'EN':'中文'}</span></button>;}
