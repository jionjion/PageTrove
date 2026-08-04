/** OpenAI 兼容接口的供应商预设 */
export interface ProviderPreset {
  id: string;
  label: string;
  baseUrl: string;
  models: string[];
  /** API Key 申请地址（展示用） */
  keySite?: string;
}

export interface ModelCapabilities {
  vision: boolean;
  tools: boolean;
}

export type McpTransport = 'streamable-http' | 'sse';

export interface McpServerSettings {
  id: string;
  name: string;
  url: string;
  transport: McpTransport;
  enabled: boolean;
  bearerToken?: string;
  /** 额外请求头，使用 JSON 对象文本保存，便于兼容不同网关。 */
  headersJson?: string;
  /** 未列出的新工具默认启用；这里只保存用户明确禁用的工具名。 */
  disabledTools: string[];
}

export const PROVIDERS: ProviderPreset[] = [
  {
    id: 'qwen',
    label: '通义千问',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    models: ['qwen3.7-plus', 'qwen3.7-max'],
    keySite: 'bailian.console.aliyun.com',
  },
  {
    id: 'deepseek',
    label: '深度求索',
    baseUrl: 'https://api.deepseek.com',
    models: ['deepseek-v4-flash', 'deepseek-v4-pro'],
    keySite: 'platform.deepseek.com',
  },
  {
    id: 'kimi',
    label: '月之暗面',
    baseUrl: 'https://api.moonshot.cn/v1',
    models: ['kimi-k3'],
    keySite: 'platform.kimi.ai',
  },
  {
    id: 'zhipu',
    label: '智谱',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    models: ['glm-5.2'],
    keySite: 'open.bigmodel.cn',
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
  /** 以 provider::model 为键，分别保存每个模型的能力覆盖值。 */
  modelCapabilities: Record<string, ModelCapabilities>;
  mcpServers: McpServerSettings[];
  /** MCP 工具执行时是否打印详细日志（工具名称、参数、结果） */
  mcpVerboseLog: boolean;
}

const BUILTIN_MODEL_CAPABILITIES: Record<string, ModelCapabilities> = {
  'qwen::qwen3.7-plus': { vision: true, tools: true },
  'qwen::qwen3.7-max': { vision: false, tools: true },
  'deepseek::deepseek-v4-flash': { vision: false, tools: true },
  'deepseek::deepseek-v4-pro': { vision: false, tools: true },
  'kimi::kimi-k3': { vision: true, tools: true },
  'zhipu::glm-5.2': { vision: true, tools: true },
};

export function modelCapabilityKey(provider: string, model: string): string {
  return `${provider}::${model}`;
}

export function getModelCapabilities(
  settings: Pick<ExtensionSettings, 'provider' | 'model' | 'modelCapabilities'>,
  model = settings.model,
): ModelCapabilities {
  const key = modelCapabilityKey(settings.provider, model);
  return (
    settings.modelCapabilities[key] ??
    BUILTIN_MODEL_CAPABILITIES[key] ?? { vision: false, tools: false }
  );
}

export const DEFAULT_SETTINGS: ExtensionSettings = {
  provider: 'qwen',
  apiKey: '',
  baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  model: 'qwen3.7-plus',

  maxContentLength: 12_000,
  includeSelectedText: true,
  modelCapabilities: {},
  mcpServers: [],
  mcpVerboseLog: true,
};
