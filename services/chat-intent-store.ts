import { browser } from 'wxt/browser';
import type { QuoteChatIntent } from '@/types/chat-intent';

const STORE_KEY = 'pendingChatIntents';
const MAX_PENDING = 5;
const MAX_TEXT_LENGTH = 10_000;
const EXPIRE_MS = 10 * 60 * 1_000;

function isIntent(value: unknown): value is QuoteChatIntent {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    record.kind === 'quote' &&
    typeof record.id === 'string' &&
    typeof record.tabId === 'number' &&
    typeof record.title === 'string' &&
    typeof record.url === 'string' &&
    typeof record.text === 'string' &&
    typeof record.createdAt === 'string'
  );
}

function isFresh(intent: QuoteChatIntent): boolean {
  const created = Date.parse(intent.createdAt);
  return !Number.isNaN(created) && Date.now() - created < EXPIRE_MS;
}

async function readQueue(): Promise<QuoteChatIntent[]> {
  const result = await browser.storage.session.get(STORE_KEY);
  const stored = result[STORE_KEY];
  if (!Array.isArray(stored)) return [];
  return stored.filter(isIntent).filter(isFresh);
}

/** 入队一条右键引用意图（后台调用）。超长文字截断，队列超限时丢弃最旧的。 */
export async function enqueueQuoteIntent(intent: {
  tabId: number;
  title: string;
  url: string;
  text: string;
}): Promise<void> {
  const text = intent.text.slice(0, MAX_TEXT_LENGTH).trim();
  if (!text) return;

  const queue = await readQueue();
  const next: QuoteChatIntent = {
    id: crypto.randomUUID(),
    kind: 'quote',
    tabId: intent.tabId,
    title: intent.title,
    url: intent.url,
    text,
    createdAt: new Date().toISOString(),
  };
  await browser.storage.session.set({
    [STORE_KEY]: [...queue, next].slice(-MAX_PENDING),
  });
}

/** 取出并移除队列中最早的一条意图（侧边栏消费）。 */
export async function takeNextQuoteIntent(): Promise<
  QuoteChatIntent | undefined
> {
  const queue = await readQueue();
  const [first, ...rest] = queue;
  if (!first) {
    // 顺带清理过期数据。
    await browser.storage.session.set({ [STORE_KEY]: [] });
    return undefined;
  }
  await browser.storage.session.set({ [STORE_KEY]: rest });
  return first;
}

/** 监听队列变化；返回取消监听函数。 */
export function onQuoteIntentChanged(callback: () => void): () => void {
  const listener = (
    changes: Record<string, Browser.storage.StorageChange>,
    areaName: string,
  ) => {
    if (areaName === 'session' && changes[STORE_KEY]) callback();
  };
  browser.storage.onChanged.addListener(listener);
  return () => browser.storage.onChanged.removeListener(listener);
}
