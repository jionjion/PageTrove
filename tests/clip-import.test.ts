import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing';
import {
  closePageTroveDatabase,
  openPageTroveDatabase,
} from '@/services/database';
import { createClip, exportAll, importAll } from '@/services/clip-store';
import type { WebClip } from '@/types/clip';

function makeClip(overrides: Partial<WebClip> = {}): WebClip {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    url: 'https://example.com/a',
    normalizedUrl: 'https://example.com/a',
    domain: 'example.com',
    title: '示例收藏',
    tags: [],
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function exportJson(clips: unknown[], version: unknown = 1): string {
  return JSON.stringify({ version, exportedAt: new Date().toISOString(), clips });
}

async function countStores(): Promise<{ clips: number; entries: number }> {
  const db = await openPageTroveDatabase();
  return {
    clips: await db.count('clips'),
    entries: await db.count('clipEntries'),
  };
}

beforeEach(async () => {
  fakeBrowser.reset();
  await closePageTroveDatabase();
  // 每个用例一个全新的 IndexedDB 实例
  globalThis.indexedDB = new IDBFactory();
});

afterEach(async () => {
  await closePageTroveDatabase();
});

describe('importAll 错误路径（不落库）', () => {
  it('超过 10MB 抛错', async () => {
    const huge = `{"pad":"${'x'.repeat(10 * 1024 * 1024)}"}`;
    await expect(importAll(huge)).rejects.toThrow('10 MB');
  });

  it('无效 JSON 抛错', async () => {
    await expect(importAll('{broken')).rejects.toThrow('有效的 JSON');
  });

  it('非对象结构抛错', async () => {
    await expect(importAll('[1,2]')).rejects.toThrow('结构无效');
  });

  it('版本缺失或不匹配抛错', async () => {
    await expect(importAll(JSON.stringify({ clips: [] }))).rejects.toThrow(
      '不支持的导出版本',
    );
    await expect(importAll(exportJson([], 2))).rejects.toThrow(
      '不支持的导出版本',
    );
  });

  it('缺少 clips 字段抛错', async () => {
    await expect(importAll(JSON.stringify({ version: 1 }))).rejects.toThrow(
      'clips 字段',
    );
  });

  it('超过 5000 条抛错', async () => {
    const clips = Array.from({ length: 5_001 }, () => ({}));
    await expect(importAll(exportJson(clips))).rejects.toThrow('5000');
  });
});

describe('importAll 导入与一致性', () => {
  it('合法条目导入后 clips 与 clipEntries 数量一致', async () => {
    const result = await importAll(
      exportJson([
        { url: 'https://a.example.com/x', title: '甲' },
        { url: 'https://b.example.com/y', title: '乙' },
      ]),
    );
    expect(result).toEqual({ imported: 2, duplicates: 0, invalid: 0 });
    expect(await countStores()).toEqual({ clips: 2, entries: 2 });
  });

  it('缺 url 或 title 的条目计 invalid', async () => {
    const result = await importAll(
      exportJson([
        { title: '没有地址' },
        { url: 'https://a.example.com', title: '正常' },
        { url: 'ftp://bad.protocol', title: '协议不支持' },
        'not-an-object',
      ]),
    );
    expect(result).toEqual({ imported: 1, duplicates: 0, invalid: 3 });
  });

  it('超长字段截断、tags 去重限数、非法 favicon 丢弃', async () => {
    await importAll(
      exportJson([
        {
          url: 'https://a.example.com',
          title: 't'.repeat(600),
          summary: 's'.repeat(2_000),
          userNote: 'n'.repeat(60_000),
          faviconUrl: 'javascript:alert(1)',
          tags: ['x', 'x', ...Array.from({ length: 30 }, (_, i) => `tag-${i}`)],
        },
      ]),
    );
    const db = await openPageTroveDatabase();
    const [clip] = await db.getAll('clips');
    expect(clip.title).toHaveLength(500);
    expect(clip.summary).toHaveLength(1_000);
    expect(clip.userNote).toHaveLength(50_000);
    expect(clip.faviconUrl).toBeUndefined();
    expect(clip.tags).toHaveLength(20);
    expect(new Set(clip.tags).size).toBe(20);
  });

  it('非法 id 与批内重复 id 重新生成', async () => {
    await importAll(
      exportJson([
        { url: 'https://a.example.com', title: '甲', id: 'has space!' },
        { url: 'https://b.example.com', title: '乙', id: 'same-id' },
        { url: 'https://c.example.com', title: '丙', id: 'same-id' },
      ]),
    );
    const db = await openPageTroveDatabase();
    const clips = await db.getAll('clips');
    const ids = clips.map((c) => c.id);
    expect(new Set(ids).size).toBe(3);
    expect(ids).toContain('same-id'); // 首次出现保留
    expect(ids).not.toContain('has space!'); // 非法字符重新生成
  });

  it('库内已有同 normalizedUrl 计 duplicates', async () => {
    await createClip(makeClip({ normalizedUrl: 'https://a.example.com/x' }));
    const result = await importAll(
      exportJson([{ url: 'https://a.example.com/x', title: '重复' }]),
    );
    expect(result).toEqual({ imported: 0, duplicates: 1, invalid: 0 });
    expect(await countStores()).toEqual({ clips: 1, entries: 1 });
  });

  it('批内两条同 normalizedUrl 第二条计 duplicates', async () => {
    const result = await importAll(
      exportJson([
        { url: 'https://a.example.com/x', title: '第一条' },
        { url: 'https://a.example.com/x', title: '第二条' },
      ]),
    );
    expect(result).toEqual({ imported: 1, duplicates: 1, invalid: 0 });
    const db = await openPageTroveDatabase();
    const [clip] = await db.getAll('clips');
    expect(clip.title).toBe('第一条');
  });
});

describe('exportAll → importAll roundtrip', () => {
  it('导出再导入到空库，数量与关键字段一致', async () => {
    await createClip(
      makeClip({
        url: 'https://a.example.com/1',
        normalizedUrl: 'https://a.example.com/1',
        title: '甲',
        tags: ['读书'],
        userNote: '笔记',
      }),
    );
    await createClip(
      makeClip({
        url: 'https://b.example.com/2',
        normalizedUrl: 'https://b.example.com/2',
        title: '乙',
      }),
    );
    const json = await exportAll();

    // 换一个全新的空库
    await closePageTroveDatabase();
    globalThis.indexedDB = new IDBFactory();

    const result = await importAll(json);
    expect(result).toEqual({ imported: 2, duplicates: 0, invalid: 0 });

    const db = await openPageTroveDatabase();
    const clips = await db.getAll('clips');
    const byTitle = new Map(clips.map((c) => [c.title, c]));
    expect(byTitle.get('甲')).toMatchObject({
      url: 'https://a.example.com/1',
      tags: ['读书'],
      userNote: '笔记',
    });
    expect(byTitle.get('乙')).toMatchObject({ url: 'https://b.example.com/2' });
  });
});
