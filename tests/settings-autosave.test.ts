import { describe, expect, it } from 'vitest';
import {
  buildSettingsSavePlan,
  settingsSaveSignature,
} from '@/services/settings-autosave';
import { SETTINGS_LIMITS } from '@/services/settings-store';
import {
  DEFAULT_SETTINGS,
  type ExtensionSettings,
  type McpServerSettings,
} from '@/types/settings';

function makeSettings(overrides: Partial<ExtensionSettings> = {}): ExtensionSettings {
  return {
    ...DEFAULT_SETTINGS,
    provider: 'deepseek',
    apiKey: 'sk-test',
    baseUrl: 'https://api.deepseek.com',
    model: 'deepseek-v4-flash',
    ...overrides,
  };
}

function makeServer(overrides: Partial<McpServerSettings> = {}): McpServerSettings {
  return {
    id: 'server-1',
    name: '测试服务',
    url: 'https://mcp.example.com',
    transport: 'streamable-http',
    enabled: true,
    disabledTools: [],
    ...overrides,
  };
}

describe('buildSettingsSavePlan', () => {
  it('同步当前供应商凭据并始终携带 apiKey', () => {
    const settings = makeSettings({
      providerCredentials: {
        qwen: { apiKey: 'old', baseUrl: 'https://old.example.com' },
      },
    });
    const { patch, invalidMcpServers } = buildSettingsSavePlan(settings);

    expect(invalidMcpServers).toEqual([]);
    expect(patch.apiKey).toBe('sk-test');
    expect(patch.providerCredentials).toEqual({
      qwen: { apiKey: 'old', baseUrl: 'https://old.example.com' },
      deepseek: { apiKey: 'sk-test', baseUrl: 'https://api.deepseek.com' },
    });
  });

  it('服务合法时包含 mcpServers', () => {
    const server = makeServer();
    const { patch } = buildSettingsSavePlan(makeSettings({ mcpServers: [server] }));
    expect(patch.mcpServers).toEqual([server]);
  });

  it('任一服务 URL 非法时省略 mcpServers，保留其他设置', () => {
    const { patch, invalidMcpServers } = buildSettingsSavePlan(
      makeSettings({
        mcpServers: [
          makeServer({ id: 'ok' }),
          makeServer({ id: 'bad', name: '坏服务', url: 'not-a-url' }),
        ],
      }),
    );

    expect(patch).not.toHaveProperty('mcpServers');
    expect(patch.model).toBe('deepseek-v4-flash');
    expect(invalidMcpServers).toHaveLength(1);
    expect(invalidMcpServers[0]).toMatchObject({ id: 'bad', name: '坏服务' });
  });

  it('停用但非法的服务同样阻止持久化', () => {
    const { patch, invalidMcpServers } = buildSettingsSavePlan(
      makeSettings({
        mcpServers: [makeServer({ enabled: false, url: 'ftp://bad.example.com' })],
      }),
    );
    expect(patch).not.toHaveProperty('mcpServers');
    expect(invalidMcpServers).toHaveLength(1);
  });

  it('重复 id 与超长凭据被识别，且警告不泄露敏感值', () => {
    const server = makeServer({
      id: 'dup',
      url: 'not-a-url',
      bearerToken: 'secret-token-value',
      headersJson: '{"X-Secret":"header-secret-value"}',
    });
    const { invalidMcpServers } = buildSettingsSavePlan(
      makeSettings({ mcpServers: [server, { ...server, name: '重复服务' }] }),
    );

    expect(invalidMcpServers.some((issue) => issue.message === '服务标识重复')).toBe(
      true,
    );
    const text = invalidMcpServers.map((issue) => issue.message).join('\n');
    expect(text).not.toContain('secret-token-value');
    expect(text).not.toContain('header-secret-value');
  });

  it('超过长度上限的 Token 阻止持久化', () => {
    const { patch, invalidMcpServers } = buildSettingsSavePlan(
      makeSettings({
        mcpServers: [
          makeServer({
            bearerToken: 'x'.repeat(SETTINGS_LIMITS.mcpBearerTokenLength + 1),
          }),
        ],
      }),
    );
    expect(patch).not.toHaveProperty('mcpServers');
    expect(invalidMcpServers.some((issue) => issue.message === 'Bearer Token 过长')).toBe(
      true,
    );
  });
});

describe('settingsSaveSignature', () => {
  it('对象键顺序不影响签名', () => {
    const first = makeSettings({
      providerCredentials: {
        qwen: { apiKey: 'a', baseUrl: 'https://qwen.example.com' },
        kimi: { apiKey: 'b', baseUrl: 'https://kimi.example.com' },
      },
    });
    const second = makeSettings({
      providerCredentials: {
        kimi: { apiKey: 'b', baseUrl: 'https://kimi.example.com' },
        qwen: { apiKey: 'a', baseUrl: 'https://qwen.example.com' },
      },
    });

    expect(settingsSaveSignature(buildSettingsSavePlan(first))).toBe(
      settingsSaveSignature(buildSettingsSavePlan(second)),
    );
  });

  it('MCP 非法时继续编辑 MCP 文本不会改变签名', () => {
    const first = makeSettings({
      mcpServers: [makeServer({ url: 'not-a-url' })],
    });
    const second = makeSettings({
      mcpServers: [makeServer({ url: 'still-not-a-url' })],
    });

    expect(settingsSaveSignature(buildSettingsSavePlan(first))).toBe(
      settingsSaveSignature(buildSettingsSavePlan(second)),
    );
  });

  it('其他设置变化会改变签名', () => {
    const first = buildSettingsSavePlan(makeSettings());
    const second = buildSettingsSavePlan(makeSettings({ apiKey: 'sk-other' }));
    expect(settingsSaveSignature(first)).not.toBe(settingsSaveSignature(second));
  });
});
