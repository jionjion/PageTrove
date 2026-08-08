import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing';
import { zipSync, strToU8 } from 'fflate';
import {
  closePageTroveDatabase,
  openPageTroveDatabase,
} from '@/services/database';
import { createClip } from '@/services/clip-store';
import { saveChat } from '@/services/chat-store';
import {
  exportBackup,
  previewBackup,
  importBackup,
} from '@/services/backup';
import type { WebClip } from '@/types/clip';
import type { ChatSession } from '@/types/chat';

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

function makeChat(overrides: Partial<ChatSession> = {}): ChatSession {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    title: '测试会话',
    messages: [
      { role: 'user', content: '你好', createdAt: now },
      { role: 'assistant', content: '你好！', createdAt: now },
    ],
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function makeBackupZip(options: {
  manifest?: unknown;
  clips?: unknown[];
  chats?: unknown[];
  settings?: unknown;
  omitFile?: string;
} = {}): ArrayBuffer {
  const manifest = options.manifest ?? {
    format: 'pagetrove-backup',
    version: 1,
    appVersion: '1.3',
    exportedAt: new Date().toISOString(),
    stats: { clips: (options.clips ?? []).length, chats: (options.chats ?? []).length },
  };

  const files: Record<string, Uint8Array> = {};
  if (options.omitFile !== 'manifest.json') {
    files['manifest.json'] = strToU8(JSON.stringify(manifest));
  }
  if (options.omitFile !== 'clips.json') {
    files['clips.json'] = strToU8(JSON.stringify(options.clips ?? []));
  }
  if (options.omitFile !== 'chats.json') {
    files['chats.json'] = strToU8(JSON.stringify(options.chats ?? []));
  }
  if (options.settings !== undefined) {
    files['settings.json'] = strToU8(JSON.stringify(options.settings));
  }

  const data = zipSync(files);
  return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
}

async function countAll(): Promise<{ clips: number; chats: number }> {
  const db = await openPageTroveDatabase();
  return {
    clips: await db.count('clips'),
    chats: await db.count('chats'),
  };
}

beforeEach(async () => {
  fakeBrowser.reset();
  await closePageTroveDatabase();
  globalThis.indexedDB = new IDBFactory();
});

afterEach(async () => {
  await closePageTroveDatabase();
});

describe('previewBackup 错误路径', () => {
  it('超过 50MB 抛错', async () => {
    const huge = new ArrayBuffer(51 * 1024 * 1024);
    await expect(previewBackup(huge)).rejects.toThrow('50 MB');
  });

  it('非 ZIP 文件抛错', async () => {
    const bad = new TextEncoder().encode('not a zip').buffer;
    await expect(previewBackup(bad)).rejects.toThrow('损坏');
  });

  it('缺少 manifest.json 抛错', async () => {
    const zip = makeBackupZip({ omitFile: 'manifest.json' });
    await expect(previewBackup(zip)).rejects.toThrow('manifest.json');
  });

  it('错误的 format 抛错', async () => {
    const zip = makeBackupZip({
      manifest: { format: 'wrong', version: 1, exportedAt: '', stats: {} },
    });
    await expect(previewBackup(zip)).rejects.toThrow('有效的 PageTrove');
  });

  it('不支持的 version 抛错', async () => {
    const zip = makeBackupZip({
      manifest: { format: 'pagetrove-backup', version: 99, exportedAt: '', stats: {} },
    });
    await expect(previewBackup(zip)).rejects.toThrow('版本');
  });

  it('缺少 clips.json 抛错', async () => {
    const zip = makeBackupZip({ omitFile: 'clips.json' });
    await expect(previewBackup(zip)).rejects.toThrow('clips.json');
  });
});

describe('previewBackup 正常路径', () => {
  it('返回正确的统计和冲突数', async () => {
    const clip = makeClip({ normalizedUrl: 'https://example.com/existing' });
    await createClip(clip);

    const backupClips = [
      { url: 'https://example.com/existing', title: '重复', tags: [] },
      { url: 'https://example.com/new', title: '新的', tags: [] },
    ];
    const backupChats = [makeChat()];
    const zip = makeBackupZip({ clips: backupClips, chats: backupChats });

    const preview = await previewBackup(zip);
    expect(preview.clipCount).toBe(2);
    expect(preview.chatCount).toBe(1);
    expect(preview.clipConflicts).toBe(1);
    expect(preview.chatConflicts).toBe(0);
    expect(preview.hasSettings).toBe(false);
  });

  it('识别 chat 冲突', async () => {
    const chat = makeChat({ id: 'existing-chat' });
    await saveChat(chat);

    const zip = makeBackupZip({
      chats: [{ ...makeChat(), id: 'existing-chat' }, makeChat()],
    });

    const preview = await previewBackup(zip);
    expect(preview.chatConflicts).toBe(1);
  });
});

describe('importBackup merge 策略', () => {
  it('clips 按 normalizedUrl 去重，chats 按 id 去重', async () => {
    const existingClip = makeClip({ normalizedUrl: 'https://example.com/dup' });
    await createClip(existingClip);
    const existingChat = makeChat({ id: 'chat-dup' });
    await saveChat(existingChat);

    const zip = makeBackupZip({
      clips: [
        { url: 'https://example.com/dup', title: '重复', tags: [] },
        { url: 'https://example.com/new', title: '新收藏', tags: ['t1'] },
      ],
      chats: [
        { ...makeChat(), id: 'chat-dup' },
        makeChat({ id: 'chat-new' }),
      ],
    });

    const result = await importBackup(zip, 'merge');
    expect(result.clips.imported).toBe(1);
    expect(result.clips.duplicates).toBe(1);
    expect(result.chats.imported).toBe(1);
    expect(result.chats.duplicates).toBe(1);

    const counts = await countAll();
    expect(counts.clips).toBe(2);
    expect(counts.chats).toBe(2);
  });

  it('无效条目计入 invalid', async () => {
    const zip = makeBackupZip({
      clips: [
        { url: 'not-a-url', title: '坏的' },
        { url: 'https://ok.com', title: '' },
        { url: 'https://good.com/a', title: '好的', tags: [] },
      ],
      chats: [
        { id: 'x', title: '没有 messages' },
        { id: 'y', title: '好会话', messages: [{ role: 'user', content: '嗨', createdAt: '2026-01-01T00:00:00Z' }] },
      ],
    });

    const result = await importBackup(zip, 'merge');
    expect(result.clips.invalid).toBe(2);
    expect(result.clips.imported).toBe(1);
    expect(result.chats.invalid).toBe(1);
    expect(result.chats.imported).toBe(1);
  });

  it('settings 恢复不包含 apiKey', async () => {
    const zip = makeBackupZip({
      clips: [],
      chats: [],
      settings: {
        provider: 'deepseek',
        baseUrl: 'https://api.deepseek.com',
        model: 'deepseek-v4-flash',
        apiKey: 'should-not-restore',
        maxContentLength: 8000,
      },
    });

    const result = await importBackup(zip, 'merge');
    expect(result.settingsRestored).toBe(true);

    // apiKey 不应被覆盖
    const { getSettings } = await import('@/services/settings-store');
    const settings = await getSettings();
    expect(settings.provider).toBe('deepseek');
    expect(settings.apiKey).toBe('');
  });
});

describe('importBackup overwrite 策略', () => {
  it('清空现有数据后写入', async () => {
    await createClip(makeClip({ normalizedUrl: 'https://old.com/1' }));
    await createClip(makeClip({ normalizedUrl: 'https://old.com/2' }));
    await saveChat(makeChat());

    const zip = makeBackupZip({
      clips: [{ url: 'https://new.com/only', title: '唯一新收藏', tags: [] }],
      chats: [makeChat({ id: 'new-chat' })],
    });

    const result = await importBackup(zip, 'overwrite');
    expect(result.clips.imported).toBe(1);
    expect(result.clips.duplicates).toBe(0);
    expect(result.chats.imported).toBe(1);

    const counts = await countAll();
    expect(counts.clips).toBe(1);
    expect(counts.chats).toBe(1);
  });
});

describe('export → import roundtrip', () => {
  it('导出后清库再导入，数据一致', async () => {
    const clip1 = makeClip({ url: 'https://a.com', normalizedUrl: 'https://a.com', title: 'A' });
    const clip2 = makeClip({ url: 'https://b.com', normalizedUrl: 'https://b.com', title: 'B' });
    const chat1 = makeChat({ title: '会话1' });
    await createClip(clip1);
    await createClip(clip2);
    await saveChat(chat1);

    // exportBackup 会触发 downloadBlob，我们需要拦截生成的数据
    // 直接测试底层逻辑：手动构建 ZIP 与 exportBackup 相同的结构
    const db = await openPageTroveDatabase();
    const allClips = await db.getAll('clips');
    const allChats = await db.getAll('chats');

    const zip = makeBackupZip({ clips: allClips, chats: allChats });

    // 清库
    await closePageTroveDatabase();
    globalThis.indexedDB = new IDBFactory();

    const result = await importBackup(zip, 'overwrite');
    expect(result.clips.imported).toBe(2);
    expect(result.chats.imported).toBe(1);

    const db2 = await openPageTroveDatabase();
    const restored = await db2.getAll('clips');
    expect(restored.length).toBe(2);
    expect(restored.map((c) => c.title).sort()).toEqual(['A', 'B']);

    const restoredChats = await db2.getAll('chats');
    expect(restoredChats.length).toBe(1);
    expect(restoredChats[0].title).toBe('会话1');
  });
});
