import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import ts from 'typescript';
import AccountMenu from '../app/components/AccountMenu';
import { SidebarPrivacyNote } from '../app/components/Sidebar';
import { I18nProvider } from '../app/i18n';
import { translate } from '../shared/locales';
import { LANGUAGE_OPTIONS } from '../shared/language';

const home = readFileSync(new URL('../app/page.tsx', import.meta.url), 'utf8');
const account = readFileSync(new URL('../app/components/AccountMenu.tsx', import.meta.url), 'utf8');

// Rendered-unit checks need no browser/credentials. Interactive flows remain in the e2e suite.
describe('single account entry and noninteractive privacy context', () => {
  it.each(LANGUAGE_OPTIONS)('renders the privacy note in $value without a second account control', ({ value }) => {
    const html = renderToStaticMarkup(createElement(I18nProvider, { initialLanguage: value, children: createElement(SidebarPrivacyNote) }));
    expect(html).toContain(translate('私人阅读空间', value));
    expect(html).toContain(translate('账户与登录管理请使用右上角菜单。', value));
    expect(html).not.toMatch(/<button|<a\b|tabindex|role="button"|class="avatar"/);
    expect(html).not.toContain('Only you can see this');
  });

  it.each(LANGUAGE_OPTIONS)('renders an explicit accessible account loading state in $value', ({ value }) => {
    const html = renderToStaticMarkup(createElement(I18nProvider, { initialLanguage: value, children: createElement(AccountMenu) }));
    expect(html).toContain(translate('打开账户菜单', value));
    expect(html).toContain(translate('确认登录', value));
    expect(html).toContain('disabled=""');
    expect(html).not.toContain('class="account-dropdown"');
  });

  it('keeps identity in the account menu, not a profile-derived sidebar avatar', () => {
    expect(account).toContain("signedIn?t('我的账户','My account')");
    expect(account).toContain('<strong>{displayName}</strong>');
    expect(home).toContain('<SidebarPrivacyNote />');
    expect(home).not.toContain('profile.displayName?.slice');
  });
});

describe('account session / permanent Getting started wiring regressions', () => {
  it('shares one retryable session resolution rather than a silent, one-shot page request', () => {
    expect(home).not.toContain("fetch('/api/session'");
    expect(home).toContain('<AccountMenu onSessionChange={setSessionUserId} />');
    expect(account).toContain('onSessionChange?.(confirmedUserId)');
    expect(account).toContain("const confirmedUserId=state==='ready'&&session?.authenticated?session.user?.id||'':''");
    expect(account).toContain('onClick={()=>{setOpen(false);void loadSession();}}');
    expect(account).toContain("if(controller.signal.aborted)return;if(typeof data.authenticated!=='boolean'");
  });

  it('places the launcher before every main view without status, feed, or account-eligibility gates', () => {
    const source = ts.createSourceFile('page.tsx', home, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const launchers: ts.PropertyAccessExpression[] = [];
    function visit(node: ts.Node) {
      if (ts.isPropertyAccessExpression(node) && node.getText(source) === 'tour.launch') launchers.push(node);
      ts.forEachChild(node, visit);
    }
    visit(source);
    expect(launchers).toHaveLength(1);
    for (let ancestor: ts.Node | undefined = launchers[0].parent; ancestor && !ts.isReturnStatement(ancestor); ancestor = ancestor.parent) {
      expect(ts.isConditionalExpression(ancestor) || ts.isBinaryExpression(ancestor)).toBe(false);
    }
    expect(home.indexOf('tour.launch')).toBeLessThan(home.indexOf("{view === 'settings' ? <section"));
    expect(home).toContain('ready:!!sessionUserId&&sidebarReadyFor===sessionUserId');
    expect(home).toContain('data-tour="home-guide-entry"');
  });

  it.each(LANGUAGE_OPTIONS)('fully translates permanent-entry and account copy in $value', ({ value }) => {
    for (const key of ['我的账户', '私人阅读空间', '账户与登录管理请使用右上角菜单。', '随时继续或重新查看配置引导，不会清空你的设置。']) {
      expect(translate(key, value)).toBeTruthy();
      if (value === 'en' || value === 'vi') expect(translate(key, value)).not.toMatch(/[\u3400-\u9fff]/);
    }
  });
});
