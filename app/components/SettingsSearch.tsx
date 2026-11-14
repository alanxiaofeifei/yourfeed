'use client';
import {useState} from 'react';
import {settingsMessages} from '../../shared/settings-messages';
import {searchSettings,type SettingsTab} from '../../shared/settings-search-index';
import {useI18n} from '../i18n';
export default function SettingsSearch({onJump}:{onJump:(tab:SettingsTab)=>boolean}){
 const {language}=useI18n(),m=settingsMessages[language];const [query,setQuery]=useState('');const matches=searchSettings(query,language);
 const jump=(tab:SettingsTab,id:string)=>{if(!onJump(tab))return;requestAnimationFrame(()=>{const target=document.getElementById(id);if(!target)return;let parent=target.parentElement;while(parent){if(parent instanceof HTMLDetailsElement)parent.open=true;parent=parent.parentElement;}target.scrollIntoView({block:'center',behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});target.focus({preventScroll:true});});};
 return <div className="settings-search"><label htmlFor="settings-search">{m.search}</label><input id="settings-search" type="search" className="form-input" value={query} onChange={event=>setQuery(event.target.value)} aria-controls="settings-search-results" autoComplete="off"/>{query.trim()&&<div id="settings-search-results"><ul>{matches.map(item=><li key={item.id}><button type="button" onClick={()=>jump(item.tab,item.id)}>{item.label}</button></li>)}</ul>{!matches.length&&<p role="status">{m.noResults}</p>}</div>}</div>;
}
