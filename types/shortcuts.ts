/**
 * 拾页快捷键:动作清单、绑定结构与默认键位。
 *
 * 只有 open-panel 同时注册为浏览器级 command(manifest.commands,备用键
 * Alt+Shift+S);其余动作全部由拾页自己的按键监听实现,因此可以自由
 * 自定义成任意组合键,甚至「双击修饰键」这类浏览器 API 不支持的形式。
 */

export const SHORTCUT_ACTIONS = [
  'open-panel',
  'quick-save',
  'new-chat',
  'view-chat',
  'view-current',
  'view-clips',
  'view-research',
  'view-history',
  'open-settings',
] as const;

export type ShortcutAction = (typeof SHORTCUT_ACTIONS)[number];

/** 允许设置为「双击触发」的修饰键;Meta 双击会撞操作系统手势,不开放。 */
export const DOUBLE_TAP_MODIFIERS = ['Alt', 'Control', 'Shift'] as const;
export type DoubleTapModifier = (typeof DOUBLE_TAP_MODIFIERS)[number];

export interface ShortcutBinding {
  /** combo = 修饰键 + 普通键;double = 连按两次同一修饰键 */
  kind: 'combo' | 'double';
  /** 规范化键名:combo 如 "Alt+S"、"Control+Shift+P";double 如 "Alt" */
  keys: string;
}

export type ShortcutMap = Record<ShortcutAction, ShortcutBinding>;

export const DEFAULT_SHORTCUTS: ShortcutMap = {
  'open-panel': { kind: 'double', keys: 'Alt' },
  'quick-save': { kind: 'combo', keys: 'Alt+S' },
  'new-chat': { kind: 'combo', keys: 'Alt+N' },
  'view-chat': { kind: 'combo', keys: 'Alt+1' },
  'view-current': { kind: 'combo', keys: 'Alt+2' },
  'view-clips': { kind: 'combo', keys: 'Alt+3' },
  'view-research': { kind: 'combo', keys: 'Alt+4' },
  'view-history': { kind: 'combo', keys: 'Alt+5' },
  'open-settings': { kind: 'combo', keys: 'Alt+,' },
};

/** 设置页分组:全局动作在任意网页生效;导航动作在网页与侧边栏中都生效。 */
export const SHORTCUT_GROUPS: ReadonlyArray<{
  title: string;
  description: string;
  actions: readonly ShortcutAction[];
}> = [
  {
    title: '全局',
    description: '在任意网页上按下即生效，无需打开侧边栏',
    actions: ['open-panel', 'quick-save'],
  },
  {
    title: '导航与对话',
    description: '侧边栏已打开时直接切换；未打开时先唤起侧边栏再跳转',
    actions: [
      'new-chat',
      'view-chat',
      'view-current',
      'view-clips',
      'view-research',
      'view-history',
      'open-settings',
    ],
  },
];

/** 动作是否属于侧边栏视图导航(与 App 的 View 类型对应)。 */
export type ShortcutView = 'chat' | 'current' | 'clips' | 'research' | 'history';

export const SHORTCUT_VIEW_MAP: Partial<Record<ShortcutAction, ShortcutView>> = {
  'view-chat': 'chat',
  'view-current': 'current',
  'view-clips': 'clips',
  'view-research': 'research',
  'view-history': 'history',
};
