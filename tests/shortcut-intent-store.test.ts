import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing';
import { browser } from 'wxt/browser';
import {
  enqueueShortcutIntent,
  onShortcutIntentChanged,
  takeShortcutIntent,
} from '@/services/shortcut-intent-store';

const INTENT_KEY = 'pendingShortcutIntent';

describe('shortcut-intent-store', () => {
  beforeEach(() => fakeBrowser.reset());

  it('入队补齐 id/createdAt,取出后即清空', async () => {
    await enqueueShortcutIntent({ view: 'clips' });
    const intent = await takeShortcutIntent();
    expect(intent).toMatchObject({ view: 'clips' });
    expect(typeof intent?.id).toBe('string');
    expect(Number.isNaN(Date.parse(intent!.createdAt))).toBe(false);
    expect(await takeShortcutIntent()).toBeUndefined();
  });

  it('newChat 标记往返保留', async () => {
    await enqueueShortcutIntent({ view: 'chat', newChat: true });
    expect(await takeShortcutIntent()).toMatchObject({ view: 'chat', newChat: true });
  });

  it('只保留最新一条导航意图', async () => {
    await enqueueShortcutIntent({ view: 'clips' });
    await enqueueShortcutIntent({ view: 'history' });
    expect((await takeShortcutIntent())?.view).toBe('history');
    expect(await takeShortcutIntent()).toBeUndefined();
  });

  it('过期意图被丢弃并清理', async () => {
    await browser.storage.session.set({
      [INTENT_KEY]: {
        id: 'stale',
        view: 'clips',
        createdAt: new Date(Date.now() - 120_000).toISOString(),
      },
    });
    expect(await takeShortcutIntent()).toBeUndefined();
    expect(await browser.storage.session.get(INTENT_KEY)).toEqual({});
  });

  it('畸形数据不会进入消费端', async () => {
    await browser.storage.session.set({ [INTENT_KEY]: { view: 'not-a-view' } });
    expect(await takeShortcutIntent()).toBeUndefined();
  });

  it('并发取出不会重复消费同一意图', async () => {
    await enqueueShortcutIntent({ view: 'research' });
    const [a, b] = await Promise.all([takeShortcutIntent(), takeShortcutIntent()]);
    expect([a, b].filter(Boolean)).toHaveLength(1);
  });

  it('session 意图变化触发监听,其他 key 不触发', async () => {
    const callback = vi.fn();
    const dispose = onShortcutIntentChanged(callback);
    await browser.storage.session.set({ unrelated: 1 });
    expect(callback).not.toHaveBeenCalled();
    await enqueueShortcutIntent({ view: 'chat' });
    expect(callback).toHaveBeenCalledTimes(1);
    dispose();
    await enqueueShortcutIntent({ view: 'clips' });
    expect(callback).toHaveBeenCalledTimes(1);
  });
});
