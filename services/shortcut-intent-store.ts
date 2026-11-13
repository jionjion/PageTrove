import { browser } from 'wxt/browser';
import type { ShortcutView } from '@/types/shortcuts';

/**
 * 快捷键导航意图:网页上按下导航快捷键时,background 写入 session 意图
 * 并唤起侧边栏;侧边栏挂载时消费,已打开时通过 storage 变化即时响应。
 * 与引用意图(chat-intent-store)同一模式,单 key 即可——导航只需最新一条。
 */

const INTENT_KEY = 'pendingShortcutIntent';
const EXPIRE_MS = 60_000;
const VIEWS: readonly ShortcutView[] = [
  'chat',
  'current',
  'clips',
  'research',
  'history',
];

export interface ShortcutIntent {
  id: string;
  view: ShortcutView;
  /** true 时在目标视图发起新对话 */
  newChat?: boolean;
  createdAt: string;
}

function isIntent(value: unknown): value is ShortcutIntent {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.id === 'string' &&
    record.id.length > 0 &&
    typeof record.view === 'string' &&
    (VIEWS as readonly string[]).includes(record.view) &&
    (record.newChat === undefined || typeof record.newChat === 'boolean') &&
    typeof record.createdAt === 'string'
  );
}

function isFresh(intent: ShortcutIntent): boolean {
  const created = Date.parse(intent.createdAt);
  const age = Date.now() - created;
  return !Number.isNaN(created) && age > -60_000 && age < EXPIRE_MS;
}

export async function enqueueShortcutIntent(intent: {
  view: ShortcutView;
  newChat?: boolean;
}): Promise<void> {
  const next: ShortcutIntent = {
    id: crypto.randomUUID(),
    view: intent.view,
    ...(intent.newChat ? { newChat: true } : {}),
    createdAt: new Date().toISOString(),
  };
  await browser.storage.session.set({ [INTENT_KEY]: next });
}

let takeTail: Promise<void> = Promise.resolve();

async function takeUnlocked(): Promise<ShortcutIntent | undefined> {
  const stored = await browser.storage.session.get(INTENT_KEY);
  const value = stored[INTENT_KEY];
  if (value === undefined) return undefined;
  await browser.storage.session.remove(INTENT_KEY);
  return isIntent(value) && isFresh(value) ? value : undefined;
}

/** 串行取出,避免多个侧边栏窗口重复消费同一意图。 */
export function takeShortcutIntent(): Promise<ShortcutIntent | undefined> {
  const next = takeTail.then(takeUnlocked, takeUnlocked);
  takeTail = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

export function onShortcutIntentChanged(callback: () => void): () => void {
  const listener = (
    changes: Record<string, Browser.storage.StorageChange>,
    areaName: string,
  ) => {
    if (areaName === 'session' && INTENT_KEY in changes) callback();
  };
  browser.storage.onChanged.addListener(listener);
  return () => browser.storage.onChanged.removeListener(listener);
}
