import type { ContentItem, Feedback, Source } from '../shared/types';
import { rankFeed, sourceGroup, matchingProfileGoal } from './ranking';
import { groupNews } from './dedup';
import { profileDate, topicLabel, type UserProfile } from '../shared/profile';

export interface Briefing {date:string;timeZone:string;window:'today'|'recent'|'empty';items:{item:ContentItem;reason:string;signal:string}[];lastUpdated?:string;}
const DAY=86400000;
const AI=/人工智能|大模型|智能体|语言模型|多模态模型|生成式|生图模型|\b(?:AI|LLM|GPT|RAG|MCP|Agent|OpenAI|Anthropic|Claude|Gemini|DeepSeek|GLM|Qwen|Llama|Fable|Mythos|Copilot|Seedream|Token\s*Plan)\b/i;
const CHANGE=/发布|推出|上线|开放|开源|更新|现可|现已|新增|支持|调整|变更|降价|涨价|降至|升至|上调|下调|下线|弃用|停用|漏洞|修复|泄露|\b(?:launch|release|introduc\w*|available|update\w*|deprecat\w*|breach|vulnerabilit\w*|fix\w*)\b/i;
const MODEL=/模型|\b(?:LLM|GPT(?:-[\d.]+)?|Claude|Gemini|DeepSeek|GLM|Qwen|Llama|Fable|Mythos)\b/i;
const RELEASE=/发布|推出|上线|开放|开源|可用|\b(?:launch|release|introduc\w*|available|open.source)\b/i;
const PRACTICAL=/企业|部署|内网|本地|自托管|自动化|工作流|跨设备|多台电脑|电脑操作|工具调用|服务台|知识库|运维|服务器|网络|\b(?:enterprise|deploy\w*|self.host\w*|local|workflow|automat\w*|Agent|MCP|API|RAG|Linux|Docker|IT)\b/i;
const PROMO=/限时|优惠码|返利|抽奖|赠送|促销|限量福利|订阅.*重置|\b(?:coupon|giveaway|promo|cashback)\b/i;
const GOSSIP=/出轨|绯闻|婚外情|恋情|私生活|八卦|豪宅|富豪榜|\b(?:adultery|celebrity|gossip|affair)\b/i;
const HYPE=/一夜斩杀|炸裂|惊呆|封神|史诗级|世界第一|震惊|颠覆一切|\b(?:mind.blowing|shocking|unbelievable)\b/i;
const COSMETIC=/界面|布局|配色|隐藏终端|外观|主题切换|主题皮肤|\b(?:UI layout|interface layout|theme|cosmetic|hide terminal)\b/i;
const DIGEST=/早报|日报|周报|简报|今日资讯|新闻汇总|要闻汇总|\b(?:daily digest|newsletter|news roundup|weekly roundup)\b/i;
const PRIMARY=['openai.com','anthropic.com','deepseek.com','bigmodel.cn','z.ai','blog.google','deepmind.google','ai.google.dev','developers.google.com','developers.googleblog.com','microsoft.com','cloudflare.com'];
export function taipeiDate(value:Date):string {return new Date(value.getTime()+8*3600000).toISOString().slice(0,10);}
function timestamp(value:string):number {
  const parts=value.match(/^(\d{4})-(\d{2})-(\d{2})(?:T|$)/);
  if(parts){const year=Number(parts[1]),month=Number(parts[2]),day=Number(parts[3]);if(month<1||month>12||day<1||day>new Date(Date.UTC(year,month,0)).getUTCDate())return NaN;}
  return Date.parse(value);
}
function primary(item:ContentItem):boolean {try{const host=new URL(item.url).hostname.toLowerCase();return PRIMARY.some(root=>host===root||host.endsWith('.'+root));}catch{return false;}}
function discrete(item:ContentItem,profile?:UserProfile):boolean {
  if(item.kind==='video'||item.kind==='project')return false;
  if(DIGEST.test(item.title))return false;
  try{if(new URL(item.url).hostname==='daily.juya.uk'&&/^\/issues\//.test(new URL(item.url).pathname))return false;}catch{return false;}
  if(item.kind==='news')return true;
  // Imported posts/articles need an explicit event in the headline, not a generic tutorial or reading list.
  return profile?(CHANGE.test(item.title)||/发现|研究|成果|考古|\b(?:discover\w*|research|finding\w*)\b/i.test(item.title)):CHANGE.test(item.title)&&AI.test(item.title+' '+item.summary);
}
interface Importance {score:number;signal:string;reason:string;}
function importance(item:ContentItem,profile?:UserProfile):Importance|null {
  if(!discrete(item,profile))return null;
  const text=item.title+' '+item.summary;
  if((!profile&&!AI.test(text))||GOSSIP.test(text)||PROMO.test(item.title))return null;
  const matched=profile?[...item.topics].sort((a,b)=>(profile.topicWeights[b]||0)-(profile.topicWeights[a]||0)):[];
  const goal=profile?matchingProfileGoal(item,profile):undefined;
  const interest=profile?(matched.slice(0,2).reduce((sum,topic)=>sum+(profile.topicWeights[topic]||0),0)/Math.max(1,Math.min(2,matched.length))):0;
  if(profile&&interest<=0&&!goal)return null;
  const modelAnnouncement=MODEL.test(item.title)&&RELEASE.test(item.title)&&!/模型(?:选择|列表|设置|界面)|\b(?:model picker|model selector|models menu)\b/i.test(item.title);
  const headlineModel=MODEL.test(item.title)&&RELEASE.test(item.title)&&!/模型(?:选择|列表|设置|界面)|\b(?:model picker|model selector|models menu)\b/i.test(item.title);
  const headlineSecurity=/漏洞|泄露|越权|安全|权限控制|审批|叫停|中止|\b(?:security|breach|permission|approval|halt)\b/i.test(item.title);
  const headlineCost=/API|接口|token/i.test(item.title)&&/价格|定价|计费|降价|涨价|费用|配额|限额|\b(?:pricing|price|billing|quota)\b/i.test(item.title);
  if(COSMETIC.test(item.title)&&!headlineModel&&!headlineSecurity&&!headlineCost)return null;
  let score=0,signal='',reason='';
  if(/漏洞|泄露|越权|权限|安全事件|安全修复|数据外泄|审批|叫停|中止|\b(?:vulnerabilit\w*|breach|permission|security fix)\b/i.test(text)&&(CHANGE.test(text)||/叫停|中止|审批|权限控制/.test(text))){
    score=15;signal='安全与权限';reason='标题与摘要提到 AI 安全或权限变化，可关注其访问控制、数据边界及适用条件。';
  }else if(modelAnnouncement){
    score=16;signal='模型发布';reason='这条涉及模型发布或开放使用，可核对具体能力、可用性与适用条件。';
  }else if(PRACTICAL.test(text)&&CHANGE.test(text)&&/部署|企业|自托管|本地|自动化|工作流|工具调用|知识库|\b(?:deploy\w*|enterprise|self.host\w*|local|workflow|automat\w*|tool.call\w*|Agent|MCP|RAG)\b/i.test(text)){
    score=12;signal='部署与工作流';reason='这条报道涉及企业 AI 与 IT 自动化中的部署、工具调用或工作流变化，可核对具体能力与适用条件。';
  }else if(/API|接口|计费|token|配额/i.test(text)&&/价格|定价|计费|降价|涨价|费用|配额|限额|\b(?:pricing|price|billing|quota|rate.limit)\b/i.test(text)&&CHANGE.test(text)){
    score=11;signal='API 与成本';reason='这条涉及 API 价格、计费或配额变化，可能影响模型服务的使用成本。';
  }else if(/隐私|数据保留|服务条款|使用条款|数据驻留|\b(?:privacy|retention|policy|terms|data residency)\b/i.test(text)&&CHANGE.test(text)){
    score=10;signal='官方规则变化';reason='这条涉及 AI 服务的数据或使用规则变化，可核对数据处理边界与使用条件。';
  }else if(/API|接口|模型|\b(?:Agent|MCP|Copilot|Claude|Gemini|OpenAI)\b/i.test(text)&&/支持|开放|下线|弃用|停用|配额|可用|访问|\b(?:available|access|support|deprecat\w*|retir\w*)\b/i.test(text)&&CHANGE.test(text)){
    score=9;signal='可用性变化';reason='这条涉及 AI 服务或接口的可用性变化，可核对支持范围与现有集成的兼容性。';
  }else if(profile){
    score=10;signal=matched.some(topic=>topic==='science'||topic==='humanities')?'科学与知识':matched.some(topic=>topic==='making'||topic==='code')?'创作与开发':'主题更新';
  }else return null;
  if(!profile&&PRACTICAL.test(text))score+=3;
  if(!profile&&/IT|运维|网络|Linux|Windows|服务器|服务台|知识库|\b(?:Docker|PowerShell)\b/i.test(text))score+=2;
  if(primary(item))score+=2;
  if(item.liked)score+=2;
  if(item.saved)score+=1;
  if(HYPE.test(item.title))score-=3;
  if(profile){
    score+=interest*8+(goal?3:0);
    const labels=matched.filter(topic=>(profile.topicWeights[topic]||0)>0).slice(0,2).map(topic=>topicLabel(topic,profile.language)).join(' · ');
    reason=profile.language==='en'?(goal?`This update relates to your goal: ${goal}`:`This update concerns ${labels||'a subject you follow'}. Consider how the reported changes affect your interests.`):(goal?`这条更新与你设置的目标相关：${goal}`:`这条涉及你关注的${labels||'主题'}，可留意报道中的变化对这些兴趣的影响。`);
    if(profile.language==='en')signal=({'安全与权限':'Security & access','模型发布':'Model release','部署与工作流':'Deployment & workflows','API 与成本':'API & costs','官方规则变化':'Policy changes','可用性变化':'Availability','科学与知识':'Science & knowledge','创作与开发':'Creating & development','主题更新':'Topic update'} as Record<string,string>)[signal]||'Topic update';
  }
  return {score,signal,reason};
}
export function selectBriefing(allItems:ContentItem[],sources:Source[],feedback:Record<string,Feedback>,now=new Date(),lastUpdated?:string,profile?:UserProfile):Briefing {
  const timeZone=profile?.timezone||'Asia/Taipei';const date=profileDate(now,timeZone);const base:Briefing={date,timeZone,window:'empty',items:[],...(lastUpdated?{lastUpdated}:{})};
  const nowMs=now.getTime();
  const visible=rankFeed(allItems,sources,feedback,'grow','all','all','',profile);
  const eligible=visible.filter(item=>{const at=timestamp(item.publishedAt);return Number.isFinite(at)&&at<=nowMs&&at>=nowMs-7*DAY;});
  const grouped=groupNews(eligible,allItems);
  const scored=grouped.map(item=>({item,importance:importance(item,profile),at:timestamp(item.publishedAt)})).filter((row):row is {item:ContentItem;importance:Importance;at:number}=>!!row.importance);
  const today=scored.filter(row=>profileDate(new Date(row.at),timeZone)===date);const candidates=today.length?today:scored;
  if(!candidates.length)return base;
  const pool=[...candidates];const chosen:typeof candidates=[];const publishers=new Map<string,number>();const signals=new Map<string,number>();
  while(pool.length&&chosen.length<3){
    pool.sort((a,b)=>{const score=(row:typeof a)=>row.importance.score-(signals.get(row.importance.signal)||0)*3-(publishers.get(sourceGroup(row.item))||0)*2;return score(b)-score(a)||b.at-a.at||a.item.id.localeCompare(b.item.id);});
    const row=pool.shift()!,publisher=sourceGroup(row.item);if((publishers.get(publisher)||0)>=2)continue;
    chosen.push(row);publishers.set(publisher,(publishers.get(publisher)||0)+1);signals.set(row.importance.signal,(signals.get(row.importance.signal)||0)+1);
  }
  return {...base,window:today.length?'today':'recent',items:chosen.map(({item,importance})=>({item,reason:importance.reason,signal:importance.signal}))};
}
