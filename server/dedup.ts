import type { ContentItem } from '../shared/types';

type Provenance = {name:string;url:string};
const WINDOW = 72 * 3600_000;
export function headlineKey(title:string):string {
  // Preserve decimal points, release suffixes and dates; only presentation changes collapse.
  return title.normalize('NFKC').toLocaleLowerCase().replace(/[\u200B-\u200D\uFEFF]/g,'').replace(/\s+/g,'').trim();
}
function canonical(input:string):string|null {
  try {const u=new URL(input);if(!['https:','http:'].includes(u.protocol)||u.username||u.password)return null;
    u.hash='';u.hostname=u.hostname.toLowerCase().replace(/^www\./,'');
    for(const key of [...u.searchParams.keys()])if(/^utm_|^(spm|spm_id_from|fbclid|gclid|ref_src|ref_url)$/i.test(key))u.searchParams.delete(key);
    u.searchParams.sort();u.pathname=u.pathname.replace(/\/$/,'')||'/';return u.toString();
  }catch{return null;}
}
function numberKey(title:string):string {
  return [...new Set(title.normalize('NFKC').toLowerCase().match(/\d+(?:[.\/-]\d+)*/g)||[])].sort().join('|');
}
function articleUrl(url:string,parentUrls:Set<string>):boolean {
  try {const u=new URL(url);return !parentUrls.has(url)&&u.pathname!=='/'&&!/^\/(?:blog|news|research|updates|issues|feed|rss)(?:\.xml)?\/?$/i.test(u.pathname)&&!(u.hostname==='daily.juya.uk'&&/^\/issues\//.test(u.pathname));}catch{return false;}
}
function provenance(item:ContentItem):Provenance[]{
  return [{name:item.sourceName,url:item.url},...(item.relatedSources||[])];
}
interface Group {items:ContentItem[];keys:Set<string>;first:number;last:number;}
export function groupNews(items:ContentItem[],allItems:ContentItem[]=items):ContentItem[] {
  const byId=new Map(allItems.map(item=>[item.id,item]));
  const parentUrls=new Set<string>();
  for(const item of allItems)if(item.parentId){const parent=byId.get(item.parentId);const url=parent&&canonical(parent.url);if(url)parentUrls.add(url);}
  const groups:Group[]=[];const keyed=new Map<string,Set<number>>();const order:({item:ContentItem}|{group:number})[]=[];
  for(const item of items){
    if(item.kind!=='news'){order.push({item});continue;}
    const date=Date.parse(item.publishedAt);const numbers=numberKey(item.title);const keys=new Set<string>();
    const own=canonical(item.url);if(own&&articleUrl(own,parentUrls))keys.add('url:'+own);
    // A whole daily issue is provenance, never evidence that its different stories are one event.
    for(const ref of item.analysis?.references||[]){const url=canonical(ref);if(url&&articleUrl(url,parentUrls))keys.add('url:'+url);}
    const headline=headlineKey(item.title);if(headline.length>=8)keys.add('title:'+headline);
    const candidates=new Set<number>();for(const key of keys)for(const index of keyed.get(key)||[])candidates.add(index);
    let match:number|undefined;
    for(const index of candidates){const group=groups[index];
      if(!Number.isFinite(date)||!Number.isFinite(group.first)||Math.max(date,group.last)-Math.min(date,group.first)>WINDOW)continue;
      if(group.items.some(old=>{const oldNumbers=numberKey(old.title);return numbers&&oldNumbers&&numbers!==oldNumbers;}))continue;
      match=index;break;
    }
    if(match===undefined){match=groups.length;groups.push({items:[item],keys,first:date,last:date});order.push({group:match});}
    else {const group=groups[match];group.items.push(item);group.first=Math.min(group.first,date);group.last=Math.max(group.last,date);for(const key of keys)group.keys.add(key);}
    for(const key of keys){const set=keyed.get(key)||new Set<number>();set.add(match);keyed.set(key,set);}
  }
  return order.map(entry=>{
    if('item'in entry)return entry.item;
    const group=groups[entry.group];if(group.items.length===1)return group.items[0];
    const representative=[...group.items].sort((a,b)=>Number(!!b.liked)-Number(!!a.liked)||Number(!!b.saved)-Number(!!a.saved))[0];
    const seen=new Set<string>();const relatedSources:Provenance[]=[];
    for(const item of [representative,...group.items])for(const ref of provenance(item)){const key=ref.name+'\n'+ref.url;if(!seen.has(key)){seen.add(key);relatedSources.push(ref);}}
    return {...representative,liked:group.items.some(i=>i.liked),saved:group.items.some(i=>i.saved),read:group.items.some(i=>i.read),relatedSources};
  });
}
