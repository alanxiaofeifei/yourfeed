import type { Source, Topic } from './types';

/** Public starter suggestions. No subscriptions are enabled until the owner chooses one. */
export interface SourceCatalogEntry {
 id: string;
 name: string;
 platform: Source['platform'];
 locator: string;
 topics: Topic[];
 language: 'zh' | 'en';
 contentType: 'news' | 'article' | 'video';
 description: { zh: string; en: string };
 requiresApi?: 'youtube';
 starter?:boolean;
 verification:{status:'verified'|'needs-adapter'|'unverified';checkedAt?:string;format?:'RSS'|'Atom'|'RDF';items?:number;coverage:'metadata'|'excerpt'|'unknown';note?:{zh:string;en:string}};
}

// Per-entry validation below distinguishes inspected feeds from legacy suggestions.
// Practical Engineering's channel ID is linked by https://practical.engineering/.
// YouTube feed access itself is blocked by this execution environment; API access
// is tested separately once the owner supplies a YouTube Data API key.
const legacyCatalog: Omit<SourceCatalogEntry,'verification'>[] = [
 {
  id:'juya-daily', name:'橘鸦 AI 早报', platform:'rss', locator:'https://daily.juya.uk/rss.xml',
  topics:['ai','automation','tools'], language:'zh', contentType:'news',
  description:{zh:'中文 AI 早报，适合快速了解产品更新与行业消息；保留每期来源链接。',en:'A Chinese AI briefing for product updates and industry news, with links to its sources.'},
 },
 {
  id:'sspai', name:'少数派', platform:'rss', locator:'https://sspai.com/feed',
  topics:['tools','it','automation'], language:'zh', contentType:'article',
  description:{zh:'数字工具、工作方法与日常技术体验，从实用阅读开始。',en:'Practical articles about digital tools, ways of working and everyday technology.'},
 },
 {
  id:'ruanyifeng', name:'阮一峰的网络日志', platform:'rss', locator:'https://www.ruanyifeng.com/blog/atom.xml',
  topics:['code','tools','linux','humanities'], language:'zh', contentType:'article',
  description:{zh:'技术周刊与博客，连接编程工具、学习资料和科技观察。',en:'A technology newsletter and blog connecting programming tools, learning resources and observations.'},
 },
 {
  id:'github-blog', name:'GitHub Blog', platform:'rss', locator:'https://github.blog/feed/',
  topics:['code','tools','automation'], language:'en', contentType:'article',
  description:{zh:'GitHub 官方博客，关注开源、开发工具和软件实践。',en:'The official GitHub blog, covering open source, developer tools and software practice.'},
 },
 {
  id:'google-research', name:'Google Research', platform:'rss', locator:'https://research.google/blog/rss/',
  topics:['ai','science'], language:'en', contentType:'news',
  description:{zh:'Google 官方研究动态，可直接查看研究团队对 AI 与科学进展的介绍。',en:'Official research updates from Google, with first-party explanations of advances in AI and science.'},
 },
 {
  id:'nasa', name:'NASA', platform:'rss', locator:'https://www.nasa.gov/feed/',
  topics:['science'], language:'en', contentType:'news',
  description:{zh:'NASA 官方太空探索、任务与科学新闻，给好奇心换一个方向。',en:'Official NASA news about space exploration, missions and science for a different kind of curiosity.'},
 },
 {
  id:'bbc-science', name:'BBC Science & Environment', platform:'rss', locator:'https://feeds.bbci.co.uk/news/science_and_environment/rss.xml',
  topics:['science'], language:'en', contentType:'news',
  description:{zh:'面向普通读者的科学与环境新闻，适合了解研究如何影响生活。',en:'Science and environment reporting for general readers, connecting research with everyday life.'},
 },
 {
  id:'smithsonian', name:'Smithsonian Magazine', platform:'rss', locator:'https://www.smithsonianmag.com/rss/latest_articles/',
  topics:['humanities','science'], language:'en', contentType:'article',
  description:{zh:'历史、文化、自然和科学故事，兼顾轻松阅读与通识探索。',en:'Stories about history, culture, nature and science for a thoughtful reading break.'},
 },
 {
  id:'king-arthur-baking', name:'King Arthur Baking', platform:'rss', locator:'https://www.kingarthurbaking.com/blog/feed',
  topics:['cooking','science','making'], language:'en', contentType:'article',
  description:{zh:'烘焙品牌官方博客，提供技巧、配方和食材原理，适合动手尝试。',en:'Baking techniques, recipes and ingredient explanations from the official King Arthur blog.'},
 },
 {
  id:'practical-engineering', name:'Practical Engineering', platform:'youtube', locator:'UCMOqf8ab-42UUQIdVoKwjlQ',
  topics:['making','science'], language:'en', contentType:'video', requiresApi:'youtube',
  description:{zh:'通过模型和实验解释工程与基础设施。自动更新需要配置 YouTube API Key。',en:'Models and experiments that explain engineering and infrastructure. Automatic updates need a YouTube API key.'},
 },
];

const checkedAt='2026-11-10T16:25:00.000Z';
const checked:Record<string,{format:'RSS'|'Atom'|'RDF';items:number}>={
 'juya-daily':{format:'RSS',items:10},sspai:{format:'RSS',items:10},ruanyifeng:{format:'Atom',items:3},'github-blog':{format:'RSS',items:10},'google-research':{format:'RSS',items:100},nasa:{format:'RSS',items:10},'bbc-science':{format:'RSS',items:41},
};
const starters=new Set(['juya-daily','sspai','openai-news','google-research','github-blog','nasa','simon-willison','julia-evans']);
const additional: Array<{id:string;name:string;locator:string;topics:Topic[];language:'zh'|'en';format:'RSS'|'Atom'|'RDF';items:number;coverage?:'metadata'|'excerpt'|'unknown';needsAdapter?:boolean;zh:string;en:string}>=[
 {id:'openai-news',name:'OpenAI News',locator:'https://openai.com/news/rss.xml',topics:['ai','tools'],language:'en',format:'RSS',items:1375,zh:'OpenAI 官方更新；订阅通常提供摘要与来源链接。',en:'Official OpenAI updates, usually with excerpts and source links.'},
 {id:'deepmind',name:'Google DeepMind',locator:'https://deepmind.google/blog/rss.xml',topics:['ai','science'],language:'en',format:'RSS',items:100,zh:'DeepMind 官方研究与产品动态。',en:'Official research and product updates from DeepMind.'},
 {id:'huggingface',name:'Hugging Face Blog',locator:'https://huggingface.co/blog/feed.xml',topics:['ai','code'],language:'en',format:'RSS',items:901,coverage:'metadata',zh:'开源模型和工具；部分条目仅提供标题、日期和链接。',en:'Open models and tools. Some entries contain only a title, date, and link.'},
 {id:'github-changelog',name:'GitHub Changelog',locator:'https://github.blog/changelog/feed/',topics:['code','tools'],language:'en',format:'RSS',items:10,zh:'GitHub 官方功能更新记录。',en:'Official GitHub feature announcements.'},
 {id:'cloudflare-blog',name:'Cloudflare Blog',locator:'https://blog.cloudflare.com/rss/',topics:['network','code','it'],language:'en',format:'RSS',items:20,zh:'网络、安全与开发平台的官方技术文章。',en:'First-party articles about networking, security, and developer platforms.'},
 {id:'python-blog',name:'Python Blog',locator:'https://blog.python.org/feeds/posts/default',topics:['code'],language:'en',format:'RSS',items:50,zh:'Python 官方发布与社区动态；语言按样本判断。',en:'Official Python releases and community updates; language inferred from samples.'},
 {id:'nature',name:'Nature',locator:'https://www.nature.com/nature.rss',topics:['science'],language:'en',format:'RDF',items:75,zh:'Nature 科学新闻与研究摘要；部分原文需要付费。',en:'Nature science news and research excerpts. Some original articles require a subscription.'},
 {id:'arxiv-ai',name:'arXiv cs.AI',locator:'https://rss.arxiv.org/rss/cs.AI',topics:['ai','science'],language:'en',format:'RSS',items:887,needsAdapter:true,zh:'高频论文摘要，不是论文全文；大型订阅源需要有界增量适配。',en:'High-volume paper abstracts, not full papers. Large feeds need bounded incremental processing.'},
 {id:'ifanr',name:'爱范儿',locator:'https://www.ifanr.com/feed',topics:['tools','ai'],language:'zh',format:'RSS',items:20,zh:'爱范儿综合科技资讯，不是 APPSO 专属订阅源。',en:'General technology coverage from iFanr, not an APPSO-only feed.'},
 {id:'simon-willison',name:'Simon Willison',locator:'https://simonwillison.net/atom/everything/',topics:['ai','code','tools'],language:'en',format:'Atom',items:30,zh:'独立开发者对 AI、数据与编程的实践记录。',en:'Independent practical notes about AI, data, and programming.'},
 {id:'julia-evans',name:'Julia Evans',locator:'https://jvns.ca/atom.xml',topics:['linux','network','code'],language:'en',format:'Atom',items:20,zh:'清晰易懂的计算机基础和调试文章；语言按样本判断。',en:'Approachable computer fundamentals and debugging notes; language inferred from samples.'},
 {id:'raschka',name:'Sebastian Raschka',locator:'https://magazine.sebastianraschka.com/feed',topics:['ai','science'],language:'en',format:'RSS',items:20,needsAdapter:true,zh:'机器学习研究文章；本次响应超过当前采集大小限制，暂需适配。',en:'Machine-learning research articles. The verified response exceeds the current fetch limit and needs adapter work.'},
 {id:'yourfeed-releases',name:'YourFeed Releases',locator:'https://github.com/alanxiaofeifei/yourfeed/releases.atom',topics:['code','tools'],language:'en',format:'Atom',items:6,zh:'本项目正式版本更新，不会自动升级你的实例。',en:'Project releases. Subscribing does not automatically upgrade your instance.'},
 {id:'mit-tech-review',name:'MIT Technology Review',locator:'https://www.technologyreview.com/feed/',topics:['ai','science'],language:'en',format:'RSS',items:10,zh:'科技研究与社会影响；部分原文需要付费。',en:'Technology research and its social impact. Some original articles require a subscription.'},
];
/** Validation snapshots describe the feed response, never end-to-end app success. */
export const sourceCatalog:SourceCatalogEntry[]=[
 ...legacyCatalog.map(entry=>({...entry,starter:starters.has(entry.id),verification:{status:entry.id==='ruanyifeng'?'needs-adapter':checked[entry.id]?'verified':'unverified',...(checked[entry.id]?{checkedAt,...checked[entry.id]}:{}),coverage:'unknown',...(entry.id==='ruanyifeng'?{note:{zh:'Feed 有效，条目 HTTP 链接需要安全升级适配。',en:'The feed is valid, but HTTP entry links need a verified HTTPS upgrade.'}}:{})} as SourceCatalogEntry['verification']})),
 ...additional.map(entry=>({id:entry.id,name:entry.name,platform:'rss' as const,locator:entry.locator,topics:entry.topics,language:entry.language,contentType:entry.id==='yourfeed-releases'?'news' as const:'article' as const,description:{zh:entry.zh,en:entry.en},starter:starters.has(entry.id),verification:{status:entry.needsAdapter?'needs-adapter' as const:'verified' as const,checkedAt,format:entry.format,items:entry.items,coverage:entry.coverage??'unknown'}})),
];
