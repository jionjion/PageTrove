import { describe, expect, it } from 'vitest';
import { DEFAULT_SHORTCUTS, type ShortcutMap } from '@/types/shortcuts';
import {
  bindingEquals,
  bindingText,
  bindingTokens,
  cloneShortcuts,
  comboFromEvent,
  decodeShortcuts,
  DoubleTapDetector,
  DOUBLE_TAP_WINDOW_MS,
  findShortcutConflict,
  isShortcutMessage,
  matchShortcutCombo,
  matchShortcutDouble,
  normalizeEventKey,
  validateBinding,
} from '@/services/shortcuts';

describe('normalizeEventKey / comboFromEvent', () => {
  it('空格、Esc 与单字符归一化', () => {
    expect(normalizeEventKey(' ')).toBe('Space');
    expect(normalizeEventKey('Esc')).toBe('Escape');
    expect(normalizeEventKey('a')).toBe('A');
    expect(normalizeEventKey('ArrowUp')).toBe('ArrowUp');
  });

  it('修饰键按固定顺序拼接,与按下顺序无关', () => {
    expect(
      comboFromEvent({
        key: 's',
        ctrlKey: true,
        altKey: true,
        shiftKey: false,
        metaKey: false,
      }),
    ).toBe('Control+Alt+S');
    expect(
      comboFromEvent({
        key: ',',
        ctrlKey: false,
        altKey: true,
        shiftKey: false,
        metaKey: true,
      }),
    ).toBe('Alt+Meta+,');
  });

  it('裸键与纯修饰键不构成组合键', () => {
    expect(
      comboFromEvent({
        key: 's',
        ctrlKey: false,
        altKey: false,
        shiftKey: false,
        metaKey: false,
      }),
    ).toBeUndefined();
    expect(
      comboFromEvent({
        key: 'Alt',
        ctrlKey: false,
        altKey: true,
        shiftKey: false,
        metaKey: false,
      }),
    ).toBeUndefined();
  });
});

describe('validateBinding', () => {
  it('合法组合键与双击绑定通过', () => {
    expect(validateBinding({ kind: 'combo', keys: 'Alt+S' })).toBeUndefined();
    expect(validateBinding({ kind: 'combo', keys: 'Control+Shift+P' })).toBeUndefined();
    expect(validateBinding({ kind: 'double', keys: 'Alt' })).toBeUndefined();
    expect(validateBinding({ kind: 'double', keys: 'Control' })).toBeUndefined();
    expect(validateBinding({ kind: 'double', keys: 'Shift' })).toBeUndefined();
  });

  it('拒绝 Shift 单独搭配、裸键、修饰键收尾与 Meta 双击', () => {
    expect(validateBinding({ kind: 'combo', keys: 'Shift+A' })).toBeDefined();
    expect(validateBinding({ kind: 'combo', keys: 'S' })).toBeDefined();
    expect(validateBinding({ kind: 'combo', keys: 'Alt+Shift' })).toBeDefined();
    expect(validateBinding({ kind: 'double', keys: 'Meta' })).toBeDefined();
    expect(validateBinding({ kind: 'double', keys: 'A' })).toBeDefined();
  });
});

describe('匹配与冲突', () => {
  it('按默认表匹配组合键与双击', () => {
    expect(matchShortcutCombo(DEFAULT_SHORTCUTS, 'Alt+S')).toBe('quick-save');
    expect(matchShortcutCombo(DEFAULT_SHORTCUTS, 'Alt+3')).toBe('view-clips');
    expect(matchShortcutCombo(DEFAULT_SHORTCUTS, 'Alt+9')).toBeUndefined();
    expect(matchShortcutDouble(DEFAULT_SHORTCUTS, 'Alt')).toBe('open-panel');
    expect(matchShortcutDouble(DEFAULT_SHORTCUTS, 'Control')).toBeUndefined();
  });

  it('冲突检测忽略自身动作', () => {
    expect(
      findShortcutConflict(DEFAULT_SHORTCUTS, 'quick-save', {
        kind: 'combo',
        keys: 'Alt+S',
      }),
    ).toBeUndefined();
    expect(
      findShortcutConflict(DEFAULT_SHORTCUTS, 'quick-save', {
        kind: 'combo',
        keys: 'Alt+N',
      }),
    ).toBe('new-chat');
  });
});

describe('展示格式', () => {
  it('Windows 与 Mac 分别渲染', () => {
    expect(bindingTokens({ kind: 'combo', keys: 'Control+Alt+S' }, false)).toEqual([
      'Ctrl',
      'Alt',
      'S',
    ]);
    expect(bindingTokens({ kind: 'combo', keys: 'Control+Alt+S' }, true)).toEqual([
      '⌃',
      '⌥',
      'S',
    ]);
    expect(bindingTokens({ kind: 'combo', keys: 'Alt+Space' }, false)).toEqual([
      'Alt',
      '空格',
    ]);
    expect(bindingTokens({ kind: 'double', keys: 'Alt' }, true)).toEqual(['⌥', '⌥']);
  });

  it('单行文本用于 Tooltip', () => {
    expect(bindingText({ kind: 'combo', keys: 'Alt+3' }, false)).toBe('Alt + 3');
    expect(bindingText({ kind: 'double', keys: 'Alt' }, true)).toBe('⌥ 双击');
  });
});

describe('DoubleTapDetector', () => {
  it('干净的两次敲击在窗口内触发', () => {
    const detector = new DoubleTapDetector();
    detector.keydown('Alt');
    expect(detector.keyup('Alt', 1_000)).toBeUndefined();
    detector.keydown('Alt');
    expect(detector.keyup('Alt', 1_000 + DOUBLE_TAP_WINDOW_MS)).toBe('Alt');
  });

  it('超过窗口不触发,并重新计为第一次敲击', () => {
    const detector = new DoubleTapDetector();
    detector.keydown('Alt');
    detector.keyup('Alt', 0);
    detector.keydown('Alt');
    expect(detector.keyup('Alt', DOUBLE_TAP_WINDOW_MS + 1)).toBeUndefined();
    detector.keydown('Alt');
    expect(detector.keyup('Alt', DOUBLE_TAP_WINDOW_MS + 100)).toBe('Alt');
  });

  it('按住期间按下其他键(如 Alt+S)不算干净敲击', () => {
    const detector = new DoubleTapDetector();
    detector.keydown('Alt');
    detector.keydown('s');
    detector.keyup('s');
    expect(detector.keyup('Alt', 100)).toBeUndefined();
    // 脏敲击也不计入第一次,下一次干净敲击仍需两次
    detector.keydown('Alt');
    expect(detector.keyup('Alt', 200)).toBeUndefined();
    detector.keydown('Alt');
    expect(detector.keyup('Alt', 300)).toBe('Alt');
  });

  it('长按重复事件不产生额外敲击,三连击只触发一次', () => {
    const detector = new DoubleTapDetector();
    detector.keydown('Alt');
    detector.keydown('Alt', true);
    detector.keyup('Alt', 0);
    detector.keydown('Alt');
    expect(detector.keyup('Alt', 100)).toBe('Alt');
    detector.keydown('Alt');
    expect(detector.keyup('Alt', 200)).toBeUndefined();
  });

  it('失焦重置后不残留状态', () => {
    const detector = new DoubleTapDetector();
    detector.keydown('Alt');
    detector.keyup('Alt', 0);
    detector.reset();
    detector.keydown('Alt');
    expect(detector.keyup('Alt', 100)).toBeUndefined();
  });

  it('非修饰键 keyup 不触发', () => {
    const detector = new DoubleTapDetector();
    expect(detector.keyup('s', 0)).toBeUndefined();
  });
});

describe('decodeShortcuts', () => {
  it('缺失或非法输入整体回退默认', () => {
    expect(decodeShortcuts(undefined, DEFAULT_SHORTCUTS)).toEqual(DEFAULT_SHORTCUTS);
    expect(decodeShortcuts('bad', DEFAULT_SHORTCUTS)).toEqual(DEFAULT_SHORTCUTS);
    const decoded = decodeShortcuts(
      {
        'quick-save': { kind: 'combo', keys: 'S' },
        'open-panel': { kind: 'double', keys: 'Meta' },
      },
      DEFAULT_SHORTCUTS,
    );
    expect(decoded['quick-save']).toEqual(DEFAULT_SHORTCUTS['quick-save']);
    expect(decoded['open-panel']).toEqual(DEFAULT_SHORTCUTS['open-panel']);
  });

  it('保留合法自定义键位,忽略未知动作', () => {
    const decoded = decodeShortcuts(
      {
        'quick-save': { kind: 'combo', keys: 'Alt+K' },
        hacker: { kind: 'combo', keys: 'Alt+X' },
      },
      DEFAULT_SHORTCUTS,
    );
    expect(decoded['quick-save']).toEqual({ kind: 'combo', keys: 'Alt+K' });
    expect(decoded).not.toHaveProperty('hacker');
  });

  it('重复绑定保留先到者,后来者回退默认', () => {
    const decoded = decodeShortcuts(
      {
        'quick-save': { kind: 'combo', keys: 'Alt+N' },
        'new-chat': { kind: 'combo', keys: 'Alt+N' },
      },
      DEFAULT_SHORTCUTS,
    );
    expect(decoded['quick-save']).toEqual({ kind: 'combo', keys: 'Alt+N' });
    expect(decoded['new-chat']).toEqual(DEFAULT_SHORTCUTS['new-chat']);
  });

  it('返回的表与 fallback 不共享引用', () => {
    const decoded = decodeShortcuts(undefined, DEFAULT_SHORTCUTS);
    decoded['quick-save'].keys = 'Alt+Z';
    expect(DEFAULT_SHORTCUTS['quick-save'].keys).toBe('Alt+S');
    expect(bindingEquals(decoded['quick-save'], DEFAULT_SHORTCUTS['quick-save'])).toBe(
      false,
    );
  });

  it('cloneShortcuts 深拷贝每个绑定', () => {
    const cloned = cloneShortcuts(DEFAULT_SHORTCUTS);
    expect(cloned).toEqual(DEFAULT_SHORTCUTS);
    expect(cloned['open-panel']).not.toBe(DEFAULT_SHORTCUTS['open-panel']);
  });
});

describe('isShortcutMessage', () => {
  it('只接受已知动作', () => {
    expect(isShortcutMessage({ type: 'pagetrove:shortcut', action: 'quick-save' })).toBe(
      true,
    );
    expect(isShortcutMessage({ type: 'pagetrove:shortcut', action: 'drop-tables' })).toBe(
      false,
    );
    expect(isShortcutMessage({ type: 'other', action: 'quick-save' })).toBe(false);
    expect(isShortcutMessage(null)).toBe(false);
  });
});

describe('默认键位表', () => {
  it('九个动作互不冲突且全部合法', () => {
    const seen = new Set<string>();
    for (const binding of Object.values(
      DEFAULT_SHORTCUTS,
    ) as ShortcutMap[keyof ShortcutMap][]) {
      expect(validateBinding(binding)).toBeUndefined();
      const key = `${binding.kind}:${binding.keys}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
    expect(seen.size).toBe(9);
  });
});
