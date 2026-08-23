import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing';
import { closePageTroveDatabase, openPageTroveDatabase } from '@/services/database';
import { createClip, getClip, updateClip } from '@/services/clip-store';
import type { WebClip } from '@/types/clip';

function makeClip(overrides: Partial<WebClip> = {}): WebClip {
  const now = new Date().toISOString();
  return {
    id: 'clip-1',
    url: 'https://example.com/first',
    normalizedUrl: 'https://example.com/first',
    domain: 'example.com',
    title: '第一版',
    tags: [],
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

beforeEach(async () => {
  fakeBrowser.reset();
  await closePageTroveDatabase();
  globalThis.indexedDB = new IDBFactory();
});

afterEach(async () => closePageTroveDatabase());

describe('createClip', () => {
  it('重复 ID 不会覆盖既有收藏，详情与索引保持一致', async () => {
    const original = makeClip();
    await createClip(original);
    await expect(
      createClip(
        makeClip({
          title: '不应覆盖',
          url: 'https://example.com/other',
          normalizedUrl: 'https://example.com/other',
        }),
      ),
    ).rejects.toMatchObject({ code: 'DUPLICATE_CLIP' });

    expect(await getClip(original.id)).toEqual(original);
    const db = await openPageTroveDatabase();
    expect(await db.get('clipEntries', original.id)).toMatchObject({
      title: '第一版',
      normalizedUrl: 'https://example.com/first',
    });
  });

  it('预先取消的新建和更新都不会写入', async () => {
    const controller = new AbortController();
    controller.abort(new DOMException('页面已切换', 'AbortError'));
    await expect(createClip(makeClip(), controller.signal)).rejects.toMatchObject({
      name: 'AbortError',
    });
    expect(await getClip('clip-1')).toBeUndefined();

    const original = makeClip({ id: 'clip-2' });
    await createClip(original);
    await expect(
      updateClip('clip-2', { title: '不应写入' }, controller.signal),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(await getClip('clip-2')).toEqual(original);
  });
});
