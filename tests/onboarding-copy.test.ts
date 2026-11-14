import { readFileSync } from 'node:fs';
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
const providers = ['gemini', 'groq', 'nvidia', 'openai', 'deepseek', 'glm', 'custom'];

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
      const brands = new Set(['Google AI Studio / Gemini', 'NVIDIA NIM', 'OpenAI API', 'DeepSeek API', 'GLM / BigModel']);
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
      expect(messages.help.checkedAt).toContain('2026-11-12');
      expect(Object.keys(messages.guides.ai).slice(0, 3)).toEqual(['gemini', 'groq', 'nvidia']);
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

  for (const locale of TOUR_LOCALES) {
    it(`${locale}: omits Cerebras from all onboarding copy and links while retaining budget warnings`, () => {
      const messages = ONBOARDING_MESSAGES[locale];
      expect(JSON.stringify(messages)).not.toMatch(/cerebras/i);
      const requiredWarnings = {
        en: [/zero cost estimate is NOT budget protection/, /may be zero even if your provider account is paid/, /cannot guarantee or prevent provider charges/, /No automatic paid upgrade or provider switch/],
        zh: [/零费用估算不等于预算保护/, /在服务商账号付费时，本站仍可能按零估算/, /无法保证或阻止上游扣费/, /不会自动升级付费或切换服务商/],
        'zh-TW': [/零費用估算不等於預算保護/, /在服務商帳號付費時，本站仍可能按零估算/, /無法保證或阻止上游扣款/, /不會自動升級付費或切換服務商/],
        vi: [/bằng không KHÔNG phải biện pháp bảo vệ ngân sách/, /bằng không dù tài khoản nhà cung cấp đang trả phí/, /không bảo đảm hoặc ngăn nhà cung cấp tính phí/, /Không tự nâng cấp trả phí hoặc đổi nhà cung cấp/],
      };
      for (const warning of requiredWarnings[locale]) expect(messages.help.costWarning).toMatch(warning);
    });
  }

  it('omits Cerebras from onboarding source, official hosts and the first-use guide', () => {
    const source = readFileSync(new URL('../shared/onboarding-messages.ts', import.meta.url), 'utf8');
    const doc = readFileSync(new URL('../docs/first-use-onboarding.md', import.meta.url), 'utf8');
    expect(source).not.toMatch(/cerebras/i);
    expect(OFFICIAL_ONBOARDING_HOSTS.join(' ')).not.toMatch(/cerebras/i);
    expect(doc).not.toMatch(/cerebras/i);
    expect(doc).toContain('A zero estimated rate is not budget protection.');
    expect(doc).toContain('cannot prevent an upstream bill');
    for (const host of ['cloud.cerebras.ai', 'inference-docs.cerebras.ai', 'www.cerebras.ai']) {
      expect(isOfficialOnboardingUrl(`https://${host}/`), host).toBe(false);
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
