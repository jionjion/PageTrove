import { DEFAULT_SHORTCUTS, type ShortcutMap } from '@/types/shortcuts';

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

/** 单个供应商的连接信息（active 供应商同时镜像在扁平字段上）。 */
export interface ProviderCredential {
  apiKey: string;
  baseUrl: string;
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

  /** 各供应商下已配置的模型名集合：provider -> model names。 */
  modelPool: Record<string, string[]>;
  /** 各供应商的连接信息；active 供应商的值以扁平字段为准。 */
  providerCredentials: Record<string, ProviderCredential>;

  maxContentLength: number;
  includeSelectedText: boolean;
  /** 以 provider::model 为键，分别保存每个模型的能力覆盖值。 */
  modelCapabilities: Record<string, ModelCapabilities>;
  mcpServers: McpServerSettings[];
  /** MCP 工具执行时是否打印详细日志（工具名称、参数、结果） */
  mcpVerboseLog: boolean;

  /** 自定义快捷键表;open-panel 另有浏览器级备用键(manifest.commands)。 */
  shortcuts: ShortcutMap;
  /** 快捷键收录后是否自动调用 AI 整理(未配置 Key 时自动跳过)。 */
  shortcutAutoAnalyze: boolean;
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

/** 内置模型的能力基线；用于判断某个模型是否已有可信默认值。 */
export function getBuiltinModelCapabilities(
  provider: string,
  model: string,
): ModelCapabilities | undefined {
  return BUILTIN_MODEL_CAPABILITIES[modelCapabilityKey(provider, model)];
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

/**
 * 把在线模型列表返回的能力提示并入设置。
 * 只补全当前已配置、且没有用户配置或内置基线的模型；返回 undefined 表示无需更新。
 */
export function mergeModelCapabilityHints(
  settings: Pick<
    ExtensionSettings,
    'provider' | 'model' | 'modelPool' | 'modelCapabilities'
  >,
  hints: Record<string, ModelCapabilities>,
): Record<string, ModelCapabilities> | undefined {
  const models = new Set([
    settings.model,
    ...(settings.modelPool[settings.provider] ?? []),
  ]);
  let next: Record<string, ModelCapabilities> | undefined;

  for (const model of models) {
    if (!model) continue;
    const hint = hints[model];
    if (!hint) continue;
    if (getBuiltinModelCapabilities(settings.provider, model)) continue;

    const key = modelCapabilityKey(settings.provider, model);
    if (settings.modelCapabilities[key]) continue;

    next ??= { ...settings.modelCapabilities };
    next[key] = { ...hint };
  }
  return next;
}

export const DEFAULT_SETTINGS: ExtensionSettings = {
  provider: 'qwen',
  apiKey: '',
  baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  model: 'qwen3.7-plus',

  modelPool: { qwen: ['qwen3.7-plus'] },
  providerCredentials: {},

  maxContentLength: 12_000,
  includeSelectedText: true,
  modelCapabilities: {},
  mcpServers: [],
  mcpVerboseLog: true,
  shortcuts: DEFAULT_SHORTCUTS,
  shortcutAutoAnalyze: true,
};
