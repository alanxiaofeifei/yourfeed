'use client';

import { ShieldCheck } from 'lucide-react';
import { useI18n } from '../i18n';
import './Sidebar.css';

/** Privacy context, not a second account control or a claim of end-to-end encryption. */
export function SidebarPrivacyNote() {
  const { t } = useI18n();
  return <div className="sidebar-footer sidebar-privacy-note" data-testid="sidebar-privacy-note">
    <ShieldCheck size={18} aria-hidden="true" />
    <div><strong>{t('私人阅读空间', 'Private reading space')}</strong><span>{t('账户与登录管理请使用右上角菜单。', 'Manage your account and sign-in from the top-right menu.')}</span></div>
  </div>;
}
