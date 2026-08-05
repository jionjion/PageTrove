import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing';
import { browser } from 'wxt/browser';
import {
  enqueueQuoteIntent,
  onQuoteIntentChanged,
  takeNextQuoteIntent,
} from '@/services/chat-intent-store';

const STORE_KEY = 'pendingChatIntents';

function baseIntent(text = '选中文字') {
  return { tabId: 1, title: '标题', url: 'https://example.com', text };
}

async function readStored(): Promise<unknown[]> {
  const result = await browser.storage.session.get(STORE_KEY);
  return (result[STORE_KEY] as unknown[]) ?? [];
}

describe('enqueueQuoteIntent', () => {
  beforeEach(() => {
    fakeBrowser.reset();
  });

  it('入队一条意图并补齐 id/kind/createdAt', async () => {
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

  it('超长文字截断到 10000 字符', async () => {
    await enqueueQuoteIntent(baseIntent('x'.repeat(20_000)));
    const stored = await readStored();
    expect((stored[0] as { text: string }).text).toHaveLength(10_000);
  });

  it('纯空白文字直接丢弃', async () => {
    await enqueueQuoteIntent(baseIntent('   \n\t  '));
    expect(await readStored()).toHaveLength(0);
  });

  it('队列超过 5 条时丢弃最旧的', async () => {
    for (let i = 0; i < 7; i++) {
      await enqueueQuoteIntent(baseIntent(`msg-${i}`));
    }
    const stored = await readStored();
    expect(stored).toHaveLength(5);
    expect(stored.map((s) => (s as { text: string }).text)).toEqual([
      'msg-2',
      'msg-3',
      'msg-4',
      'msg-5',
      'msg-6',
    ]);
  });
});

describe('takeNextQuoteIntent', () => {
  beforeEach(() => {
    fakeBrowser.reset();
  });

  it('按 FIFO 顺序取出并移除', async () => {
    await enqueueQuoteIntent(baseIntent('first'));
    await enqueueQuoteIntent(baseIntent('second'));

    const first = await takeNextQuoteIntent();
    expect(first?.text).toBe('first');
    const second = await takeNextQuoteIntent();
    expect(second?.text).toBe('second');
    expect(await takeNextQuoteIntent()).toBeUndefined();
  });

  it('空队列返回 undefined 并清空存储', async () => {
    expect(await takeNextQuoteIntent()).toBeUndefined();
    expect(await readStored()).toEqual([]);
  });

  it('过期意图（超过 10 分钟）被过滤', async () => {
    await enqueueQuoteIntent(baseIntent('fresh'));
    const stored = await readStored();
    const stale = {
      ...(stored[0] as Record<string, unknown>),
      id: 'stale-id',
      text: 'stale',
      createdAt: new Date(Date.now() - 11 * 60_000).toISOString(),
    };
    await browser.storage.session.set({ [STORE_KEY]: [stale, ...stored] });

    const next = await takeNextQuoteIntent();
    expect(next?.text).toBe('fresh');
    expect(await takeNextQuoteIntent()).toBeUndefined();
  });

  it('storage 中的非法脏数据被过滤', async () => {
    await enqueueQuoteIntent(baseIntent('valid'));
    const stored = await readStored();
    await browser.storage.session.set({
      [STORE_KEY]: [
        null,
        42,
        { kind: 'other' },
        { kind: 'quote', id: 1 }, // id 类型错误
        ...stored,
      ],
    });

    const next = await takeNextQuoteIntent();
    expect(next?.text).toBe('valid');
    expect(await takeNextQuoteIntent()).toBeUndefined();
  });
});

describe('onQuoteIntentChanged', () => {
  beforeEach(() => {
    fakeBrowser.reset();
  });

  it('入队后触发回调；取消监听后不再触发', async () => {
    const callback = vi.fn();
    const off = onQuoteIntentChanged(callback);

    await enqueueQuoteIntent(baseIntent());
    expect(callback).toHaveBeenCalledTimes(1);

    off();
    await enqueueQuoteIntent(baseIntent('again'));
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it('其他 storage 键变化不触发回调', async () => {
    const callback = vi.fn();
    onQuoteIntentChanged(callback);

    await browser.storage.session.set({ other: 'value' });
    expect(callback).not.toHaveBeenCalled();
  });
});
