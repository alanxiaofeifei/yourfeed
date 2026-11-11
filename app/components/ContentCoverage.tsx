'use client';
import type {ContentItem} from '../../shared/types';
import {useI18n} from '../i18n';
import './StorageSettings.css';
/** Coverage comes from acquisition evidence, never text length. Old rows remain unknown. */
export default function ContentCoverage({item,fromDevice=false}:{item:ContentItem;fromDevice?:boolean}){
 const {t}=useI18n(),coverage=(item as ContentItem&{contentCoverage?:string}).contentCoverage,method=(item as ContentItem&{retrievalMethod?:string}).retrievalMethod;
 const label=coverage==='full'?t('全文','Full text'):coverage==='excerpt'?t('来源摘要','Source excerpt'):coverage==='metadata'?t('仅元数据','Metadata only'):t('正文完整度未知','Text completeness unknown');
 const methodLabel=method==='rss-content'||method==='rss-summary'?t('通过 RSS / Atom 获取','Retrieved through RSS / Atom'):method==='platform-metadata'?t('通过平台接口获取','Retrieved through platform API'):method==='html-extraction'?t('通过网页提取获取','Extracted from the webpage'):t('获取方式未记录','Retrieval method not recorded');
 return <div className="coverage-label"><span>{label}</span><span>{methodLabel}</span>{(item as ContentItem&{truncated?:boolean}).truncated&&<span>{t('内容已截断','Content truncated')}</span>}{fromDevice&&<span>{t('来自此设备的缓存','From this device’s cache')}</span>}</div>;
}
