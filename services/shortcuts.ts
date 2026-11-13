import {
  DEFAULT_SHORTCUTS,
  DOUBLE_TAP_MODIFIERS,
  SHORTCUT_ACTIONS,
  type DoubleTapModifier,
  type ShortcutAction,
  type ShortcutBinding,
  type ShortcutMap,
} from '@/types/shortcuts';

/**
 * 快捷键纯逻辑:规范化、匹配、校验、冲突检测、双击检测与存储净化。
 * 不依赖 browser API,内容脚本 / 侧边栏 / 设置页 / 测试共用同一套规则。
 */

const MODIFIER_KEYS = ['Alt', 'Control', 'Shift', 'Meta'] as const;
const MAX_BINDING_KEYS_LENGTH = 64;

export function isModifierKey(key: string): boolean {
  return (MODIFIER_KEYS as readonly string[]).includes(key);
}

/** 把 KeyboardEvent.key 规范化为稳定的键名(字母大写、空格命名、Esc 归一)。 */
export function normalizeEventKey(key: string): string {
  if (key === ' ' || key === 'Spacebar') return 'Space';
  if (key === 'Esc') return 'Escape';
  if (key.length === 1) return key.toUpperCase();
  return key;
}

export interface ComboEventLike {
  key: string;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  metaKey: boolean;
}

/**
 * 从按键事件构造组合键字符串;纯修饰键或无修饰键的裸键返回 undefined
 * (裸键永远不作为快捷键,避免干扰正常输入)。
 */
export function comboFromEvent(event: ComboEventLike): string | undefined {
  const key = normalizeEventKey(event.key);
  if (isModifierKey(key)) return undefined;
  const modifiers: string[] = [];
  if (event.ctrlKey) modifiers.push('Control');
  if (event.altKey) modifiers.push('Alt');
  if (event.shiftKey) modifiers.push('Shift');
  if (event.metaKey) modifiers.push('Meta');
  if (modifiers.length === 0) return undefined;
  return [...modifiers, key].join('+');
}

/** 校验绑定是否可用;返回 undefined 表示合法,否则返回面向用户的错误文案。 */
export function validateBinding(binding: ShortcutBinding): string | undefined {
  if (binding.kind === 'double') {
    return (DOUBLE_TAP_MODIFIERS as readonly string[]).includes(binding.keys)
      ? undefined
      : '双击快捷键仅支持 Alt / Ctrl / Shift';
  }
  const parts = binding.keys.split('+');
  const key = parts[parts.length - 1];
  const modifiers = parts.slice(0, -1);
  if (!key || isModifierKey(key)) return '请再按一个普通按键，例如字母或数字';
  if (modifiers.some((modifier) => !isModifierKey(modifier))) {
    return '快捷键格式无效';
  }
  if (!modifiers.some((modifier) => modifier !== 'Shift')) {
    return '请搭配 Ctrl、Alt 或 ⌘ 使用，避免影响正常输入';
  }
  return undefined;
}

export function bindingEquals(a: ShortcutBinding, b: ShortcutBinding): boolean {
  return a.kind === b.kind && a.keys === b.keys;
}

export function cloneBinding(binding: ShortcutBinding): ShortcutBinding {
  return { kind: binding.kind, keys: binding.keys };
}

export function cloneShortcuts(map: ShortcutMap): ShortcutMap {
  return Object.fromEntries(
    SHORTCUT_ACTIONS.map((action) => [action, cloneBinding(map[action])]),
  ) as ShortcutMap;
}

/** 找出与给定绑定冲突的其他动作;无冲突返回 undefined。 */
export function findShortcutConflict(
  map: ShortcutMap,
  action: ShortcutAction,
  binding: ShortcutBinding,
): ShortcutAction | undefined {
  return SHORTCUT_ACTIONS.find(
    (other) => other !== action && bindingEquals(map[other], binding),
  );
}

export function matchShortcutCombo(
  map: ShortcutMap,
  combo: string,
): ShortcutAction | undefined {
  return SHORTCUT_ACTIONS.find(
    (action) => map[action].kind === 'combo' && map[action].keys === combo,
  );
}

export function matchShortcutDouble(
  map: ShortcutMap,
  modifier: string,
): ShortcutAction | undefined {
  return SHORTCUT_ACTIONS.find(
    (action) => map[action].kind === 'double' && map[action].keys === modifier,
  );
}

const KEY_DISPLAY: Record<string, string> = {
  Space: '空格',
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
  Enter: '↵',
  Backspace: '⌫',
  Delete: 'Del',
  Escape: 'Esc',
  Tab: 'Tab',
};

const MAC_MODIFIER_SYMBOLS: Record<string, string> = {
  Control: '⌃',
  Alt: '⌥',
  Shift: '⇧',
  Meta: '⌘',
};

const WIN_MODIFIER_NAMES: Record<string, string> = {
  Control: 'Ctrl',
  Alt: 'Alt',
  Shift: 'Shift',
  Meta: 'Win',
};

export function isMacPlatform(): boolean {
  return typeof navigator !== 'undefined' && /Mac|iPhone|iPad/i.test(navigator.userAgent);
}

/** 渲染为 kbd 芯片序列;双击绑定渲染为两枚相同修饰键芯片。 */
export function bindingTokens(binding: ShortcutBinding, mac = isMacPlatform()): string[] {
  const display = (part: string): string => {
    const symbol = mac ? MAC_MODIFIER_SYMBOLS[part] : WIN_MODIFIER_NAMES[part];
    return symbol ?? KEY_DISPLAY[part] ?? part;
  };
  if (binding.kind === 'double') return [display(binding.keys), display(binding.keys)];
  return binding.keys.split('+').map(display);
}

/** 单行文本,用于 Tooltip 等紧凑场景,例如 "Alt + 3"、"⌥ 双击"。 */
export function bindingText(binding: ShortcutBinding, mac = isMacPlatform()): string {
  const tokens = bindingTokens(binding, mac);
  return binding.kind === 'double' ? `${tokens[0]} 双击` : tokens.join(' + ');
}

export const DOUBLE_TAP_WINDOW_MS = 400;

/**
 * 双击修饰键检测器:只统计「干净的」单独按下-抬起(期间未按其他键),
 * 两次干净敲击间隔不超过窗口即触发。Alt+Tab、Alt+S 这类组合不会误触。
 */
export class DoubleTapDetector {
  private held = new Set<string>();
  private dirty = new Set<string>();
  private lastTap = new Map<string, number>();

  keydown(key: string, repeat = false): void {
    if (!isModifierKey(key)) {
      // 修饰键按住期间出现其他按键 → 本次按压不是干净敲击
      for (const modifier of this.held) this.dirty.add(modifier);
      return;
    }
    if (repeat) return;
    this.held.add(key);
    this.dirty.delete(key);
  }

  /** 返回触发的修饰键;未触发返回 undefined。 */
  keyup(key: string, now = Date.now()): string | undefined {
    if (!isModifierKey(key)) return undefined;
    this.held.delete(key);
    if (this.dirty.delete(key)) return undefined;
    const last = this.lastTap.get(key);
    if (last !== undefined && now - last <= DOUBLE_TAP_WINDOW_MS) {
      this.lastTap.delete(key);
      return key;
    }
    this.lastTap.set(key, now);
    return undefined;
  }

  /** 窗口失焦时清空,避免残留的按住状态造成误判。 */
  reset(): void {
    this.held.clear();
    this.dirty.clear();
    this.lastTap.clear();
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function decodeBinding(value: unknown): ShortcutBinding | undefined {
  if (!isRecord(value)) return undefined;
  if (value.kind !== 'combo' && value.kind !== 'double') return undefined;
  if (typeof value.keys !== 'string' || value.keys.length > MAX_BINDING_KEYS_LENGTH) {
    return undefined;
  }
  const binding: ShortcutBinding = { kind: value.kind, keys: value.keys };
  return validateBinding(binding) === undefined ? binding : undefined;
}

/**
 * 将 storage / 备份中的未知值解码为完整快捷键表。
 * 非法项回退默认值;重复绑定按动作声明顺序保留先到者,后来者回退默认。
 */
export function decodeShortcuts(value: unknown, fallback: ShortcutMap): ShortcutMap {
  const source = isRecord(value) ? value : {};
  const result = {} as ShortcutMap;
  const used: ShortcutBinding[] = [];
  for (const action of SHORTCUT_ACTIONS) {
    let binding = decodeBinding(source[action]) ?? cloneBinding(fallback[action]);
    if (used.some((existing) => bindingEquals(existing, binding))) {
      const standard = cloneBinding(DEFAULT_SHORTCUTS[action]);
      if (!used.some((existing) => bindingEquals(existing, standard))) {
        binding = standard;
      }
    }
    result[action] = binding;
    used.push(binding);
  }
  return result;
}

export function isDoubleTapModifier(key: string): key is DoubleTapModifier {
  return (DOUBLE_TAP_MODIFIERS as readonly string[]).includes(key);
}

/** 内容脚本 → background 的快捷键消息协议。 */
export const SHORTCUT_MESSAGE_TYPE = 'pagetrove:shortcut';

export interface ShortcutMessage {
  type: typeof SHORTCUT_MESSAGE_TYPE;
  action: ShortcutAction;
}

export function isShortcutMessage(value: unknown): value is ShortcutMessage {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    record.type === SHORTCUT_MESSAGE_TYPE &&
    typeof record.action === 'string' &&
    (SHORTCUT_ACTIONS as readonly string[]).includes(record.action)
  );
}
