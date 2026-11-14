'use client';

import {settingsMessages} from '../../shared/settings-messages';
import { ShieldCheck } from 'lucide-react';
import { useI18n } from '../i18n';
import './Sidebar.css';

/** Privacy context, not a second account control or a claim of end-to-end encryption. */
export function SidebarPrivacyNote() {
  const { language } = useI18n();
  return <div className="sidebar-footer sidebar-privacy-note" data-testid="sidebar-privacy-note">
    <ShieldCheck size={18} aria-hidden="true" />
    <div><span>{settingsMessages[language].privacy}</span></div>
  </div>;
}
