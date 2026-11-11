import { validateMcpServer } from '@/services/mcp-client';
import { SETTINGS_LIMITS } from '@/services/settings-store';
import type { ExtensionSettings, McpServerSettings } from '@/types/settings';

export interface McpSettingsIssue {
  id: string;
  name: string;
  message: string;
}

export interface SettingsSavePlan {
  patch: Partial<ExtensionSettings>;
  /** 任一问题存在时 patch 不包含 mcpServers，避免解码器丢弃已存服务。 */
  invalidMcpServers: McpSettingsIssue[];
}

function inspectMcpServers(servers: McpServerSettings[]): McpSettingsIssue[] {
  const issues: McpSettingsIssue[] = [];
  if (servers.length > SETTINGS_LIMITS.mcpServers) {
    issues.push({
      id: '',
      name: 'MCP 服务',
      message: `最多只能保存 ${SETTINGS_LIMITS.mcpServers} 个服务`,
    });
  }

  const ids = new Set<string>();
  for (const server of servers) {
    const name = server.name?.trim() || '未命名服务';
    const report = (message: string) => {
      issues.push({ id: server.id ?? '', name, message });
    };

    if (!server.id || !server.id.trim()) {
      report('缺少服务标识');
      continue;
    }
    if (server.id.length > SETTINGS_LIMITS.mcpServerIdLength) {
      report('服务标识过长');
    }
    if (ids.has(server.id)) {
      report('服务标识重复');
    }
    ids.add(server.id);

    if ((server.bearerToken?.length ?? 0) > SETTINGS_LIMITS.mcpBearerTokenLength) {
      report('Bearer Token 过长');
    }
    if ((server.headersJson?.length ?? 0) > SETTINGS_LIMITS.mcpHeadersJsonLength) {
      report('自定义请求头内容过长');
    }

    try {
      validateMcpServer(server);
    } catch (error) {
      report(error instanceof Error ? error.message : '配置无效');
    }
  }

  return issues;
}

/**
 * 生成自动保存的完整快照。
 * - 始终携带 apiKey，避免 settings-store 在 endpoint 变化时清空 Key。
 * - MCP 服务全部可持久化时才写入；否则省略该键，保留 storage 中的上一版。
 */
export function buildSettingsSavePlan(settings: ExtensionSettings): SettingsSavePlan {
  const invalidMcpServers = inspectMcpServers(settings.mcpServers);

  const patch: Partial<ExtensionSettings> = {
    provider: settings.provider,
    apiKey: settings.apiKey,
    baseUrl: settings.baseUrl,
    model: settings.model,
    modelPool: settings.modelPool,
    providerCredentials: {
      ...settings.providerCredentials,
      [settings.provider]: { apiKey: settings.apiKey, baseUrl: settings.baseUrl },
    },
    maxContentLength: settings.maxContentLength,
    includeSelectedText: settings.includeSelectedText,
    modelCapabilities: settings.modelCapabilities,
    mcpVerboseLog: settings.mcpVerboseLog,
  };
  if (invalidMcpServers.length === 0) {
    patch.mcpServers = settings.mcpServers;
  }

  return { patch, invalidMcpServers };
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value) ?? 'null';
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }
  const record = value as Record<string, unknown>;
  const entries = Object.keys(record)
    .sort()
    .filter((key) => record[key] !== undefined)
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`);
  return `{${entries.join(',')}}`;
}

/** 基于实际发送 patch 的稳定签名；对象键顺序不影响结果，数组顺序保留。 */
export function settingsSaveSignature(plan: SettingsSavePlan): string {
  return stableStringify(plan.patch);
}
