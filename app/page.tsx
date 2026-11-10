'use client';
import { branding } from '../data/branding';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowUpRight, ArrowRight, Bookmark, BookOpen, Check, CheckCheck, ChevronDown, ChevronRight, Clock3, Code2, Compass, ExternalLink, Eye, EyeOff, FileText, GitFork, Globe2, GraduationCap, Heart, History, House, KeyRound, Leaf, Link2, Loader2, Menu, MessageSquare, Newspaper, Plus, RefreshCw, Rss, Search, Settings2, ShieldCheck, SlidersHorizontal, Sparkles, Shuffle, Trash2, Video, X, Zap } from 'lucide-react';
import ThemeToggle from './components/ThemeToggle';
import AccountMenu from './components/AccountMenu';
import SettingsPanel, { type Settings } from './components/AiSettings';
import DailyBriefing from './components/DailyBriefing';
import { useI18n, LanguageToggle, localeTag, translate, type Language } from './i18n';
import ProfileSettings, { ProfileOnboarding } from './components/ProfileSettings';
import SourceSettings from './components/SourceSettings';
import DeploymentSettings from './components/DeploymentSettings';
import ContentActions from './components/ContentActions';
import { createProfile, type UserProfile } from '../shared/profile';
import type { ContentItem, Feedback, FeedResponse, Kind, Mode, Provider, ProviderConfig, Source, Topic, Usage } from '../shared/types';
type View = 'feed' | 'saved' | 'liked' | 'read' | 'sources' | 'settings';
type FeedPage=FeedResponse&{nextCursor?:number|null;exhausted?:boolean;seed?:string;asOf?:string};
type RotationContext={scope:string;seed:string;excludeIds:string[];asOf?:string};
function rememberFeedIds(previous:string[],next:string[]){const added=[...new Set(next)];const ids=new Set(added);return [...previous.filter(id=>!ids.has(id)),...added].slice(-200);}
const kinds: {
    id: 'all' | Kind;
    label: string;
    icon: typeof Video;
}[] = [{ id: 'all', label: '全部内容', icon: Compass }, { id: 'video', label: '视频', icon: Video }, { id: 'article', label: '长文阅读', icon: FileText }, { id: 'news', label: '新闻', icon: Newspaper }, { id: 'post', label: '帖子', icon: MessageSquare }, { id: 'project', label: '开源项目', icon: Code2 }];
const topicNames: Record<Topic, string> = { ai: '人工智能', automation: '自动化', network: '网络技术', linux: 'Linux', it: '现场 IT', code: '编程基础', making: '动手制作', cooking: '烹饪科学', science: '科学探索', humanities: '人文历史', english: '英语', tools: '实用工具' };
const defaultSettings: Settings = { provider: 'openai', model: 'gpt-6.1-sol', enabled: false, monthlyBudget: 20, dailyLimit: 20 };
async function api<T = any>(path: string, options?: RequestInit): Promise<T> {
    const response = await fetch(path, { ...options, headers: { 'Content-Type': 'application/json', 'Accept-Language':typeof document!=='undefined'?document.documentElement.lang:'zh-CN', ...options?.headers } });
    let data: any;
    try {
        data = await response.json();
    }
    catch {
        throw new Error('服务暂时没有响应，请稍后重试。');
    }
    if (!response.ok)
        throw new Error(response.status === 401 ? '请使用你的 ChatGPT 账号打开这个私人空间。' : (typeof data.error === 'string' ? data.error : data.error?.message) || data.message || '操作未完成，请稍后重试。');
    return data;
}
const post = (body: unknown): RequestInit => ({ method: 'POST', body: JSON.stringify(body) });
function duration(seconds?: number) { if (!seconds)
    return ''; const mins = Math.floor(seconds / 60); return `${mins}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`; }
function timeAgo(value: string, language: Language = 'zh') { const date = new Date(value); if (!Number.isFinite(+date))
    return ''; const days = Math.floor((Date.now() - +date) / 86400000); return days < 0 ? date.toLocaleDateString(localeTag(language)) : days === 0 ? translate('今天', language) : days === 1 ? translate('昨天', language) : days < 30 ? translate(`${days} 天前`, language) : date.toLocaleDateString(localeTag(language), { month: 'short', day: 'numeric' }); }
function textBody(body?: string) { if (!body)
    return ''; return body.replace(/<\/p>|<\/h[1-6]>|<br\s*\/?>|<\/li>/gi, '\n\n').replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'").replace(/&quot;/g, '"').trim(); }
function platformId(value: string) { const id = value.toLowerCase(); return id === '哔哩哔哩' || id === 'b站' || id === 'b 站' ? 'bilibili' : id; }
function SourceMark({ platform }: {
    platform: string;
}) { platform = platformId(platform); return <span className={`source-mark ${platform.toLowerCase()}`}>{platform.toLowerCase() === 'youtube' ? <Video size={11}/> : platform.toLowerCase() === 'bilibili' ? <Video size={11}/> : platform.toLowerCase() === 'github' ? <GitFork size={11}/> : platform.toLowerCase() === 'x' ? <X size={11}/> : <Rss size={11}/>}</span>; }
export default function Home() {
    const { language, t } = useI18n();
    const [profile, setProfile] = useState<UserProfile>(() => createProfile('explorer', 'zh'));
    const [settingsTab, setSettingsTab] = useState<'profile' | 'ai' | 'domain'>('profile');
    const [sourceImportText, setSourceImportText] = useState('');
    const [sourceChatText, setSourceChatText] = useState('');
    const [briefingRevision, setBriefingRevision] = useState(0);
    const [view, setView] = useState<View>('feed');
    const [mode, setMode] = useState<Mode>('rest');
    const [kind, setKind] = useState<'all' | Kind>('all');
    const [query, setQuery] = useState('');
    const [search, setSearch] = useState('');
    const [items, setItems] = useState<ContentItem[]>([]);
    const [total, setTotal] = useState(0);
    const [cursor, setCursor] = useState<number | null>(null);
    const [loading, setLoading] = useState(true);
    const [loadingMore, setLoadingMore] = useState(false);
    const [shuffling,setShuffling]=useState(false);
    const [error, setError] = useState('');
    const [sources, setSources] = useState<Source[]>([]);
    const [lastUpdated, setLastUpdated] = useState<string>();
    const [selected, setSelected] = useState<ContentItem | null>(null);
    const [settings, setSettings] = useState<Settings>(defaultSettings);
    const [usage, setUsage] = useState<Usage>({ month: '', cost: 0, inputTokens: 0, outputTokens: 0, analyzedToday: 0 });
    const [syncing, setSyncing] = useState(false);
    const [syncText, setSyncText] = useState('');
    const [toast, setToast] = useState('');
    const [importing, setImporting] = useState(false);
    const [importUrl, setImportUrl] = useState('');
    const [importBusy, setImportBusy] = useState(false);
    const [analysisProgress, setAnalysisProgress] = useState('');
    const [mobileNav, setMobileNav] = useState(false);
    const [analyzing, setAnalyzing] = useState<string | null>(null);
    const [sourceQuery, setSourceQuery] = useState('');
    const autoAnalyze = useRef(false);
    const autoSync = useRef(false);
    const active = useRef(true);
    const latestRequest = useRef(0);
    const feedAbort=useRef<AbortController|null>(null);
    const feedBusy=useRef(false);
    const rotation=useRef<RotationContext|null>(null);
    const recentShown=useRef<{scope:string;ids:string[]}>({scope:'',ids:[]});
    const skipAutomaticFeedWork=useRef(false);
    const feedScope=JSON.stringify([view,mode,kind,search,language]);
    const currentFeedScope=useRef(feedScope);currentFeedScope.current=feedScope;
    const notify = useCallback((value: string) => setToast(value), []);
    useEffect(() => {
        const url = new URL(window.location.href);
        const result = url.searchParams.get('notebook');
        if (result !== 'connected' && result !== 'failed') return;
        notify(result === 'connected' ? t('Notebook 已连接，重新打开内容的分享菜单即可添加来源。', 'Notebook connected. Reopen an item’s Share menu to add its source.') : t('Notebook 连接未完成，请检查配置后重试。', 'Notebook connection was not completed. Check the configuration and try again.'));
        url.searchParams.delete('notebook');
        window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash);
    }, [notify, t]);
    useEffect(() => { active.current = true; return () => { active.current = false;feedAbort.current?.abort();latestRequest.current++; }; }, []);
    useEffect(() => { if (!toast)
        return; const id = setTimeout(() => setToast(''), 5000); return () => clearTimeout(id); }, [toast]);
    useEffect(() => { const id = setTimeout(() => setSearch(query), 250); return () => clearTimeout(id); }, [query]);
    const loadSidebar = useCallback(async () => { const result = await Promise.allSettled([api<{
            sources: Source[];
        }>('/api/sources'), api<Settings>('/api/settings'), api<Usage>('/api/usage'), api<UserProfile>('/api/profile')]); if (!active.current)
        return; setBriefingRevision(value => value + 1); if (result[0].status === 'fulfilled')
        setSources(result[0].value.sources || []); if (result[1].status === 'fulfilled')
        setSettings(result[1].value); if (result[2].status === 'fulfilled')
        setUsage(result[2].value); if (result[3].status === 'fulfilled')
        setProfile(result[3].value); }, []);
    const loadFeed = useCallback(async (append = false) => {
        if(append&&feedBusy.current)return;
        const requestId=++latestRequest.current;
        feedAbort.current?.abort();const controller=new AbortController();feedAbort.current=controller;feedBusy.current=true;
        if(!append)setShuffling(false);
        append?setLoadingMore(true):setLoading(true);setError('');
        try{
            const filter=view==='saved'||view==='liked'||view==='read'?view:'all';
            const offset=append?(cursor||0):0;
            const context=view==='feed'&&rotation.current?.scope===feedScope?rotation.current:null;
            const data=context
                ?await api<FeedPage>('/api/feed/batch',{...post({mode,type:kind,filter:'all',q:search.slice(0,200),cursor:offset,seed:context.seed,excludeIds:context.excludeIds,...(context.asOf?{asOf:context.asOf}:{})}),signal:controller.signal})
                :await api<FeedPage>(`/api/feed?mode=${mode}&type=${kind}&filter=${filter}&cursor=${offset}&q=${encodeURIComponent(search)}`,{signal:controller.signal});
            if(!active.current||requestId!==latestRequest.current||feedScope!==currentFeedScope.current)return;
            setItems(previous=>append?[...previous,...data.items.filter(item=>!previous.some(old=>old.id===item.id))]:data.items);
            recentShown.current={scope:feedScope,ids:rememberFeedIds(recentShown.current.scope===feedScope?recentShown.current.ids:[],data.items.map(item=>item.id))};
            setTotal(data.total);setCursor(data.nextCursor??null);setLastUpdated(data.lastUpdated);
            if(context&&data.asOf)rotation.current={...context,asOf:data.asOf};
        }catch(cause){if(active.current&&requestId===latestRequest.current&&feedScope===currentFeedScope.current&&!controller.signal.aborted)setError((cause as Error).message);}
        finally{if(active.current&&requestId===latestRequest.current){feedBusy.current=false;setLoading(false);setLoadingMore(false);setShuffling(false);}}
    },[view,mode,kind,search,cursor,language,feedScope]);
    const feedLoader=useRef(loadFeed);feedLoader.current=loadFeed;
    useEffect(()=>{
        latestRequest.current++;feedAbort.current?.abort();feedBusy.current=false;rotation.current=null;recentShown.current={scope:feedScope,ids:[]};skipAutomaticFeedWork.current=false;setShuffling(false);setLoadingMore(false);
        if(view==='sources'||view==='settings'){setLoading(false);return;}
        void feedLoader.current(false);
    },[feedScope]);
    const shuffleFeed=async()=>{
        if(view!=='feed'||feedBusy.current||loading||loadingMore||syncing)return;
        feedBusy.current=true;skipAutomaticFeedWork.current=true;setShuffling(true);
        const requestId=++latestRequest.current;feedAbort.current?.abort();const controller=new AbortController();feedAbort.current=controller;
        const excludeIds=rememberFeedIds(recentShown.current.scope===feedScope?recentShown.current.ids:[],items.map(item=>item.id));
        try{
            const context:RotationContext={scope:feedScope,seed:crypto.randomUUID(),excludeIds};
            const data=await api<FeedPage>('/api/feed/batch',{...post({mode,type:kind,filter:'all',q:search.slice(0,200),cursor:0,seed:context.seed,excludeIds}),signal:controller.signal});
            if(!active.current||requestId!==latestRequest.current||feedScope!==currentFeedScope.current)return;
            const excluded=new Set(excludeIds);const next=data.items.filter(item=>!excluded.has(item.id));
            if(!next.length){notify(t('暂时没有不同的内容了。可以更新来源，或换个筛选再试。','No different items are available right now. Update sources or try another filter.'));return;}
            rotation.current={...context,seed:data.seed||context.seed,asOf:data.asOf};
            recentShown.current={scope:feedScope,ids:rememberFeedIds(excludeIds,next.map(item=>item.id))};
            setItems(next);setTotal(data.total);setCursor(data.nextCursor??null);setLastUpdated(data.lastUpdated);setError('');
        }catch(cause){if(active.current&&requestId===latestRequest.current&&feedScope===currentFeedScope.current&&!controller.signal.aborted)notify(t('暂时未能换一批，当前内容已保留，请稍后重试。','The next batch could not be loaded. Your current items are retained; try again later.'));}
        finally{if(active.current&&requestId===latestRequest.current){feedBusy.current=false;setShuffling(false);}}
    };
    useEffect(() => { void loadSidebar(); }, [loadSidebar]);
    const refresh = useCallback(async (force = true) => { if (syncing)
        return; rotation.current=null;skipAutomaticFeedWork.current=false;setSyncing(true); setSyncText(t('正在检查内容源…')); try {
        let processed = 0;
        let pending = 0;
        for (let batch = 0; batch < 35; batch++) {
            const result = await api<any>('/api/sync', post({ force: force && batch === 0, limit: 4 }));
            processed += result.processed || 0;
            if (batch === 0 && result.processed)
                setBriefingRevision(value => value + 1);
            pending = Number(result.pending) || 0;
            if (!active.current)
                return;
            setSyncText(pending > 0 ? t(`已检查 ${processed} 个来源 · 还有 ${pending} 个`) : t('更新完成'));
            if (!pending)
                break;
        }
        await feedLoader.current(false);
        await loadSidebar();
        if (force)
            notify(pending > 0 ? t('已保存更新进度，下次打开可继续。') : t('内容库已更新。'));
    }
    catch (e) {
        notify((e as Error).message);
    }
    finally {
        if (active.current) {
            setSyncing(false);
            setSyncText('');
        }
    } }, [syncing, loadSidebar, notify]);
    useEffect(() => { if (skipAutomaticFeedWork.current || loading || error || autoSync.current || view !== 'feed')
        return; autoSync.current = true; if (!lastUpdated || Date.now() - new Date(lastUpdated).getTime() > 6 * 3600000)
        void refresh(false); }, [loading, error, lastUpdated, view, refresh]);
    useEffect(() => { if (!selected && !importing)
        return; const original = document.body.style.overflow; const previousFocus = document.activeElement as HTMLElement | null; document.body.style.overflow = 'hidden'; const dialog = document.querySelector<HTMLElement>('[role=dialog]'); dialog?.querySelector<HTMLElement>('button,input,a[href]')?.focus(); const close = (event: KeyboardEvent) => { if (event.key === 'Escape') {
        setSelected(null);
        setImporting(false);
    } if (event.key === 'Tab' && dialog) {
        const elements = Array.from(dialog.querySelectorAll<HTMLElement>('button:not([disabled]),input:not([disabled]),a[href],iframe')).filter(el => el.offsetParent !== null);
        const first = elements[0], last = elements[elements.length - 1];
        if (first && event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) {
            event.preventDefault();
            last?.focus();
        }
        else if (first && !event.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) {
            event.preventDefault();
            first.focus();
        }
    } }; document.addEventListener('keydown', close); return () => { document.body.style.overflow = original; document.removeEventListener('keydown', close); previousFocus?.focus(); }; }, [selected, importing]);
    useEffect(() => { if (skipAutomaticFeedWork.current || autoAnalyze.current || loading || syncing || view !== 'feed' || !settings.enabled || !settings.configured)
        return; autoAnalyze.current = true; void (async () => { let count = 0; try {
        const maximum = Math.min(100, Math.max(0, settings.dailyLimit - (usage.analyzedToday || 0)));
        for (let i = 0; i < maximum && active.current; i++) {
            setAnalysisProgress(t(`AI 正在整理阅读笔记 · 已完成 ${count} 条`));
            const result = await api<{
                analyzed: number;
                remaining: number;
                error?: string;
            }>('/api/analyze', post({ limit: 1 }));
            count += result.analyzed || 0;
            if (result.error) {
                notify(result.error);
                break;
            }
            if (!result.remaining || !result.analyzed)
                break;
        }
        if (active.current) {
            if (count) {
                await feedLoader.current(false);
                await loadSidebar();
                notify(t(`已为 ${count} 条内容整理 AI 阅读笔记。`));
            }
        }
    }
    catch (e) {
        if (active.current)
            notify((e as Error).message);
    }
    finally {
        if (active.current)
            setAnalysisProgress('');
    } })(); }, [loading, syncing, view, settings.enabled, settings.configured, settings.provider, settings.model, settings.dailyLimit, loadSidebar, notify]);
    const navigate = (next: View) => { setView(next); setMobileNav(false); setQuery(''); setSearch(''); setSelected(null); };
    const feedback = async (item: ContentItem, patch: Feedback) => { try {
        await api('/api/feedback', post({ id: item.id, patch }));
        setBriefingRevision(value => value + 1);
        setItems(old => old.map(x => x.id === item.id ? { ...x, ...patch } : x).filter(x => !x.dismissed));
        setSelected(old => old?.id === item.id ? { ...old, ...patch } : old);
        if (patch.saved !== undefined)
            notify(patch.saved ? t('已加入稍后看。') : t('已从稍后看移除。'));
        if (patch.dismissed)
            notify(t('会减少这类推荐。'));
    }
    catch (e) {
        notify((e as Error).message);
    } };
    const blockSource = async (item: ContentItem) => { try {
        await api('/api/sources', { method: 'PATCH', body: JSON.stringify({ id: item.sourceId, blocked: true }) });
        setItems(old => old.filter(x => x.sourceId !== item.sourceId));
        setSelected(null);
        await loadSidebar();
        notify(t(`已屏蔽 ${item.sourceName}，可在内容来源恢复。`));
    }
    catch (e) {
        notify((e as Error).message);
    } };
    const analyze = async (item: ContentItem) => { setAnalyzing(item.id); try {
        const result = await api<any>('/api/analyze', post({ id: item.id }));
        const updated = result.item || (result.analysis ? { ...item, analysis: result.analysis } : null);
        if (updated) {
            setSelected(updated);
            setItems(old => old.map(x => x.id === item.id ? updated : x));
            notify(t('AI 阅读已完成。'));
        }
        else {
            notify(result.message || t('分析任务已提交。'));
            await feedLoader.current(false);
        }
        await loadSidebar();
    }
    catch (e) {
        notify((e as Error).message);
    }
    finally {
        setAnalyzing(null);
    } };
    const importContent = async () => { if (!importUrl.trim())
        return; setImportBusy(true); try {
        await api('/api/import', post({ url: importUrl.trim() }));
        setImporting(false);
        setImportUrl('');
        notify(t('已保存到你的内容库。'));
        await feedLoader.current(false);
        await loadSidebar();
    }
    catch (e) {
        notify((e as Error).message);
    }
    finally {
        setImportBusy(false);
    } };
    const sourceCount = sources.filter(x => x.enabled).length;
    const healthCount = sources.filter(x => x.enabled && !x.error && (x.status === 'ok' || !!x.lastSuccess)).length;
    const pageTitle = view === 'saved' ? t('留给下一次的好内容') : view === 'liked' ? t('那些让你停下来看的内容') : view === 'read' ? t('好奇心走过的地方') : mode === 'rest' ? t('把时间，留给值得的内容。') : t('让好奇，走向真正的能力。');
    return <div className="app-shell">
    {mobileNav && <button className="nav-scrim" onClick={() => setMobileNav(false)} aria-label={t("\u5173\u95ED\u5BFC\u822A")}/>}
    <aside className={`sidebar ${mobileNav ? 'open' : ''}`}>
      <button className="brand" onClick={() => navigate('feed')} aria-label={t("YourFeed \u9996\u9875")}><span className="brand-symbol">{branding.initial}<span>.</span></span><span>{branding.prefix}<span className="brand-light">{branding.suffix}</span><small>YOUR PERSONAL CORNER</small></span></button>
      <div className="sidebar-section-label">{t("\u4F60\u7684\u7A7A\u95F4")}</div>
      <nav className="primary-nav">
        {([{ id: 'feed', label: t('为你发现'), icon: House }, { id: 'saved', label: t('稍后再看'), icon: Bookmark }, { id: 'liked', label: t('我喜欢的'), icon: Heart }, { id: 'read', label: t('阅读足迹'), icon: History }] as const).map(({ id, label, icon: Icon }) => <button key={id} onClick={() => navigate(id)} className={view === id ? 'active' : ''}><Icon size={18}/><span>{t(label)}</span>{view === id && <span className="nav-active-dot"/>}</button>)}
      </nav>
      <div className="sidebar-section-label source-nav-label">{t("\u8BA9\u5185\u5BB9\u8DDF\u968F\u4F60")}</div>
      <nav className="primary-nav"><button onClick={() => navigate('sources')} className={view === 'sources' ? 'active' : ''}><Rss size={18}/><span>{t("\u5185\u5BB9\u6765\u6E90")}</span><span className="nav-count">{sourceCount}</span></button><button onClick={() => navigate('settings')} className={view === 'settings' ? 'active' : ''}><SlidersHorizontal size={18}/><span>{t("\u504F\u597D\u4E0E AI \u8BBE\u7F6E")}</span></button></nav>
      <div className="sidebar-note"><span className="tiny-star">✳</span><p>{t("\u5C11\u4E00\u70B9\u566A\u58F0\uFF0C")}<br />{t("\u591A\u4E00\u70B9\u81EA\u5DF1\u7684\u65B9\u5411\u3002")}</p><span className="note-line"/></div>
      <div className="sidebar-footer"><span className="avatar">{profile.displayName?.slice(0, 2).toUpperCase() || 'Y'}</span><div><strong>{profile.displayName || t('你的私人空间', 'Your private space')}</strong><span><span className="green-dot"/>{t("\u4EC5\u81EA\u5DF1\u53EF\u89C1")}</span></div><ShieldCheck size={16}/></div>
    </aside>
    <div className="workspace">
      <header className="topbar"><div className="breadcrumb"><button className="mobile-menu icon-button" onClick={() => setMobileNav(true)} aria-label={t("\u6253\u5F00\u5BFC\u822A")}><Menu size={20}/></button><span>{t("\u6211\u7684\u7A7A\u95F4")}</span><ChevronRight size={13}/><strong>{view === 'sources' ? t('内容来源') : view === 'settings' ? t('偏好与 AI 设置') : view === 'saved' ? t('稍后再看') : view === 'liked' ? t('我喜欢的') : view === 'read' ? t('阅读足迹') : t('为你发现')}</strong></div><div className="topbar-actions"><LanguageToggle /><ThemeToggle /><AccountMenu /><button className="small-button add-button" onClick={() => setImporting(true)}><Plus size={15}/><span>{t("\u6536\u85CF\u94FE\u63A5")}</span></button></div></header>
      <main className={view === 'settings' || view === 'sources' ? 'main-area full-width' : 'main-area'}>
        {view === 'settings' ? <section className="settings-container"><div className="settings-section-picker"><div className="settings-picker-heading"><h2 id="settings-section-label">{t('选择设置分类','Choose a settings section')}</h2><p>{t('点选下方卡片，管理你的偏好、模型或网站。','Choose a card to manage your preferences, AI models, or site.')}</p></div><nav className="settings-tabs" aria-labelledby="settings-section-label">{([
          {id:'profile',label:t('我的偏好','My profile'),description:t('目标、兴趣与语言','Goals, interests, and language'),icon:SlidersHorizontal},
          {id:'ai',label:t('AI 与接口','AI & APIs'),description:t('密钥、模型与用量','API keys, models, and usage'),icon:KeyRound},
          {id:'domain',label:t('部署与域名','Deployment & domain'),description:t('实例地址与域名验证','Site address and domain verification'),icon:Globe2},
        ] as const).map(tab=>{const Icon=tab.icon;const active=settingsTab===tab.id;return <button key={tab.id} type="button" onClick={()=>setSettingsTab(tab.id)} className={active?'selected':''} aria-pressed={active}><span className="settings-tab-top"><span className="settings-tab-icon"><Icon size={22} aria-hidden="true"/></span><span className={`settings-tab-state ${active?'current':''}`}>{active?<><Check size={12} aria-hidden="true"/>{t('当前','Current')}</>:<ChevronRight size={18} aria-hidden="true"/>}</span></span><span className="settings-tab-copy"><strong>{tab.label}</strong><span>{tab.description}</span></span></button>;})}</nav></div>{settingsTab === 'profile' ? <ProfileSettings profile={profile} onChange={setProfile} notify={notify} aiConfigured={!!settings.configured} onOpenAiSettings={() => { setSettingsTab('ai'); navigate('settings'); }} onUsageChange={() => void loadSidebar()}/> : settingsTab === 'ai' ? <SettingsPanel settings={settings} onChange={setSettings} usage={usage} notify={notify} reload={loadSidebar}/> : <DeploymentSettings />}</section> : view === 'sources' ? <SourceSettings sources={sources} syncing={syncing} syncText={syncText} onSync={() => void refresh(true)} onImport={() => setImporting(true)} reload={loadSidebar} notify={notify} aiConfigured={!!settings.configured} onOpenAiSettings={() => { setSettingsTab('ai'); navigate('settings'); }} importText={sourceImportText} onImportTextChange={setSourceImportText} chatText={sourceChatText} onChatTextChange={setSourceChatText}/> : <>
          <section className="main-column">
            <div className="welcome-eyebrow"><span className="amber-dash"/>{view === 'feed' ? 'CURATED FOR YOUR CURIOSITY' : 'A LITTLE COLLECTION OF YOU'}</div>
            <div className="hero-heading"><div><h1>{t(pageTitle)}</h1><p>{view === 'feed' ? (mode === 'rest' ? t('从一个有趣的视频、一篇好文章开始。享受这段属于你的时间。') : t('从真实的问题出发，积累能带到下一阶段的知识与经验。')) : t('把有价值的发现留下来，随时回来接着看。')}</p></div><span className="hero-asterisk">✳</span></div>
            <div className="discovery-controls"><div className="mode-switch"><button className={mode === 'rest' ? 'selected' : ''} onClick={() => setMode('rest')}><Leaf size={15}/>{t("\u4F11\u606F\u4E00\u4E0B")}</button><button className={mode === 'grow' ? 'selected' : ''} onClick={() => setMode('grow')}><GraduationCap size={16}/>{t("\u60F3\u5B66\u4E00\u70B9")}</button></div><div className="feed-update-actions">{view==='feed'&&<button type="button" className="shuffle-button" onClick={()=>void shuffleFeed()} disabled={loading||loadingMore||syncing||shuffling} title={t('从已缓存的内容中换一批，不更新来源、不调用 AI，也不改变已读或兴趣反馈。','Show another batch from cached items. No source updates, AI calls, or reading/preference changes.')} aria-busy={shuffling}>{shuffling?<Loader2 size={16} className="spin"/>:<Shuffle size={17}/>}<span>{shuffling?t('正在换一批…','Finding another batch…'):t('换一批','Another batch')}</span></button>}<button type="button" className={`refresh-button ${syncing ? 'spinning' : ''}`} onClick={() => void refresh(true)} disabled={syncing||shuffling}><RefreshCw size={14}/>{syncing?t('正在更新','Updating…'):t('更新来源','Update sources')}</button></div></div>
            {view === 'feed' && <DailyBriefing revision={briefingRevision} onOpen={setSelected} onNews={() => { setKind('news'); setQuery(''); setSearch(''); }}/>}
            {view === 'feed' && !loading && !error && !items.length && !sources.length && <ProfileOnboarding profile={profile} onChange={setProfile} notify={notify} onSources={() => navigate('sources')} onSettings={() => { setSettingsTab('ai'); navigate('settings'); }}/>}
            <div className="feed-toolbar"><div className="kind-tabs">{kinds.map(({ id, label }) => <button key={id} className={kind === id ? 'selected' : ''} onClick={() => setKind(id)}>{t(label)}</button>)}</div><button className="filter-button" onClick={() => document.getElementById('feed-search')?.focus()} aria-label={t("\u641C\u7D22\u5185\u5BB9")}><Search size={17}/></button></div>
            <div className="search-row"><Search size={15}/><input id="feed-search" maxLength={200} placeholder={t("\u5728\u4F60\u7684\u5185\u5BB9\u82B1\u56ED\u91CC\u641C\u7D22\u2026")} value={query} onChange={e => setQuery(e.target.value)}/>{query && <button className="icon-button" aria-label={t("\u6E05\u9664\u641C\u7D22")} onClick={() => setQuery('')}><X size={14}/></button>}<span className="result-count">{t(`${total} 条发现`)}</span></div>
            {(syncing || analysisProgress) && <div className="sync-line"><Loader2 className="spin" size={13}/><span>{syncing ? syncText : analysisProgress}</span><span className="sync-line-fill"/></div>}
            {error && <div className="error-box"><p>{t(error)}</p><button className="small-button" onClick={() => void loadFeed()}>{t("\u91CD\u65B0\u52A0\u8F7D")}</button></div>}
            {loading && !items.length ? <div className="feed-grid">{[1, 2, 3, 4].map(i => <div className="skeleton-card" key={i}><div /><span /><span /><span /></div>)}</div> : items.length ? <><div className="section-kicker"><span>{view === 'feed' ? (mode === 'rest' ? t('今日的好奇心菜单') : t('值得投入的下一步')) : t('你的个人片库')}</span><span>{t("\u6309\u4E0E\u4F60\u7684\u5173\u8054\u63A8\u8350")}<Sparkles size={11}/></span></div><div className="feed-grid">{items.map((item, index) => <ContentCard key={item.id} item={item} index={index} onOpen={() => setSelected(item)} onFeedback={patch => void feedback(item, patch)}/>)}</div>{cursor !== null && <button className="load-more" onClick={() => void loadFeed(true)} disabled={loadingMore||loading||shuffling||syncing}>{loadingMore ? <Loader2 size={15} className="spin"/> : <Plus size={15}/>}{t("\u518D\u53D1\u73B0\u4E00\u4E9B\u597D\u5185\u5BB9")}</button>}<div className="feed-end"><span />{t("\u597D\u5185\u5BB9\u4E0D\u5FC5\u4E00\u6B21\u770B\u5B8C")}<span /></div></> : !error && <div className="empty-state"><div className="empty-icon"><Compass size={30}/></div><h2>{query ? t('暂时没有找到匹配内容') : view === 'saved' ? t('给下次休息，留一点期待') : view === 'liked' ? t('喜欢的内容会在这里相遇') : view === 'read' ? t('你的阅读足迹从这里开始') : t('你的内容花园，正在生长')}</h2><p>{query ? t('换个关键词，或者看看其他类型。') : view === 'feed' ? t('点击更新连接已启用的内容源，或先收藏一条你喜欢的链接。') : t('在内容卡片上保存、点赞或标记读过，即可在这里找到。')}</p><button className="primary-button" onClick={() => view === 'feed' ? void refresh(true) : navigate('feed')}>{view === 'feed' ? <RefreshCw size={15}/> : <ArrowRight size={15}/>} {view === 'feed' ? t('更新我的内容库') : t('去发现好内容')}</button></div>}
          </section>
          <aside className="right-column"><div className="today-date">{new Intl.DateTimeFormat(localeTag(language), { timeZone: profile.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone, month: 'long', day: 'numeric', weekday: 'long' }).format(new Date())}<span className="green-dot"/></div><div className="intent-card"><span className="intent-icon">{mode === 'rest' ? <Leaf size={20}/> : <GraduationCap size={22}/>}</span><span className="micro-label">{t("\u6B64\u523B\uFF0C\u4E3A\u81EA\u5DF1")}</span><h3>{mode === 'rest' ? t('放松，也可以有收获。') : t('一点一滴，变得更有底气。')}</h3><p>{mode === 'rest' ? t('保留真实的兴趣，不急着把每一次好奇变成任务。') : t('根据你的目标和内容偏好，挑选值得投入的下一步。')}</p><div className="intent-bottom"><span>{t("\u7531\u4F60\u638C\u63A7\u7684\u63A8\u8350")}</span><Sparkles size={13}/></div></div>
            <div className="radar-panel"><div className="panel-title"><h3>{t("\u4F60\u7684\u5174\u8DA3\u96F7\u8FBE")}</h3><Compass size={15}/></div><p className="muted small">{t("\u8BA9\u719F\u6089\u7684\u5174\u8DA3\uFF0C\u4E5F\u9047\u89C1\u65B0\u53EF\u80FD\u3002")}</p><div className="interest-tags">{(Object.entries(profile.topicWeights || {}).filter(([,weight])=>(weight||0)>0).sort((a, b) => (b[1] || 0) - (a[1] || 0)).slice(0, 6).map(([key]) => key)).map((topic, i) => <button key={topic} onClick={() => { setQuery(t(topicNames[topic as Topic])); setKind('all'); }} className={i === 0 ? 'highlight' : ''}>{t(topicNames[topic as Topic])}</button>)}</div><div className="radar-caption"><span className="amber-dot"/>{t("\u6765\u6E90\u4E8E\u4F60\u7684\u8BA2\u9605\u3001Stars \u4E0E\u53CD\u9988")}</div></div>
            <div className="source-mini"><div className="panel-title"><h3>{t("\u597D\u5185\u5BB9\uFF0C\u4ECE\u8FD9\u91CC\u6765")}</h3><button onClick={() => navigate('sources')} aria-label={t("\u7BA1\u7406\u6765\u6E90")}><ArrowUpRight size={15}/></button></div><div className="platform-row"><SourceMark platform="youtube"/><span>{t("YouTube / B \u7AD9")}</span><span>{t("\u89C6\u9891")}</span></div><div className="platform-row"><SourceMark platform="rss"/><span>{t("RSS \u4E0E\u9605\u8BFB")}</span><span>{t("\u8D44\u8BAF")}</span></div><div className="platform-row"><SourceMark platform="github"/><span>GitHub Stars</span><span>{t("\u5F00\u6E90")}</span></div><div className="source-health"><span className="green-dot"/>{healthCount ? t(`${healthCount} 个来源已连接`) : t('来源状态可在设置中查看')}<button onClick={() => navigate('sources')}>{t("\u7BA1\u7406")}<ChevronRight size={11}/></button></div></div>
            <div className="quiet-note"><BookOpen size={17}/><p>{t("\u4F60\u770B\u8FC7\u4EC0\u4E48\uFF0C")}<br />{t("\u4F1A\u6162\u6162\u53D8\u6210\u4F60\u7684\u4E00\u90E8\u5206\u3002")}</p><span>STAY CURIOUS. STAY YOU.</span></div><div className="update-caption">{lastUpdated ? t(`上次更新 · ${timeAgo(lastUpdated, language)}`) : t('按需更新 · 不打扰你的时间')}</div>
          </aside>
        </>}
      </main>
      <footer className="workspace-footer"><span>{branding.name} <span className="footer-dot">·</span>{t("\u8BA9\u597D\u5947\u6709\u6240\u5F52\u5904")}</span><span>{t("\u4F60\u7684\u6765\u6E90\uFF0C\u4F60\u7684\u8282\u594F\u3002")}</span></footer>
    </div>
    {selected && <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget)
            setSelected(null); }}><section className="reader-modal" role="dialog" aria-modal="true" aria-labelledby="reader-title"><button className="modal-close icon-button" aria-label={t("\u5173\u95ED\u5185\u5BB9")} onClick={() => setSelected(null)}><X size={21}/></button><div className="reader-source"><SourceMark platform={selected.platform}/>{selected.sourceName}<span>·</span>{timeAgo(selected.publishedAt, language)}</div><h2 id="reader-title">{selected.title}</h2><div className="reader-actions"><button className={`small-button ${selected.saved ? 'is-saved' : ''}`} onClick={() => void feedback(selected, { saved: !selected.saved })}><Bookmark size={15}/>{selected.saved ? t('已保存') : t('稍后再看')}</button><button className="small-button" onClick={() => void feedback(selected, { read: !selected.read })}><CheckCheck size={15}/>{selected.read ? t('已读过') : t('标记读过')}</button><a className="small-button" href={selected.url} target="_blank" rel="noopener noreferrer">{t("\u539F\u59CB\u6765\u6E90")}<ArrowUpRight size={14}/></a></div>
      <ContentActions item={selected}/>
      {selected.kind === 'video' && <VideoPlayer item={selected}/>}
      {selected.analysis ? <div className="ai-reading"><div className="ai-label"><Sparkles size={15}/>{t("AI \u9605\u8BFB\u7B14\u8BB0")}<span>{selected.analysis.coverage === 'full_text' ? t('基于可读取正文') : selected.analysis.coverage === 'excerpt' ? t('基于原文摘要') : t('基于标题与元数据')}</span></div><ul>{selected.analysis.bullets.map((bullet, i) => <li key={i}>{bullet}</li>)}</ul><div className="relevance"><span>{t("\u4E0E\u4F60\u7684\u5173\u8054")}</span><p>{selected.analysis.relevance}</p></div><div className="analysis-references">{selected.analysis.references.map((url, i) => <a key={url} href={url} target="_blank" rel="noopener noreferrer">{t(`依据来源 ${i + 1}`)}<ArrowUpRight size={10}/></a>)}</div><span className="analysis-model">{selected.analysis.model}</span></div> : <button className="analyze-button" disabled={analyzing === selected.id} onClick={() => void analyze(selected)}>{analyzing === selected.id ? <Loader2 className="spin" size={17}/> : <Sparkles size={17}/>} {analyzing === selected.id ? t('正在阅读与整理…') : t('用 AI 帮我读一下')}<span>{t("\u63D0\u70BC\u8981\u70B9\u4E0E\u4E2A\u4EBA\u5173\u8054")}</span></button>}
      <div className="original-label">{selected.kind === 'project' ? t('项目介绍') : t('来源内容')}<span>{t("\u4FDD\u7559\u539F\u59CB\u51FA\u5904")}</span></div><p className="reader-summary">{selected.summary}</p>{selected.body && <div className="reader-body">{textBody(selected.body)}</div>}<a href={selected.url} target="_blank" rel="noopener noreferrer" className="reader-origin">{t("\u5230\u539F\u59CB\u6765\u6E90\u7EE7\u7EED\u9605\u8BFB")}<ArrowUpRight size={16}/></a>{(selected.relatedSources?.length || 0) > 1 && <section className="related-reading"><h3>{t("\u540C\u4E00\u4E8B\u4EF6\u7684\u5176\u4ED6\u6765\u6E90")}</h3><div>{selected.relatedSources!.filter(source => source.url !== selected.url && /^https:\/\//i.test(source.url)).map(source => <a key={source.url} href={source.url} target="_blank" rel="noopener noreferrer"><SourceMark platform="web"/><span>{source.name}</span><ArrowUpRight size={13}/></a>)}</div></section>}<div className="reader-footer"><button onClick={() => void feedback(selected, { liked: !selected.liked })} className={selected.liked ? 'liked' : ''}><Heart size={16} fill={selected.liked ? 'currentColor' : 'none'}/>{selected.liked ? t('你喜欢这条内容') : t('喜欢这条内容')}</button><button onClick={() => void blockSource(selected)}><EyeOff size={15}/>{t("\u5C4F\u853D\u8FD9\u4E2A\u6765\u6E90")}</button></div></section></div>}
    {importing && <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget)
        setImporting(false); }}><section className="import-modal" role="dialog" aria-modal="true" aria-labelledby="import-title"><button className="modal-close icon-button" aria-label={t("\u5173\u95ED\u5BFC\u5165")} onClick={() => setImporting(false)}><X size={20}/></button><div className="import-symbol"><Link2 size={25}/></div><span className="micro-label">KEEP A GOOD FIND</span><h2 id="import-title">{t("\u628A\u4E00\u4E2A\u597D\u53D1\u73B0\uFF0C\u7559\u5728\u8FD9\u91CC\u3002")}</h2><p>{t("\u7C98\u8D34\u89C6\u9891\u3001\u6587\u7AE0\u3001X \u5E16\u5B50\u6216 GitHub \u9879\u76EE\u94FE\u63A5\uFF0C\u6574\u7406\u8FDB\u4F60\u7684\u79C1\u4EBA\u5185\u5BB9\u5E93\u3002")}</p><label className="form-label" htmlFor="import-url">{t("\u5185\u5BB9\u94FE\u63A5")}</label><input id="import-url" className="form-input" type="url" placeholder="https://…" value={importUrl} onChange={e => setImportUrl(e.target.value)} onKeyDown={e => { if (e.key === 'Enter')
        void importContent(); }} autoFocus/><button className="primary-button full" onClick={() => void importContent()} disabled={importBusy || !importUrl.trim()}>{importBusy ? <Loader2 className="spin" size={16}/> : <Plus size={16}/>} {importBusy ? t('正在保存…') : t('加入我的内容库')}</button><span className="import-footnote"><ShieldCheck size={12}/>{t("\u6536\u85CF\u5185\u5BB9\u4EC5\u81EA\u5DF1\u53EF\u89C1")}</span></section></div>}
    {toast && <div className="toast" role="status"><span className="toast-dot"/>{t(toast)}<button className="icon-button" aria-label={t("\u5173\u95ED\u63D0\u793A")} onClick={() => setToast('')}><X size={14}/></button></div>}
  </div>;
}
function ContentCard({ item, index, onOpen, onFeedback }: {
    item: ContentItem;
    index: number;
    onOpen: () => void;
    onFeedback: (patch: Feedback) => void;
}) {
    const { t, language } = useI18n();
    const isVideo = item.kind === 'video';
    const [imageFailed, setImageFailed] = useState(false);
    const Icon = kinds.find(x => x.id === item.kind)?.icon || FileText;
    return <article className={`content-card card-${item.kind}`} style={{ animationDelay: `${Math.min(index, 7) * 45}ms` }}>
    {isVideo && <button className={`video-cover ${!item.image || imageFailed ? 'no-image' : ''}`} onClick={onOpen} aria-label={t(`观看 ${item.title}`)}>{item.image && !imageFailed ? <img src={item.image} alt="" referrerPolicy="no-referrer" loading={index < 2 ? 'eager' : 'lazy'} onError={() => setImageFailed(true)}/> : <><div className="abstract-lines"/><Video size={36}/><span>{item.topics[0] ? topicNames[item.topics[0]] : t('视频发现')}</span></>}<span className="video-play">▶</span><span className="video-platform">{platformId(item.platform) === 'youtube' ? 'YOUTUBE' : platformId(item.platform) === 'bilibili' ? 'BILIBILI' : item.platform.toUpperCase()}</span>{item.duration && <span className="duration-badge">{duration(item.duration)}</span>}</button>}
    <div className="card-content"><div className="card-source"><SourceMark platform={item.platform}/><span>{item.sourceName}</span><span className="source-divider">·</span><span>{timeAgo(item.publishedAt, language)}</span>{!isVideo && <span className={`kind-badge kind-${item.kind}`}><Icon size={11}/>{t(kinds.find(x => x.id === item.kind)?.label || '')}</span>}</div>
      {item.kind === 'project' && <div className="project-heading"><span className="project-icon"><Code2 size={21}/></span><span>{item.url.split('/').slice(-2, -1)[0] || 'OPEN SOURCE'}<span> / </span></span></div>}
      <button className="card-title" onClick={onOpen}><h2>{item.title}</h2>{item.kind === 'project' && <ArrowUpRight size={17}/>}</button>
      {!isVideo && <p className="card-description">{item.analysis?.bullets?.[0] || item.summary || t('打开原始来源，继续探索这条发现。')}</p>}
      <div className="card-tags">{item.topics.slice(0, 3).map(topic => <span key={topic}>{t(topicNames[topic] || topic)}</span>)}{(item.kind === 'news' || item.kind === 'article') && (item.relatedSources?.length || 0) > 1 && <span className="related-count"><Link2 size={9}/>{t(`${item.relatedSources!.length} 个来源`)}</span>}</div>
      <div className="card-reason"><Sparkles size={11}/><span>{item.analysis?.relevance || item.reason || (item.kind === 'project' ? t('来自你的 GitHub Stars') : t('来自你选择的内容来源'))}</span></div>
      <div className="card-bottom"><button className={item.liked ? 'liked' : ''} onClick={() => onFeedback({ liked: !item.liked })} aria-label={item.liked ? t('取消喜欢') : t('喜欢')} title={item.liked ? t('取消喜欢') : t('喜欢')}><Heart size={15} fill={item.liked ? 'currentColor' : 'none'}/></button><button className={item.saved ? 'is-saved' : ''} onClick={() => onFeedback({ saved: !item.saved })} aria-label={item.saved ? t('取消稍后看') : t('稍后看')} title={item.saved ? t('取消稍后看') : t('稍后看')}><Bookmark size={15} fill={item.saved ? 'currentColor' : 'none'}/></button><button className={item.read ? 'is-read' : ''} onClick={() => onFeedback({ read: !item.read })} aria-label={item.read ? t('标记未读') : t('标记读过')} title={item.read ? t('标记未读') : t('标记读过')}><CheckCheck size={15}/></button><span className="card-bottom-spacer"/>{item.analysis && <span className="ai-mini"><Sparkles size={10}/>{t("AI \u5DF2\u8BFB")}</span>}<button onClick={() => onFeedback({ dismissed: true })} aria-label={t("\u4E0D\u611F\u5174\u8DA3")} title={t("\u4E0D\u611F\u5174\u8DA3")}><EyeOff size={14}/></button><button className="open-card-button" onClick={onOpen} aria-label={t("\u6253\u5F00\u5185\u5BB9")}><ArrowUpRight size={15}/></button></div>
      <ContentActions item={item} onOpen={onOpen}/>
    </div>
  </article>;
}
function VideoPlayer({ item }: {
    item: ContentItem;
}) {
    const { t } = useI18n();
    const [failed, setFailed] = useState(false);
    let src = '';
    try {
        const u = new URL(item.url);
        const host = u.hostname.toLowerCase();
        if (platformId(item.platform) === 'youtube' || host === 'youtu.be' || host === 'youtube.com' || host.endsWith('.youtube.com')) {
            const fromUrl = u.searchParams.get('v') || (host === 'youtu.be' ? u.pathname.slice(1).split('/')[0] : u.pathname.match(/\/(?:shorts|embed|live)\/([^/?]+)/)?.[1]) || '';
            const id = /^[a-zA-Z0-9_-]{11}$/.test(item.externalId || '') ? item.externalId : fromUrl;
            if (id && /^[a-zA-Z0-9_-]{11}$/.test(id))
                src = `https://www.youtube.com/embed/${id}?rel=1`;
        }
        else if (platformId(item.platform) === 'bilibili' || host === 'bilibili.com' || host.endsWith('.bilibili.com')) {
            const fromUrl = u.pathname.match(/BV[a-zA-Z0-9]+/)?.[0];
            const id = /^BV[a-zA-Z0-9]+$/.test(item.externalId || '') ? item.externalId : fromUrl;
            if (id)
                src = `https://player.bilibili.com/player.html?bvid=${id}&autoplay=0`;
        }
    }
    catch { }
    return <div className="video-reader">{src && !failed ? <iframe key={src} src={src} title={item.title} allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen" allowFullScreen referrerPolicy="strict-origin-when-cross-origin" onError={() => setFailed(true)}/> : <div className="player-fallback"><Video size={30}/><p>{t("\u6B64\u89C6\u9891\u53EF\u5728\u539F\u5E73\u53F0\u89C2\u770B")}</p></div>}<div className="player-note"><span>{t("\u5E73\u53F0\u64AD\u653E\u5668 \u00B7 \u82E5\u53D7\u5730\u533A\u6216\u5D4C\u5165\u9650\u5236")}</span><a href={item.url} target="_blank" rel="noopener noreferrer">{t("\u5230\u539F\u5E73\u53F0\u89C2\u770B")}<ExternalLink size={12}/></a></div></div>;
}
