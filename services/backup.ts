import { zipSync, unzipSync, strToU8 } from 'fflate';
import type { WebClip } from '@/types/clip';
import type { ChatSession, ChatMessage, ChatSourceRef } from '@/types/chat';
import type { ExtensionSettings } from '@/types/settings';
import { AppError } from '@/utils/errors';
import { mapDatabaseError, openPageTroveDatabase } from '@/services/database';
import { getSettings, saveSettings } from '@/services/settings-store';
import { downloadBlob } from '@/services/obsidian-export';
import { emitDataChanged } from '@/services/data-events';
import {
  isRecord,
  readOptionalString,
  readIsoDate,
  readHttpUrl,
  normalizeImportedClip,
} from '@/services/clip-store';
import { normalizeUrl } from '@/services/url-utils';

const BACKUP_FORMAT = 'pagetrove-backup';
const BACKUP_VERSION = 1;
const MAX_BACKUP_BYTES = 50 * 1024 * 1024;
const MAX_IMPORT_CHATS = 1_000;
const MAX_IMPORT_CLIPS = 5_000;

const CHAT_LIMITS = {
  id: 128,
  title: 500,
  maxMessages: 2_000,
  messageContent: 200_000,
} as const;

// --- Types ---

export interface BackupManifest {
  format: string;
  version: number;
  appVersion: string;
  exportedAt: string;
  stats: { clips: number; chats: number };
}

export interface BackupPreview {
  manifest: BackupManifest;
  clipCount: number;
  chatCount: number;
  hasSettings: boolean;
  clipConflicts: number;
  chatConflicts: number;
}

export type ImportStrategy = 'merge' | 'overwrite';

export interface BackupImportResult {
  clips: { imported: number; duplicates: number; invalid: number };
  chats: { imported: number; duplicates: number; invalid: number };
  settingsRestored: boolean;
}

// --- Export ---

function stripSecrets(settings: ExtensionSettings): Omit<ExtensionSettings, 'apiKey'> {
  const safe = { ...settings, apiKey: '' };
  safe.mcpServers = safe.mcpServers.map((server) => ({
    ...server,
    bearerToken: undefined,
  }));
  return safe;
}

export async function exportBackup(): Promise<void> {
  const db = await openPageTroveDatabase();
  let clips: WebClip[];
  let chats: ChatSession[];
  try {
    const tx = db.transaction(['clips', 'chats'], 'readonly');
    clips = await tx.objectStore('clips').getAll();
    chats = await tx.objectStore('chats').getAll();
    await tx.done;
  } catch (error) {
    throw mapDatabaseError(error);
  }

  const settings = await getSettings();

  const manifest: BackupManifest = {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    appVersion: '1.3',
    exportedAt: new Date().toISOString(),
    stats: { clips: clips.length, chats: chats.length },
  };

  const files: Record<string, Uint8Array> = {
    'manifest.json': strToU8(JSON.stringify(manifest)),
    'clips.json': strToU8(JSON.stringify(clips)),
    'chats.json': strToU8(JSON.stringify(chats)),
    'settings.json': strToU8(JSON.stringify(stripSecrets(settings))),
  };

  const data = zipSync(files);
  const buffer = new ArrayBuffer(data.byteLength);
  new Uint8Array(buffer).set(data);

  downloadBlob(
    new Blob([buffer], { type: 'application/zip' }),
    `PageTrove-Backup-${new Date().toISOString().slice(0, 10)}.zip`,
  );
}

// --- Preview (pre-check) ---

function parseZip(arrayBuffer: ArrayBuffer): Record<string, Uint8Array> {
  if (arrayBuffer.byteLength > MAX_BACKUP_BYTES) {
    throw new AppError('SAVE_FAILED', '备份文件不能超过 50 MB');
  }
  try {
    return unzipSync(new Uint8Array(arrayBuffer));
  } catch {
    throw new AppError('SAVE_FAILED', '无法解压备份文件，格式可能已损坏');
  }
}

function readJsonFile<T>(files: Record<string, Uint8Array>, name: string): T {
  const raw = files[name];
  if (!raw) {
    throw new AppError('SAVE_FAILED', `备份文件缺少 ${name}`);
  }
  try {
    return JSON.parse(new TextDecoder().decode(raw)) as T;
  } catch {
    throw new AppError('SAVE_FAILED', `${name} 不是有效的 JSON`);
  }
}

function validateManifest(data: unknown): BackupManifest {
  if (!isRecord(data)) {
    throw new AppError('SAVE_FAILED', 'manifest.json 结构无效');
  }
  if (data.format !== BACKUP_FORMAT) {
    throw new AppError('SAVE_FAILED', '不是有效的 PageTrove 备份文件');
  }
  if (data.version !== BACKUP_VERSION) {
    throw new AppError(
      'SAVE_FAILED',
      `不支持的备份版本：${String(data.version ?? '缺失')}`,
    );
  }
  return data as unknown as BackupManifest;
}

export async function previewBackup(arrayBuffer: ArrayBuffer): Promise<BackupPreview> {
  const files = parseZip(arrayBuffer);
  const manifest = validateManifest(readJsonFile(files, 'manifest.json'));

  const clips = readJsonFile<unknown[]>(files, 'clips.json');
  const chats = readJsonFile<unknown[]>(files, 'chats.json');
  if (!Array.isArray(clips) || !Array.isArray(chats)) {
    throw new AppError('SAVE_FAILED', '备份数据结构无效');
  }

  const db = await openPageTroveDatabase();
  const existingClipEntries = await db.getAll('clipEntries');
  const existingChatEntries = await db.getAll('chatEntries');
  const existingUrls = new Set(existingClipEntries.map((e) => e.normalizedUrl));
  const existingChatIds = new Set(existingChatEntries.map((e) => e.id));

  let clipConflicts = 0;
  for (const raw of clips) {
    if (isRecord(raw) && typeof raw.url === 'string') {
      const url = readHttpUrl(raw.url);
      if (url) {
        const canonical = readHttpUrl(raw.canonicalUrl);
        const normalized = normalizeUrl(url.toString(), canonical?.toString());
        if (existingUrls.has(normalized)) clipConflicts++;
      }
    }
  }

  let chatConflicts = 0;
  for (const raw of chats) {
    if (isRecord(raw) && typeof raw.id === 'string' && existingChatIds.has(raw.id)) {
      chatConflicts++;
    }
  }

  return {
    manifest,
    clipCount: clips.length,
    chatCount: chats.length,
    hasSettings: 'settings.json' in files,
    clipConflicts,
    chatConflicts,
  };
}

// --- Chat validation ---

function normalizeImportedChat(
  raw: unknown,
  usedIds: Set<string>,
): ChatSession | undefined {
  if (!isRecord(raw)) return undefined;

  const id = readOptionalString(raw.id, CHAT_LIMITS.id);
  const title = readOptionalString(raw.title, CHAT_LIMITS.title);
  if (!title) return undefined;

  const messages = raw.messages;
  if (!Array.isArray(messages)) return undefined;
  if (messages.length > CHAT_LIMITS.maxMessages) return undefined;

  const validatedMessages: ChatMessage[] = [];
  for (const msg of messages) {
    if (!isRecord(msg)) return undefined;
    if (msg.role !== 'user' && msg.role !== 'assistant') return undefined;
    const content = readOptionalString(msg.content, CHAT_LIMITS.messageContent);
    if (content === undefined) return undefined;
    const createdAt = readIsoDate(msg.createdAt, new Date().toISOString());
    const validated: ChatMessage = { role: msg.role, content, createdAt };
    if (msg.role === 'assistant') {
      if (isRecord(msg.usage)) {
        const pt = Number(msg.usage.promptTokens);
        const ct = Number(msg.usage.completionTokens);
        if (Number.isFinite(pt) && Number.isFinite(ct)) {
          validated.usage = { promptTokens: pt, completionTokens: ct };
        }
      }
      if (typeof msg.elapsedMs === 'number' && Number.isFinite(msg.elapsedMs)) {
        validated.elapsedMs = msg.elapsedMs;
      }
      if (Array.isArray(msg.citationRefs)) {
        validated.citationRefs = msg.citationRefs.filter(
          (ref: unknown) =>
            isRecord(ref) &&
            typeof ref.citation === 'string' &&
            typeof ref.sourceId === 'string' &&
            typeof ref.title === 'string' &&
            typeof ref.url === 'string',
        );
      }
    }
    validatedMessages.push(validated);
  }

  const now = new Date().toISOString();
  const createdAt = readIsoDate(raw.createdAt, now);
  const updatedAt = readIsoDate(raw.updatedAt, createdAt);

  // 生成唯一 ID
  let finalId: string;
  if (id && /^[a-zA-Z0-9_-]+$/.test(id) && !usedIds.has(id)) {
    finalId = id;
  } else {
    do {
      finalId = crypto.randomUUID();
    } while (usedIds.has(finalId));
  }
  usedIds.add(finalId);

  const session: ChatSession = {
    id: finalId,
    title,
    messages: validatedMessages,
    createdAt,
    updatedAt,
  };

  // 恢复可选关联字段（三选一）
  if (typeof raw.clipId === 'string' && raw.clipId.trim()) {
    session.clipId = raw.clipId.trim().slice(0, CHAT_LIMITS.id);
  } else if (isRecord(raw.page)) {
    const pageTitle = readOptionalString(raw.page.title, CHAT_LIMITS.title);
    const pageUrl = readHttpUrl(raw.page.url);
    if (pageTitle && pageUrl) {
      session.page = {
        title: pageTitle,
        url: pageUrl.toString(),
        content: readOptionalString(raw.page.content, CHAT_LIMITS.messageContent) ?? '',
      };
    }
  } else if (isRecord(raw.scope) && Array.isArray((raw.scope as Record<string, unknown>).sources)) {
    const scopeRaw = raw.scope as Record<string, unknown>;
    if (scopeRaw.mode === 'tabs' || scopeRaw.mode === 'clips') {
      session.scope = {
        mode: scopeRaw.mode,
        sources: (scopeRaw.sources as unknown) as ChatSourceRef[],
      };
    }
  }

  return session;
}

// --- Import ---

export async function importBackup(
  arrayBuffer: ArrayBuffer,
  strategy: ImportStrategy,
): Promise<BackupImportResult> {
  const files = parseZip(arrayBuffer);
  validateManifest(readJsonFile(files, 'manifest.json'));

  const rawClips = readJsonFile<unknown[]>(files, 'clips.json');
  const rawChats = readJsonFile<unknown[]>(files, 'chats.json');
  if (!Array.isArray(rawClips) || !Array.isArray(rawChats)) {
    throw new AppError('SAVE_FAILED', '备份数据结构无效');
  }
  if (rawClips.length > MAX_IMPORT_CLIPS) {
    throw new AppError('SAVE_FAILED', `收藏数量超过上限 ${MAX_IMPORT_CLIPS}`);
  }
  if (rawChats.length > MAX_IMPORT_CHATS) {
    throw new AppError('SAVE_FAILED', `会话数量超过上限 ${MAX_IMPORT_CHATS}`);
  }

  const db = await openPageTroveDatabase();

  // --- Overwrite: clear all first ---
  if (strategy === 'overwrite') {
    try {
      const clearTx = db.transaction(
        ['clips', 'clipEntries', 'chats', 'chatEntries'],
        'readwrite',
      );
      await clearTx.objectStore('clips').clear();
      await clearTx.objectStore('clipEntries').clear();
      await clearTx.objectStore('chats').clear();
      await clearTx.objectStore('chatEntries').clear();
      await clearTx.done;
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }

  // --- Process clips ---
  const existingClipEntries =
    strategy === 'merge' ? await db.getAll('clipEntries') : [];
  const existingUrls = new Set(existingClipEntries.map((e) => e.normalizedUrl));
  const usedClipIds = new Set(existingClipEntries.map((e) => e.id));

  const validClips: WebClip[] = [];
  let clipDuplicates = 0;
  let clipInvalid = 0;

  for (const raw of rawClips) {
    const clip = normalizeImportedClip(raw, usedClipIds);
    if (!clip) {
      clipInvalid++;
      continue;
    }
    if (existingUrls.has(clip.normalizedUrl)) {
      clipDuplicates++;
      continue;
    }
    existingUrls.add(clip.normalizedUrl);
    validClips.push(clip);
  }

  // --- Process chats ---
  const existingChatEntries =
    strategy === 'merge' ? await db.getAll('chatEntries') : [];
  const existingChatIds = new Set(existingChatEntries.map((e) => e.id));
  const usedChatIds = new Set(existingChatEntries.map((e) => e.id));

  const validChats: ChatSession[] = [];
  let chatDuplicates = 0;
  let chatInvalid = 0;

  for (const raw of rawChats) {
    // merge 策略：按原始 ID 去重（在校验前判断）
    if (strategy === 'merge' && isRecord(raw) && typeof raw.id === 'string') {
      if (existingChatIds.has(raw.id)) {
        chatDuplicates++;
        continue;
      }
    }
    const chat = normalizeImportedChat(raw, usedChatIds);
    if (!chat) {
      chatInvalid++;
      continue;
    }
    validChats.push(chat);
  }

  // --- Write clips + chats in one transaction ---
  if (validClips.length > 0 || validChats.length > 0) {
    try {
      const tx = db.transaction(
        ['clips', 'clipEntries', 'chats', 'chatEntries'],
        'readwrite',
      );
      const clipsStore = tx.objectStore('clips');
      const clipEntriesStore = tx.objectStore('clipEntries');
      const chatsStore = tx.objectStore('chats');
      const chatEntriesStore = tx.objectStore('chatEntries');

      for (const clip of validClips) {
        void clipsStore.put(clip);
        void clipEntriesStore.put({
          id: clip.id,
          title: clip.title,
          url: clip.url,
          normalizedUrl: clip.normalizedUrl,
          domain: clip.domain,
          faviconUrl: clip.faviconUrl,
          summary: clip.summary,
          tags: clip.tags,
          createdAt: clip.createdAt,
        });
      }
      for (const chat of validChats) {
        void chatsStore.put(chat);
        void chatEntriesStore.put({
          id: chat.id,
          title: chat.title,
          clipId: chat.clipId,
          url: chat.page?.url,
          messageCount: chat.messages.length,
          updatedAt: chat.updatedAt,
        });
      }
      await tx.done;
    } catch (error) {
      throw mapDatabaseError(error);
    }
    if (validClips.length > 0) emitDataChanged('clips');
    if (validChats.length > 0) emitDataChanged('chats');
  }

  // --- Restore settings (if present) ---
  let settingsRestored = false;
  if ('settings.json' in files) {
    try {
      const rawSettings = readJsonFile<unknown>(files, 'settings.json');
      if (isRecord(rawSettings)) {
        const current = await getSettings();
        const patch: Partial<ExtensionSettings> = {};
        if (typeof rawSettings.provider === 'string') patch.provider = rawSettings.provider;
        if (typeof rawSettings.baseUrl === 'string') patch.baseUrl = rawSettings.baseUrl;
        if (typeof rawSettings.model === 'string') patch.model = rawSettings.model;
        if (typeof rawSettings.maxContentLength === 'number')
          patch.maxContentLength = rawSettings.maxContentLength;
        if (typeof rawSettings.includeSelectedText === 'boolean')
          patch.includeSelectedText = rawSettings.includeSelectedText;
        // 不恢复 apiKey 和 bearerToken
        if (Object.keys(patch).length > 0) {
          await saveSettings({ ...current, ...patch });
          settingsRestored = true;
        }
      }
    } catch {
      // settings 恢复失败不阻断整体导入
    }
  }

  return {
    clips: { imported: validClips.length, duplicates: clipDuplicates, invalid: clipInvalid },
    chats: { imported: validChats.length, duplicates: chatDuplicates, invalid: chatInvalid },
    settingsRestored,
  };
}
