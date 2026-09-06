import { beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing';
import { browser } from 'wxt/browser';
import {
  decodeSettings,
  getSettings,
  saveSettings,
  SETTINGS_LIMITS,
} from '@/services/settings-store';
import { DEFAULT_SETTINGS, type ExtensionSettings } from '@/types/settings';

const SETTINGS_KEY = 'settings';

describe('getSettings', () => {
  beforeEach(() => {
    fakeBrowser.reset();
  });

  it('空存储时返回默认设置', async () => {
    const settings = await getSettings();
    expect(settings).toEqual(DEFAULT_SETTINGS);
  });

  it('非对象根和未知顶层字段不会进入运行时设置', async () => {
    await browser.storage.local.set({ [SETTINGS_KEY]: 'bad' });
    expect(await getSettings()).toEqual(DEFAULT_SETTINGS);

    await browser.storage.local.set({
      [SETTINGS_KEY]: {
        model: 'kimi-k3',
        unknownSecret: 'do-not-forward',
      },
    });
    const settings = await getSettings();
    expect(settings.model).toBe('kimi-k3');
    expect(settings).not.toHaveProperty('unknownSecret');
  });

  it('存量数据与默认值合并', async () => {
    await browser.storage.local.set({
      [SETTINGS_KEY]: { apiKey: 'sk-test', model: 'deepseek-v4-pro' },
    });
    const settings = await getSettings();
    expect(settings.apiKey).toBe('sk-test');
    expect(settings.model).toBe('deepseek-v4-pro');
    // 未覆盖字段取默认
    expect(settings.provider).toBe(DEFAULT_SETTINGS.provider);
    expect(settings.maxContentLength).toBe(DEFAULT_SETTINGS.maxContentLength);
  });

  it('modelPool 只保留合法供应商键与非空模型名，并去重', async () => {
    await browser.storage.local.set({
      [SETTINGS_KEY]: {
        provider: 'deepseek',
        model: 'deepseek-v4-pro',
        modelPool: {
          deepseek: ['deepseek-v4-pro', 'deepseek-v4-pro', '', 42, 'deepseek-v4-flash'],
          'unknown-provider': ['x'],
          qwen: 'not-array',
        },
      },
    });
    const settings = await getSettings();
    expect(settings.modelPool).toEqual({
      deepseek: ['deepseek-v4-pro', 'deepseek-v4-flash'],
    });
  });

  it('旧数据缺失 modelPool 时把当前生效模型补入池中', async () => {
    await browser.storage.local.set({
      [SETTINGS_KEY]: { provider: 'kimi', model: 'kimi-k3' },
    });
    const settings = await getSettings();
    expect(settings.modelPool).toEqual({ kimi: ['kimi-k3'] });
  });

  it('providerCredentials 只接受合法供应商与 http(s) baseUrl', async () => {
    await browser.storage.local.set({
      [SETTINGS_KEY]: {
        providerCredentials: {
          deepseek: { apiKey: 'sk-a', baseUrl: 'https://api.deepseek.com' },
          kimi: { apiKey: 'sk-b', baseUrl: 'ftp://bad' },
          'unknown-provider': { apiKey: 'sk-c', baseUrl: 'https://x.example.com' },
          zhipu: null,
        },
      },
    });
    const settings = await getSettings();
    expect(settings.providerCredentials).toEqual({
      deepseek: { apiKey: 'sk-a', baseUrl: 'https://api.deepseek.com' },
      kimi: { apiKey: 'sk-b', baseUrl: '' },
    });
  });

  it('非法 modelCapabilities（数组/非对象值）回退为空对象', async () => {
    await browser.storage.local.set({
      [SETTINGS_KEY]: { modelCapabilities: ['bad'] },
    });
    expect((await getSettings()).modelCapabilities).toEqual({});

    await browser.storage.local.set({
      [SETTINGS_KEY]: {
        modelCapabilities: { 'a::b': null, 'c::d': { vision: true } },
      },
    });
    const settings = await getSettings();
    // null 条目被过滤，合法条目规范化为布尔
    expect(settings.modelCapabilities).toEqual({
      'c::d': { vision: true, tools: false },
    });
  });

  it('非法 mcpServers 条目被过滤并规范化字段', async () => {
    await browser.storage.local.set({
      [SETTINGS_KEY]: {
        mcpServers: [
          null,
          { id: 1, name: 'bad', url: 'x' }, // id 类型错误
          {
            id: 'a',
            name: '服务',
            url: 'https://mcp.example.com',
            transport: 'weird',
            disabledTools: ['t1', 2, null],
          },
        ],
      },
    });
    const settings = await getSettings();
    expect(settings.mcpServers).toHaveLength(1);
    expect(settings.mcpServers[0]).toMatchObject({
      id: 'a',
      transport: 'streamable-http', // 非法 transport 回退
      enabled: false, // 缺失/非法值安全禁用
      disabledTools: ['t1'], // 非字符串被过滤
    });
    expect(settings.mcpServers[0]).not.toHaveProperty('unknown');
  });

  it('仅接受 http/https URL，并移除 MCP 未知或超限嵌套字段', async () => {
    await browser.storage.local.set({
      [SETTINGS_KEY]: {
        baseUrl: 'javascript:alert(1)',
        mcpServers: [
          { id: 'bad', name: 'bad', url: 'file:///tmp/mcp' },
          {
            id: 'good',
            name: '服务',
            url: 'http://localhost:3000/mcp',
            enabled: true,
            disabledTools: [
              'read',
              'read',
              'x'.repeat(SETTINGS_LIMITS.toolNameLength + 1),
            ],
            bearerToken: 'x'.repeat(SETTINGS_LIMITS.mcpBearerTokenLength + 1),
            headersJson: 'x'.repeat(SETTINGS_LIMITS.mcpHeadersJsonLength + 1),
            unknown: { nested: true },
          },
        ],
      },
    });

    const settings = await getSettings();
    expect(settings.baseUrl).toBe(DEFAULT_SETTINGS.baseUrl);
    expect(settings.mcpServers).toEqual([
      {
        id: 'good',
        name: '服务',
        url: 'http://localhost:3000/mcp',
        transport: 'streamable-http',
        enabled: true,
        disabledTools: ['read'],
      },
    ]);
  });

  it('限制对象和数组数量，并对正文长度取整和 clamp', () => {
    const modelCapabilities = Object.fromEntries(
      Array.from({ length: SETTINGS_LIMITS.modelCapabilities + 10 }, (_, index) => [
        `p::m-${index}`,
        { vision: true, tools: false },
      ]),
    );
    const mcpServers = Array.from(
      { length: SETTINGS_LIMITS.mcpServers + 10 },
      (_, index) => ({
        id: `server-${index}`,
        name: `服务 ${index}`,
        url: `https://mcp-${index}.example.com`,
        disabledTools: Array.from(
          { length: SETTINGS_LIMITS.disabledTools + 10 },
          (__, toolIndex) => `tool-${toolIndex}`,
        ),
      }),
    );

    const settings = decodeSettings({
      maxContentLength: SETTINGS_LIMITS.maxContentLength + 12.7,
      modelCapabilities,
      mcpServers,
    });
    expect(settings.maxContentLength).toBe(SETTINGS_LIMITS.maxContentLength);
    expect(Object.keys(settings.modelCapabilities)).toHaveLength(
      SETTINGS_LIMITS.modelCapabilities,
    );
    expect(settings.mcpServers).toHaveLength(SETTINGS_LIMITS.mcpServers);
    expect(settings.mcpServers[0].disabledTools).toHaveLength(
      SETTINGS_LIMITS.disabledTools,
    );

    expect(decodeSettings({ maxContentLength: 1.6 }).maxContentLength).toBe(
      SETTINGS_LIMITS.minContentLength,
    );
    expect(decodeSettings({ maxContentLength: 12_345.6 }).maxContentLength).toBe(12_346);
  });

  it('字符串上限按原始输入计算，超长空白也不会绕过限制', () => {
    const settings = decodeSettings({
      provider: ' '.repeat(SETTINGS_LIMITS.providerLength + 1),
      apiKey: 'x'.repeat(SETTINGS_LIMITS.apiKeyLength + 1),
      model: 'x'.repeat(SETTINGS_LIMITS.modelLength + 1),
    });

    expect(settings.provider).toBe(DEFAULT_SETTINGS.provider);
    expect(settings.apiKey).toBe(DEFAULT_SETTINGS.apiKey);
    expect(settings.model).toBe(DEFAULT_SETTINGS.model);
  });

  it('provider 只接受已知枚举，内置供应商 endpoint 从预设重建', () => {
    const unknown = decodeSettings({
      provider: 'attacker-provider',
      baseUrl: 'https://attacker.example.com',
      apiKey: 'existing-key',
    });
    expect(unknown.provider).toBe(DEFAULT_SETTINGS.provider);
    expect(unknown.baseUrl).toBe(DEFAULT_SETTINGS.baseUrl);

    const builtIn = decodeSettings({
      provider: 'deepseek',
      baseUrl: 'https://attacker.example.com',
    });
    expect(builtIn.baseUrl).toBe('https://api.deepseek.com');
  });

  it('兼容旧版 deepseek* 字段迁移', async () => {
    await browser.storage.local.set({
      [SETTINGS_KEY]: {
        deepseekApiKey: 'legacy-key',
        deepseekBaseUrl: 'https://legacy.example.com',
      },
    });
    const settings = await getSettings();
    expect(settings.provider).toBe('deepseek');
    expect(settings.apiKey).toBe('legacy-key');
    expect(settings.baseUrl).toBe('https://legacy.example.com');
  });

  it('新字段存在时不被旧字段覆盖', async () => {
    await browser.storage.local.set({
      [SETTINGS_KEY]: { apiKey: 'new-key', deepseekApiKey: 'legacy-key' },
    });
    expect((await getSettings()).apiKey).toBe('new-key');
  });

  it('旧字段只有通过字符串和 http/https 校验后才迁移', async () => {
    await browser.storage.local.set({
      [SETTINGS_KEY]: {
        apiKey: 123,
        baseUrl: 'data:text/plain,bad',
        deepseekApiKey: 'legacy-key',
        deepseekBaseUrl: 'https://legacy.example.com/v1',
      },
    });
    const settings = await getSettings();
    expect(settings.apiKey).toBe('legacy-key');
    expect(settings.baseUrl).toBe('https://legacy.example.com/v1');

    await browser.storage.local.set({
      [SETTINGS_KEY]: {
        deepseekApiKey: { secret: true },
        deepseekBaseUrl: 'ftp://legacy.example.com',
      },
    });
    expect(await getSettings()).toEqual(DEFAULT_SETTINGS);
  });
});

describe('saveSettings', () => {
  beforeEach(() => {
    fakeBrowser.reset();
  });

  it('patch 合并保存后可读回', async () => {
    const saved = await saveSettings({ apiKey: 'sk-1', mcpVerboseLog: false });
    expect(saved.apiKey).toBe('sk-1');
    expect(saved.mcpVerboseLog).toBe(false);

    const reloaded = await getSettings();
    expect(reloaded).toEqual(saved);
  });

  it('多次 patch 依次叠加', async () => {
    await saveSettings({ apiKey: 'sk-1' });
    await saveSettings({ model: 'kimi-k3' });
    const settings = await getSettings();
    expect(settings.apiKey).toBe('sk-1');
    expect(settings.model).toBe('kimi-k3');
  });

  it('未显式提供新 Key 时 endpoint/provider 变化会清空旧 Key', async () => {
    await saveSettings({ apiKey: 'old-key' });
    const saved = await saveSettings({
      provider: 'custom',
      baseUrl: 'https://custom.example.com/v1',
    });
    expect(saved.apiKey).toBe('');
    expect(saved.baseUrl).toBe('https://custom.example.com/v1');
  });

  it('保存前再次解码，未知字段与错误嵌套值不会落盘', async () => {
    await saveSettings({ apiKey: 'existing-key', model: 'kimi-k3' });

    const unsafePatch = {
      apiKey: 42,
      baseUrl: 'chrome://settings',
      modelCapabilities: {
        'safe::model': { vision: true, tools: false, extra: 'drop' },
      },
      mcpServers: [
        {
          id: 'server',
          name: '服务',
          url: 'https://mcp.example.com',
          transport: 'sse',
          enabled: true,
          disabledTools: ['write'],
          unknown: 'drop',
        },
      ],
      unknownTopLevel: 'drop',
    } as unknown as Partial<ExtensionSettings>;

    const saved = await saveSettings(unsafePatch);
    expect(saved.apiKey).toBe('existing-key');
    expect(saved.baseUrl).toBe(DEFAULT_SETTINGS.baseUrl);
    expect(saved.model).toBe('kimi-k3');
    expect(saved.modelCapabilities).toEqual({
      'safe::model': { vision: true, tools: false },
    });
    expect(saved.mcpServers[0]).not.toHaveProperty('unknown');
    expect(saved).not.toHaveProperty('unknownTopLevel');

    const raw = (await browser.storage.local.get(SETTINGS_KEY))[SETTINGS_KEY];
    expect(raw).toEqual(saved);
  });
});
