'use client';
import {settingsMessages} from '../../shared/settings-messages';
import {useI18n} from '../i18n';
import type {SettingStatus} from '../../shared/settings-search-index';
import type {SaveStatus} from './useDirtyFormGuard';
export default function SettingsSaveBar({status,onSave,disabled,initialStatus}:{initialStatus?:SettingStatus;status:SaveStatus;onSave:()=>void;disabled:boolean}){
 const {language}=useI18n(),m=settingsMessages[language];
 return <div className="settings-save-bar"><span role="status" aria-live="polite">{m[status==='saved'?(initialStatus||'saved'):status]}</span><button type="button" className="primary-button" disabled={disabled} onClick={onSave}>{status==='saving'?m.saving:m.save}</button></div>;
}
