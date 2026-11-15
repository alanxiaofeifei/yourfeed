import type {Language} from './language';
import type { Source, Topic } from './types';

/** Public starter suggestions. No subscriptions are enabled until the owner chooses one. */
export interface SourceCatalogEntry {
 id: string;
 name: string;
 localizedName?:Record<Language,string>;
 platform: Source['platform'];
 locator: string;
 topics: Topic[];
 language: 'zh' | 'en';
 contentType: 'news' | 'article' | 'video';
 description: Record<Language,string>;
 requiresApi?: 'youtube';
 starter?:boolean;
 verification:{status:'verified'|'needs-adapter'|'unverified';checkedAt?:string;format?:'RSS'|'Atom'|'RDF';items?:number;coverage:'metadata'|'excerpt'|'unknown';note?:Record<Language,string>};
}

// Per-entry validation below distinguishes inspected feeds from legacy suggestions.
// Practical Engineering's channel ID is linked by https://practical.engineering/.
// YouTube feed access itself is blocked by this execution environment; API access
// is tested separately once the owner supplies a YouTube Data API key.
const legacyCatalog: Omit<SourceCatalogEntry,'verification'>[] = [
 {
  id:'juya-daily', name:'橘鸦 AI 早报', platform:'rss', locator:'https://daily.juya.uk/rss.xml',
  topics:['ai','automation','tools'], language:'zh', contentType:'news',
  description:{zh:'中文 AI 早报，适合快速了解产品更新与行业消息；保留每期来源链接。',en:'A Chinese AI briefing for product updates and industry news, with links to its sources.','zh-TW':'中文 AI 早報，適合快速了解產品更新與產業消息；保留每期來源連結。',vi:'Bản tin AI tiếng Trung về sản phẩm và ngành công nghệ, kèm liên kết nguồn.'},
 },
 {
  id:'sspai', name:'少数派', platform:'rss', locator:'https://sspai.com/feed',
  topics:['tools','it','automation'], language:'zh', contentType:'article',
  description:{zh:'数字工具、工作方法与日常技术体验，从实用阅读开始。',en:'Practical articles about digital tools, ways of working and everyday technology.','zh-TW':'數位工具、工作方法與日常科技體驗，從實用閱讀開始。',vi:'Bài viết thực tế về công cụ số, cách làm việc và công nghệ hằng ngày.'},
 },
 {
  id:'ruanyifeng', name:'阮一峰的网络日志', platform:'rss', locator:'https://www.ruanyifeng.com/blog/atom.xml',
  topics:['code','tools','linux','humanities'], language:'zh', contentType:'article',
  description:{zh:'技术周刊与博客，连接编程工具、学习资料和科技观察。',en:'A technology newsletter and blog connecting programming tools, learning resources and observations.','zh-TW':'科技週刊與部落格，串連程式設計工具、學習資料和科技觀察。',vi:'Bản tin và blog công nghệ kết nối công cụ lập trình, tài liệu học tập và góc nhìn công nghệ.'},
 },
 {
  id:'github-blog', name:'GitHub Blog', platform:'rss', locator:'https://github.blog/feed/',
  topics:['code','tools','automation'], language:'en', contentType:'article',
  description:{zh:'GitHub 官方博客，关注开源、开发工具和软件实践。',en:'The official GitHub blog, covering open source, developer tools and software practice.','zh-TW':'GitHub 官方部落格，關注開源、開發工具和軟體實務。',vi:'Blog chính thức của GitHub về mã nguồn mở, công cụ phát triển và thực hành phần mềm.'},
 },
 {
  id:'google-research', name:'Google Research', platform:'rss', locator:'https://research.google/blog/rss/',
  topics:['ai','science'], language:'en', contentType:'news',
  description:{zh:'Google 官方研究动态，可直接查看研究团队对 AI 与科学进展的介绍。',en:'Official research updates from Google, with first-party explanations of advances in AI and science.','zh-TW':'Google 官方研究動態，可直接查看研究團隊對 AI 與科學進展的介紹。',vi:'Tin nghiên cứu chính thức từ Google, với giải thích trực tiếp về tiến bộ AI và khoa học.'},
 },
 {
  id:'nasa', name:'NASA', platform:'rss', locator:'https://www.nasa.gov/feed/',
  topics:['science'], language:'en', contentType:'news',
  description:{zh:'NASA 官方太空探索、任务与科学新闻，给好奇心换一个方向。',en:'Official NASA news about space exploration, missions and science for a different kind of curiosity.','zh-TW':'NASA 官方太空探索、任務與科學新聞，讓好奇心轉個方向。',vi:'Tin chính thức từ NASA về khám phá vũ trụ, sứ mệnh và khoa học để nuôi dưỡng trí tò mò.'},
 },
 {
  id:'bbc-science', name:'BBC Science & Environment', platform:'rss', locator:'https://feeds.bbci.co.uk/news/science_and_environment/rss.xml',
  topics:['science'], language:'en', contentType:'news',
  description:{zh:'面向普通读者的科学与环境新闻，适合了解研究如何影响生活。',en:'Science and environment reporting for general readers, connecting research with everyday life.','zh-TW':'面向一般讀者的科學與環境新聞，適合了解研究如何影響生活。',vi:'Tin khoa học và môi trường cho mọi độc giả, kết nối nghiên cứu với đời sống.'},
 },
 {
  id:'smithsonian', name:'Smithsonian Magazine', platform:'rss', locator:'https://www.smithsonianmag.com/rss/latest_articles/',
  topics:['humanities','science'], language:'en', contentType:'article',
  description:{zh:'历史、文化、自然和科学故事，兼顾轻松阅读与通识探索。',en:'Stories about history, culture, nature and science for a thoughtful reading break.','zh-TW':'歷史、文化、自然和科學故事，兼顧輕鬆閱讀與通識探索。',vi:'Chuyện lịch sử, văn hóa, thiên nhiên và khoa học cho giờ đọc thư giãn và khám phá.'},
 },
 {
  id:'king-arthur-baking', name:'King Arthur Baking', platform:'rss', locator:'https://www.kingarthurbaking.com/blog/feed',
  topics:['cooking','science','making'], language:'en', contentType:'article',
  description:{zh:'烘焙品牌官方博客，提供技巧、配方和食材原理，适合动手尝试。',en:'Baking techniques, recipes and ingredient explanations from the official King Arthur blog.','zh-TW':'烘焙品牌官方部落格，提供技巧、食譜和食材原理，適合動手嘗試。',vi:'Kỹ thuật làm bánh, công thức và giải thích nguyên liệu từ blog chính thức của King Arthur.'},
 },
 {
  id:'practical-engineering', name:'Practical Engineering', platform:'youtube', locator:'UCMOqf8ab-42UUQIdVoKwjlQ',
  topics:['making','science'], language:'en', contentType:'video', requiresApi:'youtube',
  description:{zh:'通过模型和实验解释工程与基础设施。自动更新需要配置 YouTube API Key。',en:'Models and experiments that explain engineering and infrastructure. Automatic updates need a YouTube API key.','zh-TW':'透過模型和實驗解釋工程與基礎設施。自動更新需要設定 YouTube API Key。',vi:'Mô hình và thí nghiệm giải thích kỹ thuật và cơ sở hạ tầng. Tự động cập nhật cần khóa API YouTube.'},
 },
];

const checkedAt='2026-11-10T16:25:00.000Z';
const checked:Record<string,{format:'RSS'|'Atom'|'RDF';items:number}>={
 'juya-daily':{format:'RSS',items:10},sspai:{format:'RSS',items:10},ruanyifeng:{format:'Atom',items:3},'github-blog':{format:'RSS',items:10},'google-research':{format:'RSS',items:100},nasa:{format:'RSS',items:10},'bbc-science':{format:'RSS',items:41},'king-arthur-baking':{format:'RSS',items:20},
};
const starters=new Set(['juya-daily','sspai','openai-news','google-research','github-blog','nasa','simon-willison','julia-evans']);
const additional: Array<{id:string;name:string;locator:string;topics:Topic[];language:'zh'|'en';format:'RSS'|'Atom'|'RDF';items:number;coverage?:'metadata'|'excerpt'|'unknown';needsAdapter?:boolean;zh:string;en:string;'zh-TW':string;vi:string}>=[
 {id:'atlas-obscura',name:'Atlas Obscura',locator:'https://www.atlasobscura.com/feeds/latest',topics:['humanities','science'],language:'en',format:'RSS',items:27,zh:'地方文化、历史与奇趣故事。',en:'Places, history and curious stories.','zh-TW':'地方文化、歷史與奇趣故事。',vi:'Vùng đất, lịch sử và những câu chuyện kỳ thú.'},
 {id:'sciencedaily-animals',name:'ScienceDaily Animals & Nature',locator:'https://www.sciencedaily.com/rss/plants_animals.xml',topics:['science','making'],language:'en',format:'RSS',items:60,zh:'动植物与自然研究新闻；并非猫狗专属频道。',en:'Animal and nature research news, not a dedicated cat or dog channel.','zh-TW':'動植物與自然研究新聞；並非貓狗專屬頻道。',vi:'Tin nghiên cứu động thực vật và thiên nhiên; không phải kênh riêng về chó mèo.'},
 {id:'gcores',name:'机核 GCORES',locator:'https://www.gcores.com/rss',topics:['humanities','making'],language:'zh',format:'RSS',items:20,zh:'游戏、文化与日常兴趣故事；并非宠物专属频道。',en:'Games, culture and everyday interests, not a dedicated pet feed.','zh-TW':'遊戲、文化與日常興趣故事；並非寵物專屬頻道。',vi:'Trò chơi, văn hóa và sở thích hằng ngày; không phải nguồn riêng về thú cưng.'},
 {id:'lifehacker',name:'Lifehacker',locator:'https://lifehacker.com/feed/rss',topics:['making','tools'],language:'en',format:'RSS',items:100,zh:'生活技巧、工具与动手实践。',en:'Everyday tips, tools and practical projects.','zh-TW':'生活技巧、工具與動手實作。',vi:'Mẹo đời sống, công cụ và dự án thực hành.'},
 {id:'bbc-world',name:'BBC World News',locator:'https://feeds.bbci.co.uk/news/world/rss.xml',topics:['humanities','english'],language:'en',format:'RSS',items:23,zh:'全球新闻与多元视角。',en:'World news and international perspectives.','zh-TW':'全球新聞與多元觀點。',vi:'Tin thế giới và góc nhìn quốc tế.'},

 {id:'openai-news',name:'OpenAI News',locator:'https://openai.com/news/rss.xml',topics:['ai','tools'],language:'en',format:'RSS',items:1375,zh:'OpenAI 官方更新；订阅通常提供摘要与来源链接。',en:'Official OpenAI updates, usually with excerpts and source links.','zh-TW':'OpenAI 官方更新；訂閱通常提供摘要與來源連結。',vi:'Cập nhật chính thức từ OpenAI, thường kèm trích đoạn và liên kết nguồn.'},
 {id:'deepmind',name:'Google DeepMind',locator:'https://deepmind.google/blog/rss.xml',topics:['ai','science'],language:'en',format:'RSS',items:100,zh:'DeepMind 官方研究与产品动态。',en:'Official research and product updates from DeepMind.','zh-TW':'DeepMind 官方研究與產品動態。',vi:'Cập nhật chính thức về nghiên cứu và sản phẩm từ DeepMind.'},
 {id:'huggingface',name:'Hugging Face Blog',locator:'https://huggingface.co/blog/feed.xml',topics:['ai','code'],language:'en',format:'RSS',items:901,coverage:'metadata',zh:'开源模型和工具；部分条目仅提供标题、日期和链接。',en:'Open models and tools. Some entries contain only a title, date, and link.','zh-TW':'開源模型和工具；部分條目僅提供標題、日期和連結。',vi:'Mô hình mở và công cụ. Một số mục chỉ có tiêu đề, ngày và liên kết.'},
 {id:'github-changelog',name:'GitHub Changelog',locator:'https://github.blog/changelog/feed/',topics:['code','tools'],language:'en',format:'RSS',items:10,zh:'GitHub 官方功能更新记录。',en:'Official GitHub feature announcements.','zh-TW':'GitHub 官方功能更新紀錄。',vi:'Thông báo tính năng chính thức của GitHub.'},
 {id:'cloudflare-blog',name:'Cloudflare Blog',locator:'https://blog.cloudflare.com/rss/',topics:['network','code','it'],language:'en',format:'RSS',items:20,zh:'网络、安全与开发平台的官方技术文章。',en:'First-party articles about networking, security, and developer platforms.','zh-TW':'網路、安全與開發平台的官方技術文章。',vi:'Bài viết chính thức về mạng, bảo mật và nền tảng phát triển.'},
 {id:'python-blog',name:'Python Blog',locator:'https://blog.python.org/feeds/posts/default',topics:['code'],language:'en',format:'RSS',items:50,zh:'Python 官方发布与社区动态；语言按样本判断。',en:'Official Python releases and community updates; language inferred from samples.','zh-TW':'Python 官方發布與社群動態；語言依樣本判斷。',vi:'Bản phát hành và tin cộng đồng Python chính thức; ngôn ngữ được suy ra từ mẫu.'},
 {id:'nature',name:'Nature',locator:'https://www.nature.com/nature.rss',topics:['science'],language:'en',format:'RDF',items:75,zh:'Nature 科学新闻与研究摘要；部分原文需要付费。',en:'Nature science news and research excerpts. Some original articles require a subscription.','zh-TW':'Nature 科學新聞與研究摘要；部分原文需要付費。',vi:'Tin khoa học và trích đoạn nghiên cứu từ Nature. Một số bài gốc cần đăng ký trả phí.'},
 {id:'arxiv-ai',name:'arXiv cs.AI',locator:'https://rss.arxiv.org/rss/cs.AI',topics:['ai','science'],language:'en',format:'RSS',items:887,needsAdapter:true,zh:'高频论文摘要，不是论文全文；大型订阅源需要有界增量适配。',en:'High-volume paper abstracts, not full papers. Large feeds need bounded incremental processing.','zh-TW':'高頻論文摘要，並非論文全文；大型訂閱源需要有界增量處理。',vi:'Tóm tắt bài nghiên cứu cập nhật thường xuyên, không phải toàn văn. Nguồn lớn cần xử lý tăng dần có giới hạn.'},
 {id:'ifanr',name:'爱范儿',locator:'https://www.ifanr.com/feed',topics:['tools','ai'],language:'zh',format:'RSS',items:20,zh:'爱范儿综合科技资讯，不是 APPSO 专属订阅源。',en:'General technology coverage from iFanr, not an APPSO-only feed.','zh-TW':'愛范兒綜合科技資訊，並非 APPSO 專屬訂閱源。',vi:'Tin công nghệ tổng hợp từ iFanr, không phải nguồn riêng của APPSO.'},
 {id:'simon-willison',name:'Simon Willison',locator:'https://simonwillison.net/atom/everything/',topics:['ai','code','tools'],language:'en',format:'Atom',items:30,zh:'独立开发者对 AI、数据与编程的实践记录。',en:'Independent practical notes about AI, data, and programming.','zh-TW':'獨立開發者對 AI、資料與程式設計的實作紀錄。',vi:'Ghi chép thực hành độc lập về AI, dữ liệu và lập trình.'},
 {id:'julia-evans',name:'Julia Evans',locator:'https://jvns.ca/atom.xml',topics:['linux','network','code'],language:'en',format:'Atom',items:20,zh:'清晰易懂的计算机基础和调试文章；语言按样本判断。',en:'Approachable computer fundamentals and debugging notes; language inferred from samples.','zh-TW':'淺顯易懂的電腦基礎和除錯文章；語言依樣本判斷。',vi:'Kiến thức máy tính cơ bản và ghi chép gỡ lỗi dễ hiểu; ngôn ngữ được suy ra từ mẫu.'},
 {id:'raschka',name:'Sebastian Raschka',locator:'https://magazine.sebastianraschka.com/feed',topics:['ai','science'],language:'en',format:'RSS',items:20,needsAdapter:true,zh:'机器学习研究文章；本次响应超过当前采集大小限制，暂需适配。',en:'Machine-learning research articles. The verified response exceeds the current fetch limit and needs adapter work.','zh-TW':'機器學習研究文章；本次回應超過目前擷取大小限制，暫需適配。',vi:'Bài viết nghiên cứu học máy. Phản hồi đã kiểm tra vượt giới hạn tải hiện tại và cần điều chỉnh bộ thu thập.'},
 {id:'yourfeed-releases',name:'YourFeed Releases',locator:'https://github.com/alanxiaofeifei/yourfeed/releases.atom',topics:['code','tools'],language:'en',format:'Atom',items:6,zh:'本项目正式版本更新，不会自动升级你的实例。',en:'Project releases. Subscribing does not automatically upgrade your instance.','zh-TW':'本專案正式版本更新，不會自動升級你的實例。',vi:'Bản phát hành của dự án. Đăng ký không tự động nâng cấp phiên bản của bạn.'},
 {id:'mit-tech-review',name:'MIT Technology Review',locator:'https://www.technologyreview.com/feed/',topics:['ai','science'],language:'en',format:'RSS',items:10,zh:'科技研究与社会影响；部分原文需要付费。',en:'Technology research and its social impact. Some original articles require a subscription.','zh-TW':'科技研究與社會影響；部分原文需要付費。',vi:'Nghiên cứu công nghệ và tác động xã hội. Một số bài gốc cần đăng ký trả phí.'},
];
/** Validation snapshots describe the feed response, never end-to-end app success. */
export const sourceCatalog:SourceCatalogEntry[]=[
 ...legacyCatalog.map(entry=>({...entry,starter:starters.has(entry.id),verification:{status:entry.id==='ruanyifeng'?'needs-adapter':checked[entry.id]?'verified':'unverified',...(checked[entry.id]?{checkedAt:entry.id==='king-arthur-baking'?'2026-11-14T18:15:00.000Z':checkedAt,...checked[entry.id]}:{}),coverage:'unknown',...(entry.id==='ruanyifeng'?{note:{zh:'Feed 有效，条目 HTTP 链接需要安全升级适配。',en:'The feed is valid, but HTTP entry links need a verified HTTPS upgrade.','zh-TW':'Feed 有效，條目 HTTP 連結需要經驗證的 HTTPS 升級適配。',vi:'Nguồn hợp lệ nhưng liên kết HTTP của bài viết cần được chuyển sang HTTPS sau khi xác minh.'}}:{})} as SourceCatalogEntry['verification']})),
 ...additional.map(entry=>({id:entry.id,name:entry.name,...(entry.id==='yourfeed-releases'?{localizedName:{zh:'YourFeed 版本更新','zh-TW':'YourFeed 版本更新',en:'YourFeed Releases',vi:'Bản phát hành YourFeed'}}:{}),platform:'rss' as const,locator:entry.locator,topics:entry.topics,language:entry.language,contentType:entry.id==='yourfeed-releases'?'news' as const:'article' as const,description:{zh:entry.zh,en:entry.en,'zh-TW':entry['zh-TW'],vi:entry.vi},starter:starters.has(entry.id),verification:{status:entry.needsAdapter?'needs-adapter' as const:'verified' as const,checkedAt:['atlas-obscura','sciencedaily-animals','gcores','lifehacker','bbc-world'].includes(entry.id)?'2026-11-14T18:15:00.000Z':checkedAt,format:entry.format,items:entry.items,coverage:entry.coverage??'unknown'}})),
];
