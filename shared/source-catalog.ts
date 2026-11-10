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
}

// RSS endpoints returned HTTP 200 and parsed as RSS/Atom on 2026-11-10.
// Practical Engineering's channel ID is linked by https://practical.engineering/.
// YouTube feed access itself is blocked by this execution environment; API access
// is tested separately once the owner supplies a YouTube Data API key.
export const sourceCatalog: SourceCatalogEntry[] = [
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
