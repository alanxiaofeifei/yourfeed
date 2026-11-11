import type {ContentItem} from './types';
/** Correct legacy presentation without rewriting cached notes or calling AI. */
export function honestContent(item:ContentItem):ContentItem {
 if(!item.analysis||item.analysis.coverage!=='full_text')return item;
 const body=item.body||item.summary||'';
 const shortened=item.analysis.inputTruncated||(typeof item.analysis.originalChars==='number'&&typeof item.analysis.inputChars==='number'&&item.analysis.originalChars>item.analysis.inputChars);
 const verified=item.contentCoverage==='full'&&!!item.body?.trim()&&!item.truncated&&!shortened&&body.length<=18000&&item.kind!=='video'&&item.kind!=='project'&&!(item.kind==='news'&&item.parentId);
 if(verified)return item;
 const coverage=item.kind==='video'||item.kind==='project'||!body?'metadata':'excerpt';
 return {...item,analysis:{...item.analysis,coverage}};
}
