import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing';
import { browser } from 'wxt/browser';
import { strToU8, Zip, ZipPassThrough, zipSync } from 'fflate';
import { closePageTroveDatabase, openPageTroveDatabase } from '@/services/database';
import { createClip } from '@/services/clip-store';
import { saveChat, TOOL_EXECUTION_CLAIM_LEASE_MS } from '@/services/chat-store';
import {
  previewBackup,
  importBackup,
  sanitizeSettingsForBackup,
} from '@/services/backup';
import type { WebClip } from '@/types/clip';
import type { ChatSession } from '@/types/chat';
import { DEFAULT_SETTINGS } from '@/types/settings';
import { getSettings, saveSettings } from '@/services/settings-store';

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

function makeBackupZip(
  options: {
    manifest?: unknown;
    clips?: unknown[];
    chats?: unknown[];
    settings?: unknown;
    omitFile?: string;
  } = {},
): ArrayBuffer {
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

function makeDuplicateFileZip(): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const chunks: Uint8Array[] = [];
    const archive = new Zip((error, data, final) => {
      if (error) {
        reject(error);
        return;
      }
      chunks.push(data);
      if (!final) return;
      const byteLength = chunks.reduce((total, chunk) => total + chunk.byteLength, 0);
      const output = new Uint8Array(byteLength);
      let offset = 0;
      for (const chunk of chunks) {
        output.set(chunk, offset);
        offset += chunk.byteLength;
      }
      resolve(output.buffer);
    });

    const manifest = strToU8(
      JSON.stringify({
        format: 'pagetrove-backup',
        version: 1,
        appVersion: '1.3',
        exportedAt: new Date().toISOString(),
        stats: { clips: 0, chats: 0 },
      }),
    );
    for (const [name, value] of [
      ['manifest.json', manifest],
      ['manifest.json', manifest],
      ['clips.json', strToU8('[]')],
      ['chats.json', strToU8('[]')],
    ] as const) {
      const file = new ZipPassThrough(name);
      archive.add(file);
      file.push(value, true);
    }
    archive.end();
  });
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
  vi.restoreAllMocks();
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

  it('拒绝未知文件和解压后超限的设置文件', async () => {
    const unknownFile = zipSync({
      'manifest.json': strToU8(
        JSON.stringify({
          format: 'pagetrove-backup',
          version: 1,
          appVersion: '1.3',
          exportedAt: new Date().toISOString(),
          stats: { clips: 0, chats: 0 },
        }),
      ),
      'clips.json': strToU8('[]'),
      'chats.json': strToU8('[]'),
      'unexpected.bin': new Uint8Array([1]),
    });
    await expect(
      previewBackup(
        unknownFile.buffer.slice(
          unknownFile.byteOffset,
          unknownFile.byteOffset + unknownFile.byteLength,
        ),
      ),
    ).rejects.toThrow('不允许的文件');

    const oversizedSettings = makeBackupZip({
      settings: { padding: 'x'.repeat(1024 * 1024 + 1) },
    });
    await expect(previewBackup(oversizedSettings)).rejects.toThrow('安全上限');
  });

  it('拒绝同名 ZIP 条目，避免对象键覆盖绕过校验', async () => {
    await expect(previewBackup(await makeDuplicateFileZip())).rejects.toThrow('重复文件');
  });

  it('拒绝压缩比超过安全上限的条目', async () => {
    const zip = makeBackupZip({
      clips: [
        {
          id: 'high-ratio',
          url: 'https://example.com/high-ratio',
          title: '高压缩比',
          tags: [],
          extractedText: 'x'.repeat(8 * 1024 * 1024),
        },
      ],
    });
    await expect(previewBackup(zip)).rejects.toThrow('压缩比');
  });
});

describe('备份秘密与 endpoint 安全', () => {
  it('导出设置移除 API Key、Bearer Token 和全部自定义请求头', () => {
    const safe = sanitizeSettingsForBackup({
      ...DEFAULT_SETTINGS,
      apiKey: 'secret-api-key',
      mcpServers: [
        {
          id: 'm1',
          name: '私有 MCP',
          url: 'https://mcp.example.com',
          transport: 'streamable-http',
          enabled: true,
          bearerToken: 'secret-token',
          headersJson: '{"Authorization":"secret","X-API-Key":"secret"}',
          disabledTools: [],
        },
      ],
    });

    expect(safe.apiKey).toBe('');
    expect(safe.mcpServers[0]).not.toHaveProperty('bearerToken');
    expect(safe.mcpServers[0]).not.toHaveProperty('headersJson');
    expect(JSON.stringify(safe)).not.toContain('secret');
  });

  it('内置 provider 忽略备份伪造 endpoint，endpoint 变化时清空现有 Key', async () => {
    await saveSettings({
      provider: 'qwen',
      baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      apiKey: 'existing-secret',
    });
    const zip = makeBackupZip({
      settings: {
        provider: 'deepseek',
        baseUrl: 'https://attacker.example.com/steal',
        model: 'deepseek-v4-flash',
      },
    });

    const preview = await previewBackup(zip);
    expect(preview.settingsStatus).toBe('ready');
    expect(preview.settings).toMatchObject({
      provider: 'deepseek',
      baseUrl: 'https://api.deepseek.com',
      endpointWillChange: true,
      clearsApiKey: true,
    });

    await importBackup(zip, 'merge');
    const restored = await getSettings();
    expect(restored.baseUrl).toBe('https://api.deepseek.com');
    expect(restored.apiKey).toBe('');
  });

  it('自定义 endpoint 变化必须由调用方显式确认', async () => {
    const zip = makeBackupZip({
      settings: {
        provider: 'custom',
        baseUrl: 'https://custom.example.com/v1',
        model: 'custom-model',
      },
    });

    const preview = await previewBackup(zip);
    expect(preview.settings).toMatchObject({
      provider: 'custom',
      baseUrl: 'https://custom.example.com/v1',
      endpointWillChange: true,
    });

    const unconfirmed = await importBackup(zip, 'merge');
    expect(unconfirmed.settings.status).toBe('failed');
    expect(unconfirmed.settings.error).toContain('未经确认');
    expect((await getSettings()).provider).toBe(DEFAULT_SETTINGS.provider);

    const confirmed = await importBackup(zip, 'merge', {
      confirmCustomEndpoint: true,
    });
    expect(confirmed.settings).toEqual({ status: 'restored' });
    expect(await getSettings()).toMatchObject({
      provider: 'custom',
      baseUrl: 'https://custom.example.com/v1',
      model: 'custom-model',
    });
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
    expect(preview.settingsStatus).toBe('absent');
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
      chats: [{ ...makeChat(), id: 'chat-dup' }, makeChat({ id: 'chat-new' })],
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
        {
          id: 'y',
          title: '好会话',
          messages: [{ role: 'user', content: '嗨', createdAt: '2026-01-01T00:00:00Z' }],
        },
      ],
    });

    const result = await importBackup(zip, 'merge');
    expect(result.clips.invalid).toBe(2);
    expect(result.clips.imported).toBe(1);
    expect(result.chats.invalid).toBe(1);
    expect(result.chats.imported).toBe(1);
  });

  it('merge 跳过并报告无法解析的顶层与 scope 收藏引用', async () => {
    const zip = makeBackupZip({
      chats: [
        makeChat({ id: 'missing-top-level', clipId: 'missing-clip' }),
        makeChat({
          id: 'missing-scope',
          scope: {
            mode: 'clips',
            sources: [
              {
                id: 'source-1',
                type: 'clip',
                clipId: 'missing-clip',
                title: '失联收藏',
                url: 'https://missing.example.com',
              },
            ],
          },
        }),
      ],
    });

    const result = await importBackup(zip, 'merge');
    expect(result.chats).toEqual({ imported: 0, duplicates: 0, invalid: 2 });
    expect(await countAll()).toEqual({ clips: 0, chats: 0 });
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
    expect(result.settings).toEqual({ status: 'restored' });

    // apiKey 不应被覆盖
    const settings = await getSettings();
    expect(settings.provider).toBe('deepseek');
    expect(settings.apiKey).toBe('');
  });

  it('设置文件无效时显式报告失败，但核心数据仍完成导入', async () => {
    const zip = makeBackupZip({
      clips: [
        {
          id: 'core-clip',
          url: 'https://core.example.com',
          title: '核心数据',
          tags: [],
        },
      ],
      settings: { provider: 'unknown-provider', baseUrl: 'javascript:bad' },
    });

    const preview = await previewBackup(zip);
    expect(preview.settingsStatus).toBe('invalid');

    const result = await importBackup(zip, 'merge');
    expect(result.clips.imported).toBe(1);
    expect(result.settingsRestored).toBe(false);
    expect(result.settings).toMatchObject({ status: 'failed' });
    expect(await countAll()).toEqual({ clips: 1, chats: 0 });
  });

  it('settings storage 写入失败不吞错，返回安全的部分成功结果', async () => {
    const storageSet = vi
      .spyOn(browser.storage.local, 'set')
      .mockRejectedValueOnce(new Error('raw storage secret'));
    const zip = makeBackupZip({
      clips: [
        {
          id: 'committed-clip',
          url: 'https://committed.example.com',
          title: '已提交核心数据',
          tags: [],
        },
      ],
      settings: {
        provider: 'deepseek',
        baseUrl: 'https://api.deepseek.com',
        model: 'deepseek-v4-flash',
      },
    });

    const result = await importBackup(zip, 'merge');
    expect(storageSet).toHaveBeenCalledOnce();
    expect(result.clips.imported).toBe(1);
    expect(result.settingsRestored).toBe(false);
    expect(result.settings.status).toBe('failed');
    expect(result.settings.error).toContain('设置未能恢复');
    expect(result.settings.error).not.toContain('raw storage secret');
    expect(await countAll()).toEqual({ clips: 1, chats: 0 });
  });

  it('收藏 ID 冲突时重映射聊天 clipId，不错指现有收藏', async () => {
    await createClip(
      makeClip({
        id: 'same-id',
        url: 'https://existing.example.com',
        normalizedUrl: 'https://existing.example.com',
        title: '库内原收藏',
      }),
    );
    const zip = makeBackupZip({
      clips: [
        {
          id: 'same-id',
          url: 'https://backup.example.com',
          title: '备份收藏',
          tags: [],
        },
      ],
      chats: [makeChat({ id: 'mapped-chat', clipId: 'same-id' })],
    });

    await importBackup(zip, 'merge');
    const db = await openPageTroveDatabase();
    const importedChat = await db.get('chats', 'mapped-chat');
    expect(importedChat?.clipId).toBeTruthy();
    expect(importedChat?.clipId).not.toBe('same-id');
    expect((await db.get('clips', importedChat!.clipId!))?.url).toBe(
      'https://backup.example.com/',
    );
  });

  it('URL 重复时把聊天关联到已存在的收藏', async () => {
    await createClip(
      makeClip({
        id: 'existing-id',
        url: 'https://same.example.com',
        normalizedUrl: 'https://same.example.com',
      }),
    );
    const zip = makeBackupZip({
      clips: [
        {
          id: 'backup-id',
          url: 'https://same.example.com',
          title: '重复收藏',
          tags: [],
        },
      ],
      chats: [makeChat({ id: 'duplicate-url-chat', clipId: 'backup-id' })],
    });

    await importBackup(zip, 'merge');
    const db = await openPageTroveDatabase();
    expect((await db.get('chats', 'duplicate-url-chat'))?.clipId).toBe('existing-id');
  });

  it('scope 收藏引用按 clip ID 映射，citation 只保留最终来源', async () => {
    await createClip(
      makeClip({
        id: 'same-id',
        url: 'https://existing.example.com',
        normalizedUrl: 'https://existing.example.com',
      }),
    );
    const now = new Date().toISOString();
    const zip = makeBackupZip({
      clips: [
        {
          id: 'same-id',
          url: 'https://backup-scope.example.com',
          title: '备份来源',
          tags: [],
        },
      ],
      chats: [
        makeChat({
          id: 'scope-chat',
          scope: {
            mode: 'clips',
            sources: [
              {
                id: 'source-1',
                type: 'clip',
                clipId: 'same-id',
                title: '备份来源',
                url: 'https://backup-scope.example.com',
              },
            ],
          },
          messages: [
            { role: 'user', content: '问题', createdAt: now },
            {
              role: 'assistant',
              content: '答案 [S1]',
              createdAt: now,
              citationRefs: [
                {
                  citation: 'S1',
                  sourceId: 'source-1',
                  title: '备份来源',
                  url: 'https://backup-scope.example.com',
                },
                {
                  citation: 'S2',
                  sourceId: 'orphan-source',
                  title: '错误来源',
                  url: 'https://orphan.example.com',
                },
              ],
            },
          ],
        }),
      ],
    });

    await importBackup(zip, 'merge');
    const db = await openPageTroveDatabase();
    const restored = await db.get('chats', 'scope-chat');
    const source = restored?.scope?.sources[0];
    expect(source).toMatchObject({
      id: 'source-1',
      type: 'clip',
      title: '备份来源',
    });
    expect(source?.type).toBe('clip');
    if (source?.type === 'clip') {
      expect(source.clipId).not.toBe('same-id');
      expect((await db.get('clips', source.clipId))?.url).toBe(
        'https://backup-scope.example.com/',
      );
    }
    expect(restored?.messages[1].citationRefs).toEqual([
      {
        citation: 'S1',
        sourceId: 'source-1',
        title: '备份来源',
        url: 'https://backup-scope.example.com/',
      },
    ]);
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

  it('备份含无效记录时拒绝覆盖且保留原数据', async () => {
    const existing = makeClip({
      id: 'keep-me',
      url: 'https://keep.example.com',
      normalizedUrl: 'https://keep.example.com',
    });
    await createClip(existing);
    await saveChat(makeChat({ id: 'keep-chat' }));
    const zip = makeBackupZip({
      clips: [{ url: 'not-a-url', title: '无效记录' }],
      chats: [],
    });

    await expect(importBackup(zip, 'overwrite')).rejects.toThrow('覆盖恢复已取消');
    const db = await openPageTroveDatabase();
    expect(await db.get('clips', 'keep-me')).toBeDefined();
    expect(await db.get('chats', 'keep-chat')).toBeDefined();
  });

  it('无效 MCP 执行审计会使整条会话失败，覆盖前保留原数据', async () => {
    const existing = makeChat({ id: 'keep-audit-chat' });
    await saveChat(existing);
    const zip = makeBackupZip({
      chats: [
        makeChat({
          id: 'invalid-audit-chat',
          messages: [
            {
              id: 'turn-valid',
              role: 'user',
              content: '问题',
              createdAt: '2026-08-12T00:00:00Z',
            },
          ],
          toolExecutions: [
            {
              id: 'execution-invalid',
              serverName: '测试 MCP',
              toolName: 'create_item',
              status: 'unknown',
              operationKey: 'not-a-valid-fingerprint',
              turnId: 'turn-valid',
            },
          ],
        }),
      ],
    });

    await expect(importBackup(zip, 'overwrite')).rejects.toThrow('覆盖恢复已取消');
    const db = await openPageTroveDatabase();
    expect(await db.get('chats', existing.id)).toEqual(existing);
    expect(await db.get('chats', 'invalid-audit-chat')).toBeUndefined();
  });

  it('重新生成截断的旧 turn 审计仍可恢复', async () => {
    const operationKey = `sha256-v1:${'e'.repeat(64)}`;
    const zip = makeBackupZip({
      chats: [
        makeChat({
          id: 'retired-turn-chat',
          messages: [
            {
              id: 'current-turn',
              role: 'user',
              content: '当前问题',
              createdAt: '2026-08-12T00:00:00Z',
            },
          ],
          toolExecutions: [
            {
              id: 'retired-execution',
              serverName: '测试 MCP',
              toolName: 'create_item',
              status: 'success',
              operationKey,
              turnId: 'truncated-old-turn',
              summary: '调用成功',
            },
          ],
        }),
      ],
    });

    await expect(importBackup(zip, 'overwrite')).resolves.toMatchObject({
      chats: { imported: 1, invalid: 0 },
    });
    const db = await openPageTroveDatabase();
    expect((await db.get('chats', 'retired-turn-chat'))?.toolExecutions).toEqual([
      expect.objectContaining({ turnId: 'truncated-old-turn', operationKey }),
    ]);
  });

  it('存在租约内 claimed 工具执行时禁止覆盖清库', async () => {
    const existing = makeChat({
      id: 'keep-running-audit',
      toolExecutions: [
        {
          id: 'execution-running',
          serverName: '测试 MCP',
          toolName: 'create_item',
          status: 'unknown',
          phase: 'claimed',
          claimedAt: new Date().toISOString(),
          operationKey: `sha256-v1:${'d'.repeat(64)}`,
          turnId: 'turn-running',
        },
      ],
    });
    await saveChat(existing);
    const zip = makeBackupZip({
      chats: [makeChat({ id: 'replacement-chat' })],
    });

    await expect(importBackup(zip, 'overwrite')).rejects.toThrow(
      '存在正在执行的工具调用',
    );
    const db = await openPageTroveDatabase();
    expect(await db.get('chats', existing.id)).toEqual(existing);
    expect(await db.get('chats', 'replacement-chat')).toBeUndefined();
  });

  it('过期 claimed 租约不会永久锁死覆盖恢复', async () => {
    const existing = makeChat({
      id: 'expired-claim-backup',
      toolExecutions: [
        {
          id: 'execution-expired',
          serverName: '测试 MCP',
          toolName: 'create_item',
          status: 'unknown',
          phase: 'claimed',
          claimedAt: new Date(
            Date.now() - TOOL_EXECUTION_CLAIM_LEASE_MS - 1,
          ).toISOString(),
          operationKey: `sha256-v1:${'a'.repeat(64)}`,
          turnId: 'turn-expired',
        },
      ],
    });
    await saveChat(existing);
    const zip = makeBackupZip({
      chats: [makeChat({ id: 'replacement-after-expiry' })],
    });

    await expect(importBackup(zip, 'overwrite')).resolves.toMatchObject({
      chats: { imported: 1 },
    });
    const db = await openPageTroveDatabase();
    expect(await db.get('chats', existing.id)).toBeUndefined();
    expect(await db.get('chats', 'replacement-after-expiry')).toBeDefined();
  });

  it('会话含失联收藏引用时 fail closed，且不会清空原库', async () => {
    await createClip(
      makeClip({
        id: 'keep-clip',
        url: 'https://keep-reference.example.com',
        normalizedUrl: 'https://keep-reference.example.com',
      }),
    );
    await saveChat(makeChat({ id: 'keep-reference-chat' }));
    const zip = makeBackupZip({
      chats: [makeChat({ id: 'broken-chat', clipId: 'not-in-backup' })],
    });

    await expect(importBackup(zip, 'overwrite')).rejects.toThrow('覆盖恢复已取消');
    const db = await openPageTroveDatabase();
    expect(await db.get('clips', 'keep-clip')).toBeDefined();
    expect(await db.get('chats', 'keep-reference-chat')).toBeDefined();
  });
});

describe('export → import roundtrip', () => {
  it('导出后清库再导入，数据一致', async () => {
    const clip1 = makeClip({
      url: 'https://a.com',
      normalizedUrl: 'https://a.com',
      title: 'A',
    });
    const clip2 = makeClip({
      url: 'https://b.com',
      normalizedUrl: 'https://b.com',
      title: 'B',
    });
    const turnId = 'turn-roundtrip';
    const operationKey = `sha256-v1:${'b'.repeat(64)}`;
    const chat1 = makeChat({
      title: '会话1',
      messages: [
        {
          id: turnId,
          role: 'user',
          content: '请创建记录',
          createdAt: '2026-08-12T00:00:00Z',
        },
      ],
      toolExecutions: [
        {
          id: 'execution-roundtrip',
          serverName: '测试 MCP',
          toolName: 'create_item',
          status: 'unknown',
          phase: 'claimed',
          claimedAt: new Date().toISOString(),
          operationKey,
          turnId,
          summary: '执行结果未知',
        },
      ],
    });
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
    expect(restoredChats[0].messages[0].id).toBe(turnId);
    expect(restoredChats[0].toolExecutions).toEqual([
      expect.objectContaining({
        id: 'execution-roundtrip',
        status: 'unknown',
        operationKey,
        turnId,
        phase: 'in-doubt',
      }),
    ]);
  });
});
