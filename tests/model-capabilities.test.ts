import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SETTINGS,
  getBuiltinModelCapabilities,
  mergeModelCapabilityHints,
  type ExtensionSettings,
} from '@/types/settings';

function makeSettings(overrides: Partial<ExtensionSettings> = {}): ExtensionSettings {
  return {
    ...DEFAULT_SETTINGS,
    provider: 'deepseek',
    model: 'deepseek-v5',
    modelPool: { deepseek: ['deepseek-v5', 'deepseek-v5-pro'] },
    modelCapabilities: {},
    ...overrides,
  };
}

const hints = {
  'deepseek-v5': { vision: false, tools: true },
  'deepseek-v5-pro': { vision: true, tools: true },
  'other-model': { vision: false, tools: false },
};

describe('mergeModelCapabilityHints', () => {
  it('只补全当前供应商下已配置且无能力记录的模型', () => {
    expect(mergeModelCapabilityHints(makeSettings(), hints)).toEqual({
      'deepseek::deepseek-v5': { vision: false, tools: true },
      'deepseek::deepseek-v5-pro': { vision: true, tools: true },
    });
  });

  it('不覆盖用户已保存的能力配置', () => {
    const settings = makeSettings({
      modelCapabilities: {
        'deepseek::deepseek-v5': { vision: true, tools: false },
      },
    });

    expect(mergeModelCapabilityHints(settings, hints)).toEqual({
      'deepseek::deepseek-v5': { vision: true, tools: false },
      'deepseek::deepseek-v5-pro': { vision: true, tools: true },
    });
  });

  it('已有内置能力基线的模型不写入推断值', () => {
    expect(getBuiltinModelCapabilities('qwen', 'qwen3.7-plus')).toBeDefined();

    const settings = makeSettings({
      provider: 'qwen',
      model: 'qwen3.7-plus',
      modelPool: { qwen: ['qwen3.7-plus'] },
    });

    expect(
      mergeModelCapabilityHints(settings, {
        'qwen3.7-plus': { vision: false, tools: false },
      }),
    ).toBeUndefined();
  });

  it('没有可补全项时返回 undefined', () => {
    expect(
      mergeModelCapabilityHints(makeSettings({ modelCapabilities: {} }), {
        'other-model': { vision: false, tools: false },
      }),
    ).toBeUndefined();
  });
});
