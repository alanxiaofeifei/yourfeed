import { describe, expect, it } from 'vitest';
import { TOUR_STEP_IDS } from '../shared/onboarding';
import {
  ONBOARDING_MESSAGES, TOUR_LOCALES, OFFICIAL_ONBOARDING_HOSTS,
  getOnboardingMessages, formatOnboardingMessage, isOfficialOnboardingUrl,
} from '../shared/onboarding-messages';

function leaves(value: unknown, prefix = ''): Record<string, string> {
  if (typeof value === 'string') return { [prefix]: value };
  if (!value || typeof value !== 'object') throw new Error(`Non-copy value at ${prefix}`);
  return Object.fromEntries(Object.entries(value).flatMap(([key, entry]) => Object.entries(leaves(entry, `${prefix}.${key}`))));
}
const placeholders = (text: string) => [...text.matchAll(/\{([a-zA-Z]+)\}/g)].map(match => match[1]).sort();
const providers = ['gemini', 'groq', 'nvidia', 'cerebras', 'openai', 'deepseek', 'glm', 'custom'];

describe('typed onboarding copy', () => {
  it('has all four real locales without locale fallback', () => {
    expect(TOUR_LOCALES).toEqual(['zh', 'zh-TW', 'en', 'vi']);
    for (const locale of TOUR_LOCALES) expect(getOnboardingMessages(locale)).toBe(ONBOARDING_MESSAGES[locale]);
    expect(getOnboardingMessages('zh-CN')).toBe(ONBOARDING_MESSAGES.zh);
    expect(new Set(TOUR_LOCALES.map(locale => getOnboardingMessages(locale))).size).toBe(4);
  });

  // Only exact brand names, official URLs and punctuation-only interpolation
  // templates may equal English. Check every leaf, including YouTube help and
  // link labels (not just step bodies), so newly added copy cannot silently fall back.
  for (const locale of ['zh-TW', 'vi'] as const) {
    it(`${locale}: has no missing or English onboarding leaf outside the explicit neutral allowlist`, () => {
      const brands = new Set(['Google AI Studio / Gemini', 'NVIDIA NIM', 'Cerebras', 'OpenAI API', 'DeepSeek API', 'GLM / BigModel']);
      const reference = leaves(ONBOARDING_MESSAGES.en);
      const translated = leaves(ONBOARDING_MESSAGES[locale]);
      expect(Object.keys(translated).sort()).toEqual(Object.keys(reference).sort());
      for (const [path, english] of Object.entries(reference)) {
        const text = translated[path];
        expect(text?.trim(), path).toBeTruthy();
        const neutral = (path.endsWith('.title') && brands.has(english))
          || (path.endsWith('.url') && isOfficialOnboardingUrl(english))
          || !english.replace(/\{[a-zA-Z]+\}|[\s:：/—-]/g, '');
        if (!neutral) expect(text, `${locale}${path}`).not.toBe(english);
      }
    });
  }

  for (const locale of TOUR_LOCALES) {
    const messages = ONBOARDING_MESSAGES[locale];
    it(`${locale}: covers every stable step, UI key, guide and interpolation`, () => {
      expect(TOUR_STEP_IDS).toHaveLength(19);
      expect(Object.keys(messages.steps)).toEqual([...TOUR_STEP_IDS]);
      expect(Object.keys(messages.guides.ai).sort()).toEqual([...providers].sort());
      const reference = leaves(ONBOARDING_MESSAGES.en);
      const translated = leaves(messages);
      expect(Object.keys(translated).sort()).toEqual(Object.keys(reference).sort());
      expect(Object.keys(translated).length).toBeGreaterThan(200);
      for (const [path, text] of Object.entries(translated)) {
        expect(text.trim(), path).not.toBe('');
        expect(text, path).not.toMatch(/TODO|TBD|fallback|<\/?(?:script|div|a|p)\b/i);
        expect(placeholders(text), path).toEqual(placeholders(reference[path]!));
      }
      if (locale !== 'en') {
        for (const id of TOUR_STEP_IDS) {
          expect(messages.steps[id].title, id).not.toBe(ONBOARDING_MESSAGES.en.steps[id].title);
          expect(messages.steps[id].body, id).not.toBe(ONBOARDING_MESSAGES.en.steps[id].body);
        }
        for (const group of ['actions', 'status', 'chapters', 'a11y', 'errors', 'help'] as const) {
          for (const [key, text] of Object.entries(messages[group])) {
            // Pure placeholder/punctuation templates are language-neutral.
            if (text.replace(/\{[a-zA-Z]+\}|[\s:：/—-]/g, '')) {
              expect(text, `${group}.${key}`).not.toBe((ONBOARDING_MESSAGES.en[group] as Record<string, string>)[key]);
            }
          }
        }
        for (const [id, translatedGuide] of Object.entries(messages.guides.ai)) {
          const englishGuide = ONBOARDING_MESSAGES.en.guides.ai[id as keyof typeof messages.guides.ai];
          expect(translatedGuide.summary, id).not.toBe(englishGuide.summary);
          translatedGuide.steps.forEach((step, i) => expect(step, `${id}.${i}`).not.toBe(englishGuide.steps[i]));
        }
      }
    });

    it(`${locale}: supplies detailed provider help and full ten-step YouTube guide`, () => {
      for (const entry of Object.values(messages.guides.ai)) {
        expect(entry.steps).toHaveLength(4);
        expect(entry.summary.length).toBeGreaterThan(20);
        entry.steps.forEach(step => expect(step.length).toBeGreaterThan(20));
        expect(entry.links.length).toBeGreaterThanOrEqual(2);
      }
      expect(messages.guides.youtube.steps).toHaveLength(10);
      messages.guides.youtube.steps.forEach((step, i) => expect(step.startsWith(`${i + 1}. `)).toBe(true));
      expect(messages.guides.youtube.steps.join(' ')).toMatch(/HTTP[ -]Referrer/i);
      expect(messages.guides.youtube.steps.join(' ')).toContain('OAuth Client Secret');
      expect(messages.guides.youtube.steps.join(' ')).toContain('Worker');
      expect(messages.guides.ai.glm.steps.join(' ')).toContain('Coding Plan');
      expect(messages.guides.ai.custom.steps.join(' ')).toContain('HTTPS');
      expect(messages.guides.ai.cerebras.summary).not.toMatch(/^Free\b|^免费\b|^免費\b|^Miễn phí\b/);
      expect(messages.help.costWarning).toContain('NVIDIA/Cerebras');
      expect(messages.help.checkedAt).toContain('2026-11-12');
      expect(messages.help.checkedAt).toContain('2026-11-14');
      expect(messages.guides.ai.cerebras.steps[1]).toContain('2026-11-14');
      expect(messages.guides.ai.cerebras.links.map(link => link.url)).toContain('https://inference-docs.cerebras.ai/console/account-billing.md');
      expect(Object.keys(messages.guides.ai).slice(0, 4)).toEqual(['gemini', 'groq', 'nvidia', 'cerebras']);
    });

    it(`${locale}: uses only official HTTPS allowlisted links with translated labels`, () => {
      for (const entry of [...Object.values(messages.guides.ai), messages.guides.youtube]) {
        expect(new Set(entry.links.map(link => link.url)).size).toBe(entry.links.length);
        for (const link of entry.links) {
          expect(link.label.trim()).not.toBe('');
          expect(isOfficialOnboardingUrl(link.url), link.url).toBe(true);
          const url = new URL(link.url);
          expect(OFFICIAL_ONBOARDING_HOSTS).toContain(url.hostname);
          expect(url.protocol).toBe('https:');
          expect(url.username + url.password + url.search + url.hash).toBe('');
        }
      }
    });
  }

  it('states the confirmed Cerebras trial and billing conditions plainly in every locale', () => {
    const required = {
      en: [/verified payment method/, /one-time \$5/, /30 days/, /no permanent free tier/, /Adding the card does not charge/],
      zh: [/经验证的支付方式/, /一次性 5 美元/, /30 天/, /没有永久免费层/, /添加银行卡本身不扣费/],
      'zh-TW': [/經驗證的付款方式/, /一次性 5 美元/, /30 天/, /沒有永久免費方案/, /新增信用卡本身不扣款/],
      vi: [/thanh toán đã xác minh/, /một lần 5 USD/, /30 ngày/, /không có bậc miễn phí vĩnh viễn/, /Thêm thẻ không bị tính phí/],
    };
    for (const locale of TOUR_LOCALES) {
      const text = ONBOARDING_MESSAGES[locale].guides.ai.cerebras.steps.join(' ');
      for (const condition of required[locale]) expect(text, `${locale}: ${condition}`).toMatch(condition);
    }
  });

  it('rejects insecure, injected, lookalike and non-official help URLs', () => {
    for (const url of ['http://console.groq.com/keys', 'https://console.groq.com.evil.test/keys', 'https://evilconsole.groq.com/', 'javascript:alert(1)', 'https://console.groq.com@evil.test/', 'https://user:secret@console.groq.com/keys', 'https://console.groq.com:8443/', 'https://localhost/', '/api/keys', 'not a URL']) {
      expect(isOfficialOnboardingUrl(url), url).toBe(false);
    }
  });

  it('interpolates only named plain-text values without special replacement semantics', () => {
    expect(formatOnboardingMessage('Step {current} of {total}', { current: 2, total: 19 })).toBe('Step 2 of 19');
    expect(formatOnboardingMessage('{label}', { label: '$& <text>' })).toBe('$& <text>');
    expect(formatOnboardingMessage('{missing}', {})).toBe('{missing}');
    expect(formatOnboardingMessage('{constructor}', {})).toBe('{constructor}');
  });
});
