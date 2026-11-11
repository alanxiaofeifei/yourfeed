# Source evidence and upstream comparison / 信息源证据与项目比较

## Verification scope

Public source responses below were checked **2026-11-10 16:23–16:25 UTC** by parsing RSS/Atom/RDF/JSON entries, links and dates. This is a dated evidence snapshot, not an uptime guarantee, a full-text license, or an end-to-end test in this application. No source is subscribed automatically.

| Official / author endpoint | Format / observed entries | Language | Qualification |
|---|---|---|---|
| https://openai.com/news/rss.xml | RSS / 1375 | en | Valid; usually excerpts. |
| https://deepmind.google/blog/rss.xml | RSS / 100 | en | Valid. |
| https://research.google/blog/rss/ | RSS / 100 | en | Valid. |
| https://huggingface.co/blog/feed.xml | RSS / 901 | en | Valid; first item metadata only. |
| https://github.blog/feed/ | RSS / 10 | en | Valid. |
| https://github.blog/changelog/feed/ | RSS / 10 | en | Valid. |
| https://blog.cloudflare.com/rss/ | RSS / 20 | en | Valid. |
| https://blog.python.org/feeds/posts/default | RSS / 50 | en, sampled | Valid despite nonstandard MIME. |
| https://www.nasa.gov/feed/ | RSS / 10 | en | Valid. |
| https://www.nature.com/nature.rss | RDF / 75 | en | Uses `dc:date`; some articles paywalled. |
| https://rss.arxiv.org/rss/cs.AI | RSS / 887 | en | Abstracts, not paper full text; about 1.93 MB. |
| https://feeds.bbci.co.uk/news/science_and_environment/rss.xml | RSS / 41 | en | Valid. |
| https://daily.juya.uk/rss.xml | RSS / 10 | zh-CN | Retain whole issue and related individual stories. |
| https://sspai.com/feed | RSS / 10 | zh-CN | Valid. |
| https://www.ruanyifeng.com/blog/atom.xml | Atom / 3 | zh, sampled | Some item URLs use HTTP; HTTPS upgrade must be verified. |
| https://www.ifanr.com/feed | RSS / 20 | zh-Hans | General iFanr, not an APPSO-only feed. |
| https://simonwillison.net/atom/everything/ | Atom / 30 | en | Valid. |
| https://jvns.ca/atom.xml | Atom / 20 | en, sampled | Low frequency is not a failure. |
| https://magazine.sebastianraschka.com/feed | RSS / 20 | en, sampled | About 2.59 MB; can exceed bounded fetch limits. |
| https://github.com/alanxiaofeifei/yourfeed/releases.atom | Atom / 6 | en | Valid. |
| https://www.technologyreview.com/feed/ | RSS / 10 | en | Some article bodies require subscription. |

Rejected candidates: `https://www.anthropic.com/rss.xml` returned 404; `https://www.ifanr.com/app/feed` redirected to HTML. Do not label either as a verified feed. A valid source can still exceed this application's resource limits; report the actual failure rather than silently claiming success.

中文：验证 XML、条目和链接，不只看 HTTP 200。语言未声明时只能写“按样本判断”。Feed 有效不代表含全文、原文免费、当前适配器可处理或未来永远可用。

## Platform access boundaries

| Platform | Preferred path | Current boundary |
|---|---|---|
| WeChat public accounts | Author feed or manually shared URL | Official API is for owned/authorized accounts, not arbitrary followed-account reading. Third-party bridges are experimental; WeWe RSS was archived at review. |
| Xiaohongshu | Manually shared URL | Current basic account OAuth does not imply arbitrary note access. Bridges may require login/browser automation and can fail. |
| Reddit | Original links / user-provided text | Official RSS sunset is **2026-11-13**. New public API applications closed 2026-10-31; do not build a new `.rss` integration. |
| Quora | Original link / user-provided text | No current general reading API/RSS verified; a legacy profile RSS endpoint returned 404. |
| Bluesky | Public author RSS, then public AppView API | RSS and cursor API verified; keep DID as stable identity. |
| Mastodon | Account/tag RSS, optional per-instance API | Native RSS verified; anonymous API policy and limits vary by instance. |
| YouTube | Official Data API and player | Private subscriptions need user OAuth; arbitrary transcript access is not guaranteed. Feed fetching was blocked by the investigation environment, so it was not verified. |
| GitHub | REST Stars/Releases, public release Atom | Anonymous/authorized quotas and secondary limits apply; don't share token-bearing private feeds. |
| Bilibili | Best-effort public metadata, original link | Not a guaranteed official arbitrary-author update API. |
| X | Curated links / supplied interest signals | Paid platform API is not a default free dependency. |

Bridge notices must name the provider, login requirements, data sent to it and failure risk. Do not bypass CAPTCHAs, login/paywalls or access controls; do not share cookies or rotate proxies to evade restrictions.

Primary references: [Reddit changelog](https://support.reddithelp.com/hc/en-us/articles/54353370049684-Changelog-October-8-2026), [Xiaohongshu scopes](https://openaccount.xiaohongshu.com/docs/scope), [Bluesky API](https://bsky.network/docs/bluesky-api/request-proxying/), [Mastodon RSS](https://docs.joinmastodon.org/user/network/#syndication-feeds), [YouTube quota](https://developers.google.com/youtube/data/determine_quota_cost), [YouTube policies](https://developers.google.com/youtube/terms/developer-policies), [GitHub API limits](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api).

## Mature projects: capability and license boundary

| Project | Useful reference | License checked 2026-11-10 | Reuse policy |
|---|---|---|---|
| [Miniflux](https://miniflux.app/features.html) | Conditional fetch, OPML, diagnostics, extraction, PostgreSQL search | Apache-2.0 | Small reviewed code may be reused with license, copyright and applicable NOTICE retained. |
| [FreshRSS](https://github.com/FreshRSS/FreshRSS) | Discovery, import/export, advanced search, WebSub | AGPL-3.0 | Independently implement requirements or use standard protocols to a separate service. |
| [RSSHub](https://github.com/DIYgod/RSSHub) | Feed route ecosystem and discovery | Current branch AGPL-3.0 | Do not assume historical MIT; no current route-code copying into the MIT core. |
| [RSS-Bridge](https://github.com/RSS-Bridge/rss-bridge) | Optional small-site adapters and filters | Unlicense | Review individual files/dependencies; separate feed service preferred. |
| [Folo](https://github.com/RSSNext/Folo) | Discovery and multi-format AI reading UX | AGPL-3.0-only; additional icon restriction | No copied components/icons. Full independent backend self-hosting was not verified. |
| [TrendRadar](https://github.com/sansan0/TrendRadar) | Low-noise digests, keyword monitoring, notifications | GPL-3.0 | No copied modules in MIT core; its notification accounts are not isolated tenants. |
| [Wallabag](https://github.com/wallabag/wallabag) | Read-later text preservation and export | MIT | Preserve copyright/license if reusing reviewed code. |
| [linkding](https://github.com/sissbruecker/linkding) | Bookmark API, tags and import/export | MIT | Preserve copyright/license if reusing reviewed code. |

These projects showed active code maintenance at review, but their architectures and external dependencies differ. Most multi-user readers share an application/database, which does not meet this installation's independent runtime requirement. No project is installed or substituted here. Protocol interoperability does not remove the operator's obligations for separately deployed software or upstream content.

中文：YourFeed 核心保持 MIT。优先独立实现、连接标准 RSS/Atom/API，不复制 AGPL/GPL 代码。Apache/MIT 小块引用仍需保留原声明。开源不代表其所有数据来源、AI、邮件或服务永久免费。


## Current query and maintenance bounds

Candidate source version: public package **0.4.0**, private consumer planned **1.6.0**. These labels do not indicate a deployed release.

History and ID lookup are database-backed. Search terms with at least three characters use the full-history index. One- or two-character terms use a bounded recent-1,000-item search and the UI explicitly warns about that scope; do not advertise short-term search as full-history coverage. Search-index backfill proceeds five rows per authenticated maintenance batch, alongside at most five eligible 90-day body cleanups. Pending indexing is resumable rather than a one-shot production migration. Its completeness must be checked before claiming every historical body is searchable.

中文：至少 3 个字符的搜索走完整历史索引，1–2 字符关键词只查最近 1,000 条并明确提示。每次维护最多回填 5 条搜索索引、清理 5 条符合 90 天到期条件的普通正文。索引回填可续跑，不能在完成前宣称所有旧正文已经可搜。候选源码版本不是已部署版本。
