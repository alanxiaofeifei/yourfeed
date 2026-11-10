import type { ContentItem, Feedback, Kind, Mode, Source, Topic } from '../shared/types';
import { topicLabel, TOPIC_LABELS, type UserProfile } from '../shared/profile';
const topics:Record<Mode,Partial<Record<Topic,number>>>={rest:{making:1,cooking:1,science:.85,humanities:.85,tools:.7,english:.5,it:.4,automation:.35,network:.3,linux:.3,ai:.25,code:.25},grow:{it:1,network:1,linux:1,code:.9,automation:.9,ai:.8,tools:.6,english:.6,science:.4,making:.3,cooking:.1,humanities:.2}};
const topicAliases:Record<Topic,string>={ai:'人工智能 大模型 智能体 AI 实践',automation:'自动化 工作流',network:'网络技术 网络基础 网络',linux:'Linux 系统基础',it:'现场 IT IT运维 现场运维',code:'编程 编程基础 计算机基础',making:'动手制作 动手 创意制作 维修',cooking:'烹饪科学 美食 烹饪',science:'科学探索 科学 科普 有趣科普',humanities:'人文历史 人文 历史',english:'英语 语言',tools:'实用工具 工具 效率 数码'};
const topicNames:Record<Topic,string>={ai:'AI 实践',automation:'自动化',network:'网络基础',linux:'Linux',it:'现场 IT',code:'编程基础',making:'动手制作',cooking:'烹饪科学',science:'有趣科普',humanities:'人文历史',english:'英语',tools:'实用工具'};
export function sourceGroup(item:ContentItem):string {
  if(item.kind==='project')return 'github:'+item.url.replace(/^https:\/\/github.com\//,'').split('/')[0];
  if(item.kind==='news'||item.kind==='article'||item.kind==='post'){
    try{return new URL(item.url).hostname.replace(/^www\./,'');}catch{return item.sourceId;}
  }
  return item.sourceId;
}
export function matchingProfileGoal(item:ContentItem,profile:UserProfile):string|undefined {
  const text=[item.title,item.summary,...item.topics].join(' ').toLowerCase();
  const stop=new Set(['learn','understand','explore','discover','improve','about','with','through','from','your','this','that','and','the']);
  return profile.goals.find(goal=>{
    const words=goal.toLowerCase().split(/[\s,，、;；:.!?。！？]+/).filter(word=>word.length>=3&&!stop.has(word));
    if(words.some(word=>text.includes(word)))return true;
    return item.topics.some(topic=>[topic,TOPIC_LABELS[topic].zh,TOPIC_LABELS[topic].en.toLowerCase(),...topicAliases[topic].toLowerCase().split(' ')].filter(Boolean).some(term=>/^[a-z]{1,3}$/.test(term)?new RegExp('(?:^|[^a-z])'+term+'(?:$|[^a-z])','i').test(goal):goal.toLowerCase().includes(term)));
  });
}
export function rankFeed(items:ContentItem[],sources:Source[],feedback:Record<string,Feedback>,mode:Mode,kind:string='all',filter:string='all',query:string='',profile?:UserProfile):ContentItem[] {
  const disabled=new Set(sources.filter(s=>(!s.enabled&&s.status!=='manual')||(s as Source&{blocked?:boolean}).blocked).map(s=>s.id));
  const githubDisabled=sources.some(s=>s.id==='github-stars'&&(!s.enabled||(s as Source&{blocked?:boolean}).blocked));
  const frequencies=new Map<string,number>();
  for(const item of items)frequencies.set(item.platform,(frequencies.get(item.platform)||0)+1);
  const affinity:Partial<Record<Topic,number>>={};
  for(const item of items){const f=feedback[item.id];if(!f)continue;const delta=(f.liked?1:0)+(f.saved?.4:0)-(f.dismissed?1.3:0);for(const topic of item.topics)affinity[topic]=(affinity[topic]||0)+delta/Math.max(1,item.topics.length);}
  const q=query.trim().toLocaleLowerCase();
  const enriched=items.map(item=>({...item,...feedback[item.id]})).filter(item=>!disabled.has(item.sourceId)&&!(githubDisabled&&item.platform.toLowerCase()==='github')&&!item.dismissed&&(kind==='all'||item.kind===kind)&&(filter==='saved'?item.saved:filter==='liked'?item.liked:filter==='read'?item.read:!item.read)&&(!q||[item.title,item.summary,item.sourceName,...item.topics,...item.topics.map(t=>topicAliases[t]),...item.topics.map(t=>TOPIC_LABELS[t].en)].join(' ').toLocaleLowerCase().includes(q)));
  const now=Date.now();
  return enriched.map(item=>{
    const weight=(topic:Topic)=>profile?(profile.topicWeights[topic]||0)*(mode==='rest'?(['making','cooking','science','humanities'].includes(topic)?1:.8):1):(topics[mode][topic]||0);
    const matches=[...item.topics].sort((a,b)=>weight(b)-weight(a));
    const interest=matches.slice(0,2).reduce((n,t)=>n+weight(t),0)/Math.min(2,Math.max(1,matches.length));
    const feedbackBoost=item.topics.reduce((n,t)=>n+Math.max(-1,Math.min(1,(affinity[t]||0)/3)),0)/Math.max(1,item.topics.length);
    const days=Math.max(0,(now-Date.parse(item.publishedAt))/86400000);
    const halfLife=item.kind==='news'?5:item.kind==='post'?10:item.kind==='project'?90:180;
    const fresh=Number.isFinite(days)?Math.exp(-days/halfLife):0;
    const platformBalance=1/Math.sqrt(Math.max(1,frequencies.get(item.platform)||1));
    const goal=profile?matchingProfileGoal(item,profile):undefined;
    const score=interest*7+feedbackBoost*3+(item.liked?8:0)+(item.saved?3:0)+fresh*(item.kind==='news'?2:1)+platformBalance+(goal?1.5:0);
    const english=profile?.language==='en';
    const ruleReason=english?(item.liked?'Content you liked':item.saved?'Saved for later':goal?`Matches your goal: ${goal}`:matches.length?`${mode==='rest'?'A change of pace: ':'Related to your interests: '}${matches.slice(0,2).map(t=>topicLabel(t,'en')).join(' · ')}`:'From a source you selected'):(item.liked?'你喜欢的内容':item.saved?'已加入稍后看':goal?`与你的目标相关：${goal}`:matches.length?`${mode==='rest'?'换个脑子，看看':'与你的进阶方向相关：'}${matches.slice(0,2).map(t=>profile?topicLabel(t,'zh'):topicNames[t]).join(' · ')}`:'来自你选择的内容来源');
    // Retained summaries are never translated merely because the UI locale changes.
    const useAnalysis=!profile||(profile.language===profile.summaryLanguage&&(english?!/[\u4e00-\u9fff]/.test(item.analysis?.relevance||''):true));
    const reason=(useAnalysis?item.analysis?.relevance:undefined)||ruleReason;
    return {item:{...item,reason},score};
  }).sort((a,b)=>b.score-a.score||a.item.id.localeCompare(b.item.id)).map(x=>x.item);
}
export function feedPage(ranked:ContentItem[],cursor:number) {
  let remaining=[...ranked];let page:ContentItem[]=[];let pageIndex=0;
  while(remaining.length){const counts=new Map<string,number>();const skipped:ContentItem[]=[];page=[];
    const mixed=new Set(remaining.map(i=>i.kind)).size>1;let projects=0;
    for(const item of remaining){const key=sourceGroup(item);if(page.length<20&&(counts.get(key)||0)<2&&(!mixed||item.kind!=='project'||projects<8)){page.push(item);counts.set(key,(counts.get(key)||0)+1);if(item.kind==='project')projects++;}else skipped.push(item);}
    if(page.length<20){for(let i=0;i<skipped.length&&page.length<20;){const item=skipped[i],key=sourceGroup(item);if((counts.get(key)||0)<2){page.push(item);counts.set(key,(counts.get(key)||0)+1);skipped.splice(i,1);}else i++;}}
    if(pageIndex===cursor)return {items:page,nextCursor:skipped.length?cursor+1:null};
    remaining=skipped;pageIndex++;
  }
  return {items:[],nextCursor:null};
}
