import { browser } from 'wxt/browser';
import {
  DEFAULT_SETTINGS,
  PROVIDERS,
  type ExtensionSettings,
  type McpServerSettings,
  type ModelCapabilities,
  type ProviderCredential,
} from '@/types/settings';

const SETTINGS_KEY = 'settings';
const SETTINGS_PATCH_MESSAGE = 'pagetrove:save-settings-patch';
let localSaveQueue = Promise.resolve();

interface SettingsPatchMessage {
  type: typeof SETTINGS_PATCH_MESSAGE;
  patch: Partial<ExtensionSettings>;
}

function isSettingsPatchMessage(value: unknown): value is SettingsPatchMessage {
  return (
    typeof value === 'object' &&
    value !== null &&
    Reflect.get(value, 'type') === SETTINGS_PATCH_MESSAGE &&
    typeof Reflect.get(value, 'patch') === 'object' &&
    Reflect.get(value, 'patch') !== null
  );
}

/** storage.local 属于外部输入；限制尺寸，避免脏数据进入请求和 MCP 边界。 */
export const SETTINGS_LIMITS = {
  providerLength: 100,
  apiKeyLength: 8_192,
  baseUrlLength: 8_192,
  modelLength: 500,
  minContentLength: 1_000,
  maxContentLength: 200_000,
  modelCapabilities: 500,
  modelCapabilityKeyLength: 600,
  modelPoolModels: 50,
  providerCredentials: 50,
  mcpServers: 50,
  mcpServerIdLength: 128,
  mcpServerNameLength: 200,
  mcpServerUrlLength: 8_192,
  mcpBearerTokenLength: 8_192,
  mcpHeadersJsonLength: 20_000,
  disabledTools: 200,
  toolNameLength: 200,
} as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readString(
  value: unknown,
  maxLength: number,
  options: { allowEmpty?: boolean; trim?: boolean } = {},
): string | undefined {
  if (typeof value !== 'string') return undefined;
  if (value.length > maxLength) return undefined;
  const text = options.trim === false ? value : value.trim();
  if (!options.allowEmpty && text.length === 0) return undefined;
  return text;
}

function readHttpUrl(
  value: unknown,
  maxLength: number,
  allowEmpty = false,
): string | undefined {
  const text = readString(value, maxLength, { allowEmpty });
  if (text === undefined || text === '') return text;
  try {
    const url = new URL(text);
    return url.protocol === 'http:' || url.protocol === 'https:' ? text : undefined;
  } catch {
    return undefined;
  }
}

function cloneCapabilities(
  capabilities: Record<string, ModelCapabilities>,
): Record<string, ModelCapabilities> {
  return Object.fromEntries(
    Object.entries(capabilities).map(([key, value]) => [key, { ...value }]),
  );
}

function cloneMcpServers(servers: McpServerSettings[]): McpServerSettings[] {
  return servers.map((server) => ({
    ...server,
    disabledTools: [...server.disabledTools],
  }));
}

function cloneModelPool(pool: Record<string, string[]>): Record<string, string[]> {
  return Object.fromEntries(Object.entries(pool).map(([key, value]) => [key, [...value]]));
}

function cloneProviderCredentials(
  credentials: Record<string, ProviderCredential>,
): Record<string, ProviderCredential> {
  return Object.fromEntries(
    Object.entries(credentials).map(([key, value]) => [key, { ...value }]),
  );
}

function isKnownProvider(id: string): boolean {
  return PROVIDERS.some((preset) => preset.id === id);
}

function decodeModelPool(
  value: unknown,
  fallback: Record<string, string[]>,
): Record<string, string[]> {
  // 字段缺失视为旧版数据：返回空池，由 decodeSettings 兜底补入当前生效模型。
  if (value === undefined) return {};
  if (!isRecord(value)) return cloneModelPool(fallback);

  const entries: [string, string[]][] = [];
  for (const rawKey in value) {
    if (!Object.hasOwn(value, rawKey)) continue;
    if (!isKnownProvider(rawKey)) continue;
    const rawModels = value[rawKey];
    if (!Array.isArray(rawModels)) continue;
    const models = [
      ...new Set(
        rawModels
          .slice(0, SETTINGS_LIMITS.modelPoolModels)
          .map((model) => readString(model, SETTINGS_LIMITS.modelLength))
          .filter((model): model is string => model !== undefined),
      ),
    ];
    if (models.length > 0) entries.push([rawKey, models]);
  }
  return Object.fromEntries(entries);
}

function decodeProviderCredentials(
  value: unknown,
  fallback: Record<string, ProviderCredential>,
): Record<string, ProviderCredential> {
  if (!isRecord(value)) return cloneProviderCredentials(fallback);

  const entries: [string, ProviderCredential][] = [];
  let inspected = 0;
  for (const rawKey in value) {
    if (!Object.hasOwn(value, rawKey)) continue;
    inspected += 1;
    if (inspected > SETTINGS_LIMITS.providerCredentials) break;
    if (!isKnownProvider(rawKey)) continue;
    const raw = value[rawKey];
    if (!isRecord(raw)) continue;
    const apiKey =
      readString(raw.apiKey, SETTINGS_LIMITS.apiKeyLength, { allowEmpty: true }) ?? '';
    const baseUrl = readHttpUrl(raw.baseUrl, SETTINGS_LIMITS.baseUrlLength, true) ?? '';
    entries.push([rawKey, { apiKey, baseUrl }]);
  }
  return Object.fromEntries(entries);
}

function decodeModelCapabilities(
  value: unknown,
  fallback: Record<string, ModelCapabilities>,
): Record<string, ModelCapabilities> {
  if (!isRecord(value)) return cloneCapabilities(fallback);

  const entries: [string, ModelCapabilities][] = [];
  let inspected = 0;
  for (const rawKey in value) {
    if (!Object.hasOwn(value, rawKey)) continue;
    inspected += 1;
    if (inspected > SETTINGS_LIMITS.modelCapabilities) break;

    const key = readString(rawKey, SETTINGS_LIMITS.modelCapabilityKeyLength);
    const capabilities = value[rawKey];
    if (!key || !isRecord(capabilities)) continue;
    entries.push([
      key,
      {
        vision: capabilities.vision === true,
        tools: capabilities.tools === true,
      },
    ]);
  }
  return Object.fromEntries(entries);
}

function decodeDisabledTools(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const tools = value
    .slice(0, SETTINGS_LIMITS.disabledTools)
    .map((tool) => readString(tool, SETTINGS_LIMITS.toolNameLength))
    .filter((tool): tool is string => tool !== undefined);
  return [...new Set(tools)];
}

function decodeMcpServer(value: unknown): McpServerSettings | undefined {
  if (!isRecord(value)) return undefined;

  const id = readString(value.id, SETTINGS_LIMITS.mcpServerIdLength);
  const name = readString(value.name, SETTINGS_LIMITS.mcpServerNameLength);
  const url = readHttpUrl(value.url, SETTINGS_LIMITS.mcpServerUrlLength);
  if (!id || !name || !url) return undefined;

  const validTransport =
    value.transport === 'streamable-http' || value.transport === 'sse';
  const server: McpServerSettings = {
    id,
    name,
    url,
    transport:
      value.transport === 'streamable-http' || value.transport === 'sse'
        ? value.transport
        : 'streamable-http',
    // 缺失/非法协议或 enabled 不会把外部记录静默变成已启用远端服务。
    enabled: value.enabled === true && (value.transport === undefined || validTransport),
    disabledTools: decodeDisabledTools(value.disabledTools),
  };

  const bearerToken = readString(
    value.bearerToken,
    SETTINGS_LIMITS.mcpBearerTokenLength,
    { allowEmpty: true },
  );
  if (bearerToken) server.bearerToken = bearerToken;

  const headersJson = readString(
    value.headersJson,
    SETTINGS_LIMITS.mcpHeadersJsonLength,
    { allowEmpty: true, trim: false },
  );
  if (headersJson) server.headersJson = headersJson;

  return server;
}

function decodeMcpServers(
  value: unknown,
  fallback: McpServerSettings[],
): McpServerSettings[] {
  if (!Array.isArray(value)) return cloneMcpServers(fallback);

  const result: McpServerSettings[] = [];
  const ids = new Set<string>();
  for (const raw of value.slice(0, SETTINGS_LIMITS.mcpServers)) {
    const server = decodeMcpServer(raw);
    if (!server || ids.has(server.id)) continue;
    ids.add(server.id);
    result.push(server);
  }
  return result;
}

function readContentLength(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(
    SETTINGS_LIMITS.maxContentLength,
    Math.max(SETTINGS_LIMITS.minContentLength, Math.round(value)),
  );
}

/**
 * 将 storage、备份或运行时传入的未知值解码为完整设置。
 * 未知字段不会透传；无效字段使用可信 fallback，嵌套结构始终重新构造。
 */
export function decodeSettings(
  value: unknown,
  fallback: ExtensionSettings = DEFAULT_SETTINGS,
): ExtensionSettings {
  if (!isRecord(value)) {
    return {
      ...fallback,
      modelCapabilities: cloneCapabilities(fallback.modelCapabilities),
      modelPool: cloneModelPool(fallback.modelPool),
      providerCredentials: cloneProviderCredentials(fallback.providerCredentials),
      mcpServers: cloneMcpServers(fallback.mcpServers),
    };
  }

  const apiKey = readString(value.apiKey, SETTINGS_LIMITS.apiKeyLength, {
    allowEmpty: true,
  });
  const legacyApiKey = readString(value.deepseekApiKey, SETTINGS_LIMITS.apiKeyLength, {
    allowEmpty: true,
  });
  const requestedProvider = readString(value.provider, SETTINGS_LIMITS.providerLength);
  const preset = PROVIDERS.find((item) => item.id === requestedProvider);
  const legacyBaseUrl = readHttpUrl(value.deepseekBaseUrl, SETTINGS_LIMITS.baseUrlLength);
  const legacyMode =
    !preset && (legacyApiKey !== undefined || legacyBaseUrl !== undefined);
  const provider = legacyMode ? 'deepseek' : (preset?.id ?? fallback.provider);
  const providerPreset = PROVIDERS.find((item) => item.id === provider);
  const customBaseUrl = readHttpUrl(value.baseUrl, SETTINGS_LIMITS.baseUrlLength, true);
  const baseUrl = legacyMode
    ? (legacyBaseUrl ??
      PROVIDERS.find((item) => item.id === 'deepseek')?.baseUrl ??
      fallback.baseUrl)
    : provider === 'custom'
      ? (customBaseUrl ?? fallback.baseUrl)
      : (providerPreset?.baseUrl ?? fallback.baseUrl);

  const settings: ExtensionSettings = {
    provider,
    // 兼容旧字段：新字段只有在非空且有效时优先；空值沿用旧版迁移语义。
    apiKey: (apiKey ? apiKey : legacyApiKey) ?? apiKey ?? fallback.apiKey,
    baseUrl,
    model:
      readString(value.model, SETTINGS_LIMITS.modelLength, {
        allowEmpty: true,
      }) ?? fallback.model,
    modelPool: decodeModelPool(value.modelPool, fallback.modelPool),
    providerCredentials: decodeProviderCredentials(
      value.providerCredentials,
      fallback.providerCredentials,
    ),
    maxContentLength: readContentLength(
      value.maxContentLength,
      fallback.maxContentLength,
    ),
    includeSelectedText:
      typeof value.includeSelectedText === 'boolean'
        ? value.includeSelectedText
        : fallback.includeSelectedText,
    modelCapabilities: decodeModelCapabilities(
      value.modelCapabilities,
      fallback.modelCapabilities,
    ),
    mcpServers: decodeMcpServers(value.mcpServers, fallback.mcpServers),
    mcpVerboseLog:
      typeof value.mcpVerboseLog === 'boolean'
        ? value.mcpVerboseLog
        : fallback.mcpVerboseLog,
  };

  // 旧数据没有 modelPool；保证当前生效模型始终出现在池中。
  const activeModel = settings.model.trim();
  if (activeModel && isKnownProvider(settings.provider)) {
    const models = settings.modelPool[settings.provider] ?? [];
    if (!models.includes(activeModel)) {
      settings.modelPool = {
        ...settings.modelPool,
        [settings.provider]: [activeModel, ...models].slice(
          0,
          SETTINGS_LIMITS.modelPoolModels,
        ),
      };
    }
  }
  return settings;
}

export async function getSettings(): Promise<ExtensionSettings> {
  const result = await browser.storage.local.get(SETTINGS_KEY);
  return decodeSettings(result[SETTINGS_KEY]);
}

export async function saveSettings(
  patch: Partial<ExtensionSettings>,
): Promise<ExtensionSettings> {
  try {
    const result = await browser.runtime.sendMessage({
      type: SETTINGS_PATCH_MESSAGE,
      patch,
    } satisfies SettingsPatchMessage);
    if (result !== undefined) return decodeSettings(result);
  } catch {
    // background 未激活或测试环境没有 listener 时使用本上下文队列。
  }
  return enqueueSettingsPatch(patch);
}

/** background 单写者与测试 fallback 共用的原子补丁逻辑。 */
export function enqueueSettingsPatch(
  patch: Partial<ExtensionSettings>,
): Promise<ExtensionSettings> {
  const task = localSaveQueue.then(() => saveSettingsDirect(patch));
  localSaveQueue = task.then(
    () => undefined,
    () => undefined,
  );
  return task;
}

export function registerSettingsPatchWriter(): () => void {
  const listener = (message: unknown) => {
    if (!isSettingsPatchMessage(message)) return;
    return enqueueSettingsPatch(message.patch);
  };
  browser.runtime.onMessage.addListener(listener);
  return () => browser.runtime.onMessage.removeListener(listener);
}

async function saveSettingsDirect(
  patch: Partial<ExtensionSettings>,
): Promise<ExtensionSettings> {
  const current = await getSettings();
  let next = decodeSettings({ ...current, ...patch }, current);
  const endpointChanged =
    next.provider !== current.provider ||
    next.baseUrl.replace(/\/$/, '') !== current.baseUrl.replace(/\/$/, '');
  if (endpointChanged && patch.apiKey === undefined) {
    next = { ...next, apiKey: '' };
  }
  await browser.storage.local.set({ [SETTINGS_KEY]: next });
  return next;
}
