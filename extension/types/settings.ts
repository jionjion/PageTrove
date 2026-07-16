/** OpenAI 兼容接口的供应商预设 */
export interface ProviderPreset {
  id: string;
  label: string;
  baseUrl: string;
  models: string[];
  /** API Key 申请地址（展示用） */
  keySite?: string;
}

export const PROVIDERS: ProviderPreset[] = [
  {
    id: 'deepseek',
    label: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com',
    models: ['deepseek-chat', 'deepseek-reasoner'],
    keySite: 'platform.deepseek.com',
  },
  {
    id: 'kimi',
    label: 'Kimi（月之暗面）',
    baseUrl: 'https://api.moonshot.cn/v1',
    models: ['kimi-latest', 'moonshot-v1-8k', 'moonshot-v1-32k'],
    keySite: 'platform.moonshot.cn',
  },
  {
    id: 'zhipu',
    label: '智谱 GLM',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    models: ['glm-4-flash', 'glm-4-air', 'glm-4-plus'],
    keySite: 'open.bigmodel.cn',
  },
  {
    id: 'qwen',
    label: '通义千问',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    models: ['qwen-plus', 'qwen-turbo', 'qwen-max'],
    keySite: 'bailian.console.aliyun.com',
  },
  {
    id: 'openai',
    label: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    models: ['gpt-4o-mini', 'gpt-4o'],
    keySite: 'platform.openai.com',
  },
  {
    id: 'custom',
    label: '自定义（OpenAI 兼容接口）',
    baseUrl: '',
    models: [],
  },
];

export interface ExtensionSettings {
  provider: string;
  apiKey: string;
  baseUrl: string;
  model: string;

  maxContentLength: number;
  includeSelectedText: boolean;
}

export const DEFAULT_SETTINGS: ExtensionSettings = {
  provider: 'deepseek',
  apiKey: '',
  baseUrl: 'https://api.deepseek.com',
  model: 'deepseek-chat',

  maxContentLength: 12_000,
  includeSelectedText: true,
};
