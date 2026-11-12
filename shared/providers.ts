import type { Provider } from './types';

export interface ProviderMeta {
  id: Provider;
  name: string;
  baseUrl: string;
  protocol: 'responses' | 'chat-completions';
  defaultModel: string;
  model: string;
  models: string[];
  keyUrl?: string;
  freeTier?: {
    zh: string;
    en: string;
  };
  responseFormat: 'json_schema' | 'json_object' | 'none';
  reasoningEffort?: string;
  modelHelp: {
    zh: string;
    en: string;
  };
}

export const PROVIDERS: Provider[] = [
  'openai',
  'deepseek',
  'glm',
  'gemini',
  'groq',
  'nvidia',
  'cerebras',
  'custom',
];

export const PRESET_PROVIDERS = [
  'openai',
  'deepseek',
  'glm',
  'gemini',
  'groq',
  'nvidia',
  'cerebras',
] as const;

export type PresetProvider = typeof PRESET_PROVIDERS[number];

export const PROVIDER_METADATA: Record<Provider, ProviderMeta> = {
  openai: {
    id: 'openai',
    name: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    protocol: 'responses',
    defaultModel: 'gpt-6.1-sol',
    model: 'gpt-6.1-sol',
    models: ['gpt-6.1-sol', 'gpt-6.1-terra', 'gpt-6-luna', 'gpt-6-astra'],
    keyUrl: 'https://platform.openai.com/api-keys',
    responseFormat: 'json_schema',
    reasoningEffort: 'low',
    modelHelp: {
      zh: '连接现有 OpenAI API Key，默认 gpt-6.1-sol。',
      en: 'Connect an existing OpenAI API key. The default model is gpt-6.1-sol.',
    },
  },
  deepseek: {
    id: 'deepseek',
    name: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com',
    protocol: 'chat-completions',
    defaultModel: 'deepseek-flash',
    model: 'deepseek-flash',
    models: ['deepseek-flash', 'deepseek-v4-pro'],
    keyUrl: 'https://platform.deepseek.com/api_keys',
    responseFormat: 'json_object',
    modelHelp: {
      zh: '使用 DeepSeek 官方 API。内置模型费率用于本站预算估算。',
      en: 'Uses the official DeepSeek API. Built-in model rates are used for budget estimates.',
    },
  },
  glm: {
    id: 'glm',
    name: 'GLM',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    protocol: 'chat-completions',
    defaultModel: 'glm-5.3',
    model: 'glm-5.3',
    models: ['glm-5.3', 'glm-5.3-flash', 'glm-5.3-flashx'],
    keyUrl: 'https://open.bigmodel.cn/usercenter/apikeys',
    responseFormat: 'json_object',
    modelHelp: {
      zh: '使用模型标准 API Key；Coding Plan 密钥和接口不互通。',
      en: 'Use a standard model API key. Coding Plan keys and endpoints are separate.',
    },
  },
  gemini: {
    id: 'gemini',
    name: 'Google AI Studio (Gemini)',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    protocol: 'chat-completions',
    defaultModel: 'gemini-3.8-flash',
    model: 'gemini-3.8-flash',
    models: ['gemini-3.8-flash', 'gemini-3.5-flash-lite', 'gemini-3.1-flash-lite'],
    keyUrl: 'https://aistudio.google.com/apikey',
    freeTier: {
      zh: '免费层可用 Flash / Flash-Lite 模型，按项目限速；免费层数据可能被用于改进 Google 产品。Gemini 4 不在免费层。',
      en: 'Free tier covers Flash / Flash-Lite models with per-project rate limits; free-tier data may be used to improve Google products. Gemini 4 is not on the free tier.',
    },
    responseFormat: 'json_schema',
    modelHelp: {
      zh: '使用 Google AI Studio 官方接口，支持 Flash 系列模型。',
      en: 'Uses Google AI Studio official endpoint, supporting Flash models.',
    },
  },
  groq: {
    id: 'groq',
    name: 'Groq',
    baseUrl: 'https://api.groq.com/openai/v1',
    protocol: 'chat-completions',
    defaultModel: 'openai/gpt-oss-120b',
    model: 'openai/gpt-oss-120b',
    models: ['openai/gpt-oss-120b', 'openai/gpt-oss-20b', 'qwen/qwen3.8-27b'],
    keyUrl: 'https://console.groq.com/keys',
    freeTier: {
      zh: '免费计划约 30 次/分钟、1,000 次/天（以控制台 Limits 为准）。',
      en: 'Free plan is about 30 requests/min and 1,000/day (see console Limits).',
    },
    responseFormat: 'json_object',
    modelHelp: {
      zh: '使用 Groq 官方高速推理接口，支持开源大模型。',
      en: 'Uses Groq official high-speed inference endpoint, supporting open models.',
    },
  },
  nvidia: {
    id: 'nvidia',
    name: 'NVIDIA NIM',
    baseUrl: 'https://integrate.api.nvidia.com/v1',
    protocol: 'chat-completions',
    defaultModel: 'deepseek-ai/deepseek-v4-flash',
    model: 'deepseek-ai/deepseek-v4-flash',
    models: ['deepseek-ai/deepseek-v4-flash', 'nvidia/nemotron-3-super-120b-a12b', 'openai/gpt-oss-120b', 'z-ai/glm-5.3'],
    keyUrl: 'https://build.nvidia.com',
    freeTier: {
      zh: '加入 NVIDIA Developer Program 后可免费用于开发测试，有速率限制。在模型页点「Get API Key」获取。',
      en: 'Free for development with the NVIDIA Developer Program, rate limited. Use "Get API Key" on a model page.',
    },
    responseFormat: 'none',
    modelHelp: {
      zh: '使用 NVIDIA NIM 官方接口，开发者计划提供免费测试调用。',
      en: 'Uses NVIDIA NIM official endpoint; Developer Program includes free testing calls.',
    },
  },
  cerebras: {
    id: 'cerebras',
    name: 'Cerebras',
    baseUrl: 'https://api.cerebras.ai/v1',
    protocol: 'chat-completions',
    defaultModel: 'gpt-oss-120b',
    model: 'gpt-oss-120b',
    models: ['gpt-oss-120b', 'qwen-3.8-27b'],
    keyUrl: 'https://cloud.cerebras.ai',
    freeTier: {
      zh: '免费试用约 5 次/分钟、每天 100 万 tokens（以控制台为准）。',
      en: 'Free trial is about 5 requests/min and 1M tokens/day (see console).',
    },
    responseFormat: 'json_object',
    modelHelp: {
      zh: '使用 Cerebras 官方高速推理接口，免费试用提供基础配额。',
      en: 'Uses Cerebras official high-speed inference endpoint with free trial quota.',
    },
  },
  custom: {
    id: 'custom',
    name: 'Custom',
    baseUrl: '',
    protocol: 'chat-completions',
    defaultModel: '',
    model: '',
    models: [],
    responseFormat: 'json_object',
    modelHelp: {
      zh: '模型 ID、接口协议和支持的参数以该服务商文档为准。',
      en: 'Check your provider documentation for model IDs, protocols, and supported parameters.',
    },
  },
};

export const DEFAULT_MODELS: Record<Provider, string> = {
  openai: PROVIDER_METADATA.openai.defaultModel,
  deepseek: PROVIDER_METADATA.deepseek.defaultModel,
  glm: PROVIDER_METADATA.glm.defaultModel,
  gemini: PROVIDER_METADATA.gemini.defaultModel,
  groq: PROVIDER_METADATA.groq.defaultModel,
  nvidia: PROVIDER_METADATA.nvidia.defaultModel,
  cerebras: PROVIDER_METADATA.cerebras.defaultModel,
  custom: '',
};

export const PRESET_BASE_URLS: Record<PresetProvider, string> = {
  openai: PROVIDER_METADATA.openai.baseUrl,
  deepseek: PROVIDER_METADATA.deepseek.baseUrl,
  glm: PROVIDER_METADATA.glm.baseUrl,
  gemini: PROVIDER_METADATA.gemini.baseUrl,
  groq: PROVIDER_METADATA.groq.baseUrl,
  nvidia: PROVIDER_METADATA.nvidia.baseUrl,
  cerebras: PROVIDER_METADATA.cerebras.baseUrl,
};
