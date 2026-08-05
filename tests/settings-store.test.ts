import { beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing';
import { browser } from 'wxt/browser';
import { getSettings, saveSettings } from '@/services/settings-store';
import { DEFAULT_SETTINGS } from '@/types/settings';

const SETTINGS_KEY = 'settings';

describe('getSettings', () => {
  beforeEach(() => {
    fakeBrowser.reset();
  });

  it('空存储时返回默认设置', async () => {
    const settings = await getSettings();
    expect(settings).toEqual(DEFAULT_SETTINGS);
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
      enabled: true, // 缺失时默认启用
      disabledTools: ['t1'], // 非字符串被过滤
    });
  });

  it('兼容旧版 deepseek* 字段迁移', async () => {
    await browser.storage.local.set({
      [SETTINGS_KEY]: {
        deepseekApiKey: 'legacy-key',
        deepseekBaseUrl: 'https://legacy.example.com',
      },
    });
    const settings = await getSettings();
    expect(settings.apiKey).toBe('legacy-key');
    expect(settings.baseUrl).toBe('https://legacy.example.com');
  });

  it('新字段存在时不被旧字段覆盖', async () => {
    await browser.storage.local.set({
      [SETTINGS_KEY]: { apiKey: 'new-key', deepseekApiKey: 'legacy-key' },
    });
    expect((await getSettings()).apiKey).toBe('new-key');
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
});
