import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing';
import { browser } from 'wxt/browser';
import {
  enqueueQuoteIntent,
  isTakeIntentMessage,
  onQuoteIntentChanged,
  requestNextQuoteIntent,
  takeNextQuoteIntent,
} from '@/services/chat-intent-store';

const STORE_PREFIX = 'pendingChatIntent:';

function baseIntent(text = '选中文字') {
  return { tabId: 1, title: '标题', url: 'https://example.com', text };
}

async function readStored(): Promise<unknown[]> {
  const result = await browser.storage.session.get(null);
  return Object.entries(result)
    .filter(([key]) => key.startsWith(STORE_PREFIX))
    .map(([, value]) => value);
}

describe('enqueueQuoteIntent', () => {
  beforeEach(() => fakeBrowser.reset());

  it('用独立 key 入队并补齐 id/kind/createdAt', async () => {
    await enqueueQuoteIntent(baseIntent());
    const stored = await readStored();
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({
      kind: 'quote',
      tabId: 1,
      title: '标题',
      url: 'https://example.com',
      text: '选中文字',
    });
    const record = stored[0] as Record<string, unknown>;
    expect(typeof record.id).toBe('string');
    expect(Number.isNaN(Date.parse(record.createdAt as string))).toBe(false);
  });

  it('并发入队不会因数组 read-modify-write 丢消息', async () => {
    await Promise.all([
      enqueueQuoteIntent(baseIntent('first')),
      enqueueQuoteIntent(baseIntent('second')),
      enqueueQuoteIntent(baseIntent('third')),
    ]);
    expect(
      (await readStored()).map((item) => (item as { text: string }).text).sort(),
    ).toEqual(['first', 'second', 'third']);
  });

  it('截断超长文字，丢弃空白，容量最多 5 条', async () => {
    await enqueueQuoteIntent(baseIntent('x'.repeat(20_000)));
    expect((await readStored())[0]).toMatchObject({ text: 'x'.repeat(10_000) });
    fakeBrowser.reset();
    await enqueueQuoteIntent(baseIntent('   \n\t  '));
    expect(await readStored()).toHaveLength(0);

    for (let i = 0; i < 7; i++) {
      await enqueueQuoteIntent(baseIntent(`msg-${i}`));
    }
    const stored = await readStored();
    expect(stored).toHaveLength(5);
    expect(stored.map((item) => (item as { text: string }).text)).not.toContain('msg-0');
  });
});

describe('takeNextQuoteIntent', () => {
  beforeEach(() => fakeBrowser.reset());

  it('按 FIFO 取出；并发 take 在单个消费者上下文中不会重复', async () => {
    await enqueueQuoteIntent(baseIntent('first'));
    await enqueueQuoteIntent(baseIntent('second'));
    const [first, second, empty] = await Promise.all([
      takeNextQuoteIntent(),
      takeNextQuoteIntent(),
      takeNextQuoteIntent(),
    ]);
    expect(first?.text).toBe('first');
    expect(second?.text).toBe('second');
    expect(empty).toBeUndefined();
  });

  it('过期和非法独立记录被清理', async () => {
    const stale = {
      kind: 'quote',
      id: 'stale-id',
      tabId: 1,
      title: 'stale',
      url: 'https://example.com',
      text: 'stale',
      createdAt: new Date(Date.now() - 11 * 60_000).toISOString(),
    };
    await browser.storage.session.set({
      [`${STORE_PREFIX}stale`]: stale,
      [`${STORE_PREFIX}invalid`]: { kind: 'quote', id: 1 },
    });
    await enqueueQuoteIntent(baseIntent('fresh'));

    expect((await takeNextQuoteIntent())?.text).toBe('fresh');
    expect(await takeNextQuoteIntent()).toBeUndefined();
  });

  it('侧边栏消息经后台单一消费者取出并校验 DTO', async () => {
    browser.runtime.onMessage.addListener((message: unknown) => {
      if (!isTakeIntentMessage(message)) return;
      return takeNextQuoteIntent();
    });
    await enqueueQuoteIntent(baseIntent('owned-by-background'));

    await expect(requestNextQuoteIntent()).resolves.toMatchObject({
      kind: 'quote',
      text: 'owned-by-background',
    });
    await expect(requestNextQuoteIntent()).resolves.toBeUndefined();
  });
});

describe('onQuoteIntentChanged', () => {
  beforeEach(() => fakeBrowser.reset());

  it('独立意图 key 变化触发；取消监听及其他 key 不触发', async () => {
    const callback = vi.fn();
    const off = onQuoteIntentChanged(callback);
    await enqueueQuoteIntent(baseIntent());
    expect(callback).toHaveBeenCalled();
    const calls = callback.mock.calls.length;

    await browser.storage.session.set({ other: 'value' });
    expect(callback).toHaveBeenCalledTimes(calls);
    off();
    await enqueueQuoteIntent(baseIntent('again'));
    expect(callback).toHaveBeenCalledTimes(calls);
  });
});
