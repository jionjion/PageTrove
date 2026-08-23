import { browser } from 'wxt/browser';
import type { QuoteChatIntent } from '@/types/chat-intent';

const STORE_PREFIX = 'pendingChatIntent:';
const MAX_PENDING = 5;
const MAX_TEXT_LENGTH = 10_000;
const EXPIRE_MS = 10 * 60 * 1_000;
const TAKE_MESSAGE_TYPE = 'pagetrove:take-quote-intent';

interface TakeIntentMessage {
  type: typeof TAKE_MESSAGE_TYPE;
}

export function isTakeIntentMessage(value: unknown): value is TakeIntentMessage {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as Record<string, unknown>).type === TAKE_MESSAGE_TYPE
  );
}

function keyForIntent(intent: QuoteChatIntent): string {
  return `${STORE_PREFIX}${intent.createdAt}:${intent.id}`;
}

let lastCreatedAtMs = 0;

function nextCreatedAt(): string {
  const timestamp = Math.max(Date.now(), lastCreatedAtMs + 1);
  lastCreatedAtMs = timestamp;
  return new Date(timestamp).toISOString();
}

function isIntent(value: unknown): value is QuoteChatIntent {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    record.kind === 'quote' &&
    typeof record.id === 'string' &&
    record.id.length > 0 &&
    typeof record.tabId === 'number' &&
    Number.isInteger(record.tabId) &&
    record.tabId >= 0 &&
    typeof record.title === 'string' &&
    typeof record.url === 'string' &&
    typeof record.text === 'string' &&
    typeof record.createdAt === 'string'
  );
}

function isFresh(intent: QuoteChatIntent): boolean {
  const created = Date.parse(intent.createdAt);
  const age = Date.now() - created;
  // 同一毫秒内的单调时间戳可能略领先 Date.now；小幅未来偏差视为有效。
  return !Number.isNaN(created) && age > -60_000 && age < EXPIRE_MS;
}

async function readEntries(): Promise<Array<{ key: string; intent: QuoteChatIntent }>> {
  const stored = await browser.storage.session.get(null);
  return Object.entries(stored)
    .filter(([key]) => key.startsWith(STORE_PREFIX))
    .flatMap(([key, value]) => (isIntent(value) ? [{ key, intent: value }] : []))
    .sort(
      (a, b) =>
        a.intent.createdAt.localeCompare(b.intent.createdAt) ||
        a.intent.id.localeCompare(b.intent.id),
    );
}

async function cleanEntries(
  entries: Array<{ key: string; intent: QuoteChatIntent }>,
): Promise<Array<{ key: string; intent: QuoteChatIntent }>> {
  const fresh = entries.filter(({ intent }) => isFresh(intent));
  const staleKeys = entries
    .filter(({ intent }) => !isFresh(intent))
    .map(({ key }) => key);
  if (staleKeys.length > 0) await browser.storage.session.remove(staleKeys);
  return fresh;
}

async function removeMalformedEntries(): Promise<void> {
  const stored = await browser.storage.session.get(null);
  const malformedKeys = Object.entries(stored)
    .filter(([key, value]) => key.startsWith(STORE_PREFIX) && !isIntent(value))
    .map(([key]) => key);
  if (malformedKeys.length > 0) {
    await browser.storage.session.remove(malformedKeys);
  }
}

/**
 * 每条意图使用独立 storage key，生产者并发时不再发生数组 read-modify-write 丢失。
 */
export async function enqueueQuoteIntent(intent: {
  tabId: number;
  title: string;
  url: string;
  text: string;
}): Promise<void> {
  const text = intent.text.slice(0, MAX_TEXT_LENGTH).trim();
  if (!text) return;

  const next: QuoteChatIntent = {
    id: crypto.randomUUID(),
    kind: 'quote',
    tabId: intent.tabId,
    title: intent.title,
    url: intent.url,
    text,
    createdAt: nextCreatedAt(),
  };
  await browser.storage.session.set({ [keyForIntent(next)]: next });

  // 清理属于容量策略，不参与新意图写入；即使并发，唯一 key 也不会互相覆盖。
  await removeMalformedEntries();
  const entries = await cleanEntries(await readEntries());
  const overflow = entries.slice(0, Math.max(0, entries.length - MAX_PENDING));
  if (overflow.length > 0) {
    await browser.storage.session.remove(overflow.map(({ key }) => key));
  }
}

let takeTail: Promise<void> = Promise.resolve();

async function takeNextUnlocked(): Promise<QuoteChatIntent | undefined> {
  await removeMalformedEntries();
  const entries = await cleanEntries(await readEntries());
  const first = entries[0];
  if (!first) return undefined;
  await browser.storage.session.remove(first.key);
  return first.intent;
}

/** 同一侧边栏中的消费者串行取出；意图自身稳定 ID 可供调用方幂等去重。 */
export function takeNextQuoteIntent(): Promise<QuoteChatIntent | undefined> {
  const next = takeTail.then(takeNextUnlocked, takeNextUnlocked);
  takeTail = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

/** 多个侧边栏都经后台单一所有者消费，避免同时 remove 同一意图。 */
export async function requestNextQuoteIntent(): Promise<QuoteChatIntent | undefined> {
  const result: unknown = await browser.runtime.sendMessage({
    type: TAKE_MESSAGE_TYPE,
  });
  return isIntent(result) && isFresh(result) ? result : undefined;
}

/** 监听独立意图 key 的变化；通知仅用于唤醒，消费者仍会重读真实状态。 */
export function onQuoteIntentChanged(callback: () => void): () => void {
  const listener = (
    changes: Record<string, Browser.storage.StorageChange>,
    areaName: string,
  ) => {
    if (
      areaName === 'session' &&
      Object.keys(changes).some((key) => key.startsWith(STORE_PREFIX))
    ) {
      callback();
    }
  };
  browser.storage.onChanged.addListener(listener);
  return () => browser.storage.onChanged.removeListener(listener);
}
