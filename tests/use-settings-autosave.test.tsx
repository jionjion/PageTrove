// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSettingsAutosave } from '@/hooks/useSettingsAutosave';
import { DEFAULT_SETTINGS, type ExtensionSettings } from '@/types/settings';

function makeSettings(overrides: Partial<ExtensionSettings> = {}): ExtensionSettings {
  return {
    ...DEFAULT_SETTINGS,
    provider: 'deepseek',
    apiKey: 'initial-key',
    baseUrl: 'https://api.deepseek.com',
    model: 'deepseek-v4-flash',
    ...overrides,
  };
}

function setup(initial = makeSettings()) {
  const save = vi.fn(async (patch: Partial<ExtensionSettings>) => ({
    ...makeSettings(),
    ...patch,
  }));
  const hook = renderHook(
    ({ settings, hydrated }: { settings: ExtensionSettings; hydrated: boolean }) =>
      useSettingsAutosave({ settings, hydrated, delay: 500, save }),
    { initialProps: { settings: initial, hydrated: false } },
  );
  return { save, ...hook };
}

interface HookHandle {
  rerender: (props: { settings: ExtensionSettings; hydrated: boolean }) => void;
  result: { current: ReturnType<typeof useSettingsAutosave> };
}

async function hydrate(hook: HookHandle, initial: ExtensionSettings) {
  act(() => {
    hook.result.current.adoptStoredSettings(initial);
    hook.rerender({ settings: initial, hydrated: true });
  });
}

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

async function change(hook: HookHandle, settings: ExtensionSettings, delay = 500) {
  // 先让 rerender 的 effect 执行并注册防抖 timer，再推进时间。
  act(() => {
    hook.rerender({ settings, hydrated: true });
  });
  await advance(delay);
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useSettingsAutosave', () => {
  it('hydration 完成前不写入', async () => {
    const hook = setup();
    await change(hook, makeSettings({ apiKey: 'edited' }), 1_000);
    expect(hook.save).not.toHaveBeenCalled();
  });

  it('hydration 后按防抖保存最新值', async () => {
    const initial = makeSettings();
    const hook = setup(initial);
    await hydrate(hook, initial);

    await change(hook, makeSettings({ apiKey: 'edited' }), 499);
    expect(hook.save).not.toHaveBeenCalled();

    await advance(1);
    expect(hook.save).toHaveBeenCalledTimes(1);
    expect(hook.save.mock.calls[0][0]).toMatchObject({ apiKey: 'edited' });
    expect(hook.result.current.status.state).toBe('saved');
  });

  it('flush 立即保存，不等防抖', async () => {
    const initial = makeSettings();
    const hook = setup(initial);
    await hydrate(hook, initial);

    act(() => {
      hook.rerender({
        settings: makeSettings({ apiKey: 'edited' }),
        hydrated: true,
      });
    });
    await act(async () => {
      const saved = await hook.result.current.flush();
      expect(saved).toBe(true);
    });

    expect(hook.save).toHaveBeenCalledTimes(1);
    expect(hook.save.mock.calls[0][0]).toMatchObject({ apiKey: 'edited' });
  });

  it('保存期间改回原值，最终仍以最新值落盘', async () => {
    const initial = makeSettings();
    const resolvers: ((value: ExtensionSettings) => void)[] = [];
    const save = vi.fn(
      (_patch: Partial<ExtensionSettings>) =>
        new Promise<ExtensionSettings>((resolve) => {
          resolvers.push(resolve);
        }),
    );
    const hook = renderHook(
      ({ settings }: { settings: ExtensionSettings; hydrated: boolean }) =>
        useSettingsAutosave({ settings, hydrated: true, delay: 500, save }),
      { initialProps: { settings: initial, hydrated: true } },
    );
    act(() => {
      hook.result.current.adoptStoredSettings(initial);
    });

    await change(hook, makeSettings({ apiKey: 'changed' }));
    expect(save).toHaveBeenCalledTimes(1);

    await change(hook, initial);
    expect(save).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolvers[0](makeSettings());
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(save).toHaveBeenCalledTimes(2);
    expect(save.mock.calls[1][0]).toMatchObject({ apiKey: 'initial-key' });

    await act(async () => {
      resolvers[1](initial);
      await Promise.resolve();
    });
    expect(hook.result.current.status.state).toBe('saved');
  });

  it('非法 MCP 时不发送 mcpServers，并暴露问题', async () => {
    const initial = makeSettings();
    const hook = setup(initial);
    await hydrate(hook, initial);

    const invalid = makeSettings({
      mcpServers: [
        {
          id: 'server-1',
          name: '坏服务',
          url: '',
          transport: 'streamable-http',
          enabled: true,
          disabledTools: [],
        },
      ],
    });
    await change(hook, invalid);

    expect(hook.save).toHaveBeenCalledTimes(1);
    expect(hook.save.mock.calls[0][0]).not.toHaveProperty('mcpServers');
    expect(hook.result.current.mcpIssues).toHaveLength(1);
    expect(hook.result.current.mcpIssues[0].name).toBe('坏服务');
  });

  it('保存失败进入 error，不推进基线', async () => {
    const initial = makeSettings();
    const save = vi.fn(async () => {
      throw new Error('storage full');
    });
    const hook = renderHook(
      ({ settings }: { settings: ExtensionSettings; hydrated: boolean }) =>
        useSettingsAutosave({ settings, hydrated: true, delay: 500, save }),
      { initialProps: { settings: initial, hydrated: true } },
    );
    act(() => {
      hook.result.current.adoptStoredSettings(initial);
    });

    await change(hook, makeSettings({ apiKey: 'edited' }));
    expect(hook.result.current.status).toMatchObject({
      state: 'error',
      message: 'storage full',
    });

    // 下一次修改会重试保存
    await change(hook, makeSettings({ apiKey: 'edited-2' }));
    expect(save).toHaveBeenCalledTimes(2);
  });
});
