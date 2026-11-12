import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, it, expect, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { getConfig, getProviderKey, getSecret, saveConfig, type Env } from '../server/db';
import { PROVIDERS, PROVIDER_METADATA, type ProviderMeta } from '../shared/providers';
import type { Provider, ProviderConfig, Usage } from '../shared/types';
import { I18nContext } from '../app/i18n';
import { translate } from '../shared/locales';
import AiSettings, { type Settings } from '../app/components/AiSettings';
import { callModel, probeProviderModels } from '../server/ai';

function environment(): Env {
  const db = new DatabaseSync(':memory:');
  for (const f of readdirSync('drizzle').filter(f => f.endsWith('.sql')).sort()) {
    db.exec(readFileSync('drizzle/' + f, 'utf8'));
  }
  const prepare = (sql: string) => {
    const statement = db.prepare(sql);
    const bound = (args: any[]) => ({
      run: async () => ({ meta: { changes: Number(statement.run(...args).changes) } }),
      first: async () => statement.get(...args) || null,
      all: async () => ({ results: statement.all(...args) }),
    });
    return { bind: (...args: any[]) => bound(args), ...bound([]) };
  };
  return {
    DB: { prepare, batch: async (statements: any[]) => Promise.all(statements.map(s => s.run())) },
    APP_ENCRYPTION_KEY: 'a1'.repeat(32),
  } as unknown as Env;
}

const NEW_PROVIDERS = ['gemini', 'groq', 'nvidia', 'cerebras'] as const;

describe('free-tier AI providers configuration', () => {
  it.each([
    [
      'gemini',
      'gemini-3.8-flash',
      'https://generativelanguage.googleapis.com/v1beta/openai',
      'chat-completions',
      'json_schema',
    ],
    [
      'groq',
      'openai/gpt-oss-120b',
      'https://api.groq.com/openai/v1',
      'chat-completions',
      'json_object',
    ],
    [
      'nvidia',
      'deepseek-ai/deepseek-v4-flash',
      'https://integrate.api.nvidia.com/v1',
      'chat-completions',
      'none',
    ],
    [
      'cerebras',
      'gpt-oss-120b',
      'https://api.cerebras.ai/v1',
      'chat-completions',
      'json_object',
    ],
  ] as const)(
    'configures %s with verified default model, base URL, protocol and response format',
    async (provider, defaultModel, baseUrl, protocol, responseFormat) => {
      const env = environment();
      const config = await getConfig(env, provider);
      expect(config.provider).toBe(provider);
      expect(config.model).toBe(defaultModel);
      expect(config.baseUrl).toBe(baseUrl);
      expect(config.protocol).toBe(protocol);
      expect(config.responseFormat).toBe(responseFormat);
      expect(config.reasoningEffort).toBeUndefined();

      // Accepts saving official baseUrl
      const saved = await saveConfig(env, { provider, baseUrl });
      expect(saved.profiles[provider].model).toBe(defaultModel);
      expect(saved.profiles[provider].baseUrl).toBe(baseUrl);

      // Accepts saving official baseUrl with trailing slash
      const savedSlash = await saveConfig(env, { provider, baseUrl: baseUrl + '/' });
      expect(savedSlash.profiles[provider].baseUrl).toBe(baseUrl);

      // Rejects non-official baseUrl
      await expect(
        saveConfig(env, { provider, baseUrl: 'https://untrusted.example.com/v1' }),
      ).rejects.toThrow('固定官方地址');
    },
  );
});

describe('hosted mode and env key fallback', () => {
  it('does NOT fall back to admin/env keys in hosted mode for new and existing providers', async () => {
    const env = {
      ...environment(),
      HOSTING_MODE: 'hosted',
      OPENAI_API_KEY: 'test-env-openai',
      DEEPSEEK_API_KEY: 'test-env-deepseek',
      GLM_API_KEY: 'test-env-glm',
      GEMINI_API_KEY: 'test-env-gemini',
      GROQ_API_KEY: 'test-env-groq',
      NVIDIA_API_KEY: 'test-env-nvidia',
      CEREBRAS_API_KEY: 'test-env-cerebras',
    };
    for (const provider of ['openai', 'deepseek', 'glm', ...NEW_PROVIDERS] as Provider[]) {
      expect(await getProviderKey(env, provider)).toBeUndefined();
      expect(await getSecret(env, provider)).toBeUndefined();
    }
  });

  it('falls back to optional env keys in self-hosted mode when no user key is stored', async () => {
    const env = {
      ...environment(),
      GEMINI_API_KEY: 'self-hosted-gemini-key',
      GROQ_API_KEY: 'self-hosted-groq-key',
      NVIDIA_API_KEY: 'self-hosted-nvidia-key',
      CEREBRAS_API_KEY: 'self-hosted-cerebras-key',
    };
    expect(await getProviderKey(env, 'gemini')).toBe('self-hosted-gemini-key');
    expect(await getProviderKey(env, 'groq')).toBe('self-hosted-groq-key');
    expect(await getProviderKey(env, 'nvidia')).toBe('self-hosted-nvidia-key');
    expect(await getProviderKey(env, 'cerebras')).toBe('self-hosted-cerebras-key');
  });
});

describe('UI component rendering: provider key note and free-tier text', () => {
  function renderSettings(provider: Provider, language: 'zh' | 'en') {
    const meta = PROVIDER_METADATA[provider];
    const settings: Settings = {
      provider,
      model: meta.defaultModel,
      baseUrl: meta.baseUrl,
      protocol: meta.protocol,
      responseFormat: meta.responseFormat,
      enabled: false,
      monthlyBudget: 20,
      dailyLimit: 20,
      providers: PROVIDERS.map(p => ({ provider: p, configured: false })),
      profiles: Object.fromEntries(
        PROVIDERS.map(p => [
          p,
          {
            provider: p,
            model: PROVIDER_METADATA[p].defaultModel,
            baseUrl: PROVIDER_METADATA[p].baseUrl,
            protocol: PROVIDER_METADATA[p].protocol,
            responseFormat: PROVIDER_METADATA[p].responseFormat,
            enabled: false,
            monthlyBudget: 20,
            dailyLimit: 20,
          },
        ]),
      ) as Record<Provider, ProviderConfig>,
    };
    const usage: Usage = {
      month: '2026-11',
      cost: 0,
      inputTokens: 0,
      outputTokens: 0,
      analyzedToday: 0,
    };
    return renderToStaticMarkup(
      createElement(
        I18nContext.Provider,
        {
          value: {
            language,
            setLanguage: () => {},
            t: (zh: string, en?: string) => translate(zh, language, en),
          },
        },
        createElement(AiSettings, {
          settings,
          onChange: () => {},
          usage,
          notify: () => {},
          reload: async () => {},
        }),
      ),
    );
  }

  it.each([
    [
      'gemini',
      'https://aistudio.google.com/apikey',
      '免费层可用 Flash / Flash-Lite 模型，按项目限速；免费层数据可能被用于改进 Google 产品。Gemini 4 不在免费层。',
      'Free tier covers Flash / Flash-Lite models with per-project rate limits; free-tier data may be used to improve Google products. Gemini 4 is not on the free tier.',
    ],
    [
      'groq',
      'https://console.groq.com/keys',
      '免费计划约 30 次/分钟、1,000 次/天（以控制台 Limits 为准）。',
      'Free plan is about 30 requests/min and 1,000/day (see console Limits).',
    ],
    [
      'nvidia',
      'https://build.nvidia.com',
      '加入 NVIDIA Developer Program 后可免费用于开发测试，有速率限制。在模型页点「Get API Key」获取。',
      'Free for development with the NVIDIA Developer Program, rate limited. Use "Get API Key" on a model page.',
    ],
    [
      'cerebras',
      'https://cloud.cerebras.ai',
      '免费试用约 5 次/分钟、每天 100 万 tokens（以控制台为准）。',
      'Free trial is about 5 requests/min and 1M tokens/day (see console).',
    ],
  ] as const)(
    'renders key note for %s with correct link and free-tier text in zh and en',
    (provider, keyUrl, freeTierZh, freeTierEn) => {
      // Test Chinese rendering
      const zhHtml = renderSettings(provider, 'zh');
      expect(zhHtml).toContain('class="provider-key-note"');
      expect(zhHtml).toContain(`href="${keyUrl}"`);
      expect(zhHtml).toContain('target="_blank"');
      expect(zhHtml).toContain('rel="noopener noreferrer"');
      expect(zhHtml).toContain('获取 API Key');
      expect(zhHtml).toContain(freeTierZh.replace(/"/g, '&quot;'));

      // Test English rendering
      const enHtml = renderSettings(provider, 'en');
      expect(enHtml).toContain('class="provider-key-note"');
      expect(enHtml).toContain(`href="${keyUrl}"`);
      expect(enHtml).toContain('Get API key');
      expect(enHtml).toContain(freeTierEn.replace(/"/g, '&quot;'));
    },
  );

  it('renders key note for existing providers without a free-tier line', () => {
    for (const [provider, keyUrl] of [
      ['openai', 'https://platform.openai.com/api-keys'],
      ['deepseek', 'https://platform.deepseek.com/api_keys'],
      ['glm', 'https://open.bigmodel.cn/usercenter/apikeys'],
    ] as const) {
      const html = renderSettings(provider, 'zh');
      expect(html).toContain('class="provider-key-note"');
      expect(html).toContain(`href="${keyUrl}"`);
      expect(html).toContain('获取 API Key');
      expect(html).not.toContain('class="provider-free-tier-note"');
    }
  });

  it('renders key note and hint for OpenRouter in custom provider', () => {
    const settings: Settings = {
      provider: 'custom',
      providerName: 'OpenRouter',
      baseUrl: 'https://openrouter.ai/api/v1',
      model: '',
      protocol: 'chat-completions',
      responseFormat: 'json_object',
      enabled: false,
      monthlyBudget: 20,
      dailyLimit: 20,
    };
    const usage: Usage = { month: '2026-11', cost: 0, inputTokens: 0, outputTokens: 0, analyzedToday: 0 };
    const zhHtml = renderToStaticMarkup(
      createElement(
        I18nContext.Provider,
        { value: { language: 'zh', setLanguage: () => {}, t: (zh: string, en?: string) => translate(zh, 'zh', en) } },
        createElement(AiSettings, { settings, onChange: () => {}, usage, notify: () => {}, reload: async () => {} }),
      ),
    );
    expect(zhHtml).toContain('https://openrouter.ai/keys');
    expect(zhHtml).toContain('OpenRouter 以 :free 结尾的模型 ID 可免费使用。');

    const enHtml = renderToStaticMarkup(
      createElement(
        I18nContext.Provider,
        { value: { language: 'en', setLanguage: () => {}, t: (zh: string, en?: string) => translate(zh, 'en', en) } },
        createElement(AiSettings, { settings, onChange: () => {}, usage, notify: () => {}, reload: async () => {} }),
      ),
    );
    expect(enHtml).toContain('https://openrouter.ai/keys');
    expect(enHtml).toContain('OpenRouter model IDs ending in :free are free to use.');
  });

  it('renders 8 provider tabs nicely', () => {
    const html = renderSettings('gemini', 'zh');
    for (const p of PROVIDERS) {
      if (p === 'custom') {
        expect(html).toContain('自定义');
      } else {
        expect(html).toContain(PROVIDER_METADATA[p].name);
      }
    }
  });
});

describe('runtime network endpoint and models probe calls for new providers', () => {
  const fakeKey = 'fake-provider-test-key-12345';
  const validOutput = {
    bullets: ['Point 1'],
    relevance: 'Relevant to goals',
    topics: ['ai'],
    references: ['https://example.com/source'],
  };

  it.each([
    ['gemini', 'gemini-3.8-flash', 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', 'json_schema'],
    ['groq', 'openai/gpt-oss-120b', 'https://api.groq.com/openai/v1/chat/completions', 'json_object'],
    ['nvidia', 'deepseek-ai/deepseek-v4-flash', 'https://integrate.api.nvidia.com/v1/chat/completions', 'none'],
    ['cerebras', 'gpt-oss-120b', 'https://api.cerebras.ai/v1/chat/completions', 'json_object'],
  ] as const)('calls official endpoint for %s without thinking param', async (provider, model, endpoint, responseFormat) => {
    const meta = PROVIDER_METADATA[provider];
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [{ message: { content: JSON.stringify(validOutput) } }],
          usage: { prompt_tokens: 100, completion_tokens: 50 },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const config: ProviderConfig = {
      provider,
      model,
      baseUrl: meta.baseUrl,
      protocol: 'chat-completions',
      responseFormat: meta.responseFormat,
      enabled: true,
      monthlyBudget: 20,
      dailyLimit: 20,
    };

    const result = await callModel(config, fakeKey, 'Summarize this source', false);
    expect(result.text).toBe(JSON.stringify(validOutput));
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [callUrl, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(callUrl).toBe(endpoint);
    expect((options.headers as Record<string, string>).Authorization).toBe(`Bearer ${fakeKey}`);

    const body = JSON.parse(String(options.body));
    expect(body.model).toBe(model);
    // Verified: thinking is NOT sent to new providers
    expect(body.thinking).toBeUndefined();
    expect(body.reasoning_effort).toBeUndefined();

    // Verify response format
    if (responseFormat === 'none') {
      expect(body.response_format).toBeUndefined();
    } else if (responseFormat === 'json_schema') {
      expect(body.response_format?.type).toBe('json_schema');
    } else {
      expect(body.response_format?.type).toBe('json_object');
    }

    vi.unstubAllGlobals();
  });

  it.each([
    ['gemini', 'https://generativelanguage.googleapis.com/v1beta/openai/models'],
    ['groq', 'https://api.groq.com/openai/v1/models'],
    ['nvidia', 'https://integrate.api.nvidia.com/v1/models'],
    ['cerebras', 'https://api.cerebras.ai/v1/models'],
  ] as const)('probes models endpoint for %s at %s', async (provider, expectedUrl) => {
    const meta = PROVIDER_METADATA[provider];
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: [{ id: meta.defaultModel }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const config: ProviderConfig = {
      provider,
      model: meta.defaultModel,
      baseUrl: meta.baseUrl,
      protocol: 'chat-completions',
      responseFormat: meta.responseFormat,
      enabled: true,
      monthlyBudget: 20,
      dailyLimit: 20,
    };

    const probe = await probeProviderModels(config, fakeKey);
    expect(probe.reachable).toBe(true);
    expect(probe.status).toBe(200);
    expect(probe.modelListed).toBe(true);

    const [callUrl, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(callUrl).toBe(expectedUrl);
    expect(options.method).toBe('GET');
    expect((options.headers as Record<string, string>).Authorization).toBe(`Bearer ${fakeKey}`);

    vi.unstubAllGlobals();
  });
});
