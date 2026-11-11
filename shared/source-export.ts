import type {Source} from './types';

export interface SourceExport {schema:'yourfeed.sources';version:1;exportedAt:string;sources:Array<Pick<Source,'name'|'platform'|'locator'|'topics'|'enabled'>>;omitted:number;}
const credentialKey=/^(?:token|access_token|refresh_token|api[_-]?key|key|auth|authorization|signature|sig|code|password|secret)$/i;
function exportable(source:Source):boolean{
 if(source.platform==='youtube')return /^(?:UC[A-Za-z0-9_-]{22}|@?[\p{L}\p{N}\p{M}_.-]{1,50})$/u.test(source.locator);
 if(source.platform==='bilibili')return /^[1-9]\d{0,19}$/.test(source.locator);
 if(source.platform==='github')return /^[a-z\d](?:[a-z\d-]{0,37}[a-z\d])?$/i.test(source.locator)&&!source.locator.includes('--');
 try{const url=new URL(source.locator);return url.protocol==='https:'&&!url.username&&!url.password&&!/(?:unsubscribe|signout|logout|oauth|callback|settings\/billing)/i.test(url.pathname)&&![...url.searchParams.keys()].some(key=>credentialKey.test(key))&&!url.hash;}catch{return false;}
}
/** Whitelist fields: never include keys, settings, sessions or internal identities. */
export function buildSourceExport(sources:Source[],now=new Date()):SourceExport{
 const allowed=sources.filter(exportable);
 return {schema:'yourfeed.sources',version:1,exportedAt:now.toISOString(),sources:allowed.map(source=>({name:source.name,platform:source.platform,locator:source.locator,topics:[...source.topics],enabled:source.enabled})),omitted:sources.length-allowed.length};
}
const xml=(input:string)=>input.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g,'');
/** OPML interoperates with feed readers. Non-feed platform sources stay in JSON. */
export function sourceOpml(sources:Source[],now=new Date()):{text:string;included:number;omitted:number}{
 const feed=buildSourceExport(sources,now).sources.filter(source=>source.platform==='rss');
 const outlines=feed.map(source=>`    <outline type="rss" text="${xml(source.name)}" title="${xml(source.name)}" xmlUrl="${xml(source.locator)}"/>`).join('\n');
 return {text:`<?xml version="1.0" encoding="UTF-8"?>\n<opml version="2.0">\n  <head><title>YourFeed subscriptions</title><dateCreated>${now.toUTCString()}</dateCreated></head>\n  <body>\n${outlines}\n  </body>\n</opml>\n`,included:feed.length,omitted:sources.length-feed.length};
}
export function sourcePlatformWarning(source:Pick<Source,'platform'|'locator'>):'reddit-rss-ending'|undefined{
 if(source.platform!=='rss')return;try{const u=new URL(source.locator);if((u.hostname==='reddit.com'||u.hostname.endsWith('.reddit.com'))&&(/\.rss(?:\/|$)/i.test(u.pathname)||u.pathname.includes('/rss')))return 'reddit-rss-ending';}catch{}
}
