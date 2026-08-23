import { strToU8, unzipSync, zipSync } from 'fflate';
import type { ClipIndexEntry, WebClip } from '@/types/clip';
import type {
  ChatIndexEntry,
  ChatMessage,
  ChatScope,
  ChatSession,
  ChatSourceRef,
  ChatToolCall,
  CitationRef,
} from '@/types/chat';
import {
  PROVIDERS,
  type ExtensionSettings,
  type McpServerSettings,
} from '@/types/settings';
import { AppError } from '@/utils/errors';
import { mapDatabaseError, openPageTroveDatabase } from '@/services/database';
import { getSettings, saveSettings } from '@/services/settings-store';
import { downloadBlob } from '@/services/obsidian-export';
import { emitDataChanged } from '@/services/data-events';
import { isActiveToolExecutionClaim } from '@/services/chat-store';
import {
  isRecord,
  normalizeImportedClip,
  readHttpUrl,
  readIsoDate,
  readOptionalString,
} from '@/services/clip-store';

const BACKUP_FORMAT = 'pagetrove-backup';
const BACKUP_VERSION = 1;
const APP_VERSION = '1.3';
const MAX_BACKUP_BYTES = 50 * 1024 * 1024;
const MAX_UNCOMPRESSED_BYTES = 200 * 1024 * 1024;
const MAX_COMPRESSION_RATIO = 1_000;
const MAX_IMPORT_CHATS = 1_000;
const MAX_IMPORT_CLIPS = 5_000;
const MAX_SCOPE_SOURCES = 5;
const SETTINGS_RESTORE_FAILED_MESSAGE = '设置未能恢复，请在设置页检查后重试或手动配置';
const CUSTOM_ENDPOINT_CONFIRMATION_MESSAGE = '自定义 API 地址未经确认，设置未恢复';

const BACKUP_FILE_LIMITS: Readonly<Record<string, number>> = {
  'manifest.json': 64 * 1024,
  'settings.json': 1024 * 1024,
  'clips.json': 150 * 1024 * 1024,
  'chats.json': 150 * 1024 * 1024,
};

const CHAT_LIMITS = {
  id: 128,
  title: 500,
  maxMessages: 2_000,
  messageContent: 200_000,
  citationRefs: 64,
  toolCalls: 100,
  toolExecutions: 200,
  toolSummary: 2_000,
} as const;

type SafeMcpServerSettings = Omit<McpServerSettings, 'bearerToken' | 'headersJson'>;

export type BackupSettings = Omit<ExtensionSettings, 'apiKey' | 'mcpServers'> & {
  apiKey: '';
  mcpServers: SafeMcpServerSettings[];
};

export interface BackupManifest {
  format: typeof BACKUP_FORMAT;
  version: typeof BACKUP_VERSION;
  appVersion: string;
  exportedAt: string;
  stats: { clips: number; chats: number };
}

export interface BackupSettingsPreview {
  provider: string;
  baseUrl: string;
  endpointWillChange: boolean;
  clearsApiKey: boolean;
}

export interface BackupPreview {
  manifest: BackupManifest;
  clipCount: number;
  chatCount: number;
  hasSettings: boolean;
  clipConflicts: number;
  chatConflicts: number;
  clipInvalid: number;
  chatInvalid: number;
  settingsStatus: 'absent' | 'ready' | 'invalid';
  settings?: BackupSettingsPreview;
}

export type ImportStrategy = 'merge' | 'overwrite';

export interface BackupImportOptions {
  confirmCustomEndpoint?: boolean;
}

export interface BackupImportResult {
  clips: { imported: number; duplicates: number; invalid: number };
  chats: { imported: number; duplicates: number; invalid: number };
  /** @deprecated 使用 settings.status；保留此字段兼容已有调用方。 */
  settingsRestored: boolean;
  settings: {
    status: 'restored' | 'skipped' | 'failed';
    /** 仅返回可安全展示的通用错误，不包含底层 storage 异常。 */
    error?: string;
  };
}

interface ParsedBackup {
  manifest: BackupManifest;
  rawClips: unknown[];
  rawChats: unknown[];
  rawSettings?: unknown;
}

interface RestorePlan {
  clips: WebClip[];
  chats: ChatSession[];
  clipDuplicates: number;
  chatDuplicates: number;
  clipInvalid: number;
  chatInvalid: number;
}

interface SettingsRestorePlan {
  patch: Partial<ExtensionSettings>;
  preview: BackupSettingsPreview;
}

/** 备份中不允许出现任何认证值；自定义请求头整体按秘密处理。 */
export function sanitizeSettingsForBackup(settings: ExtensionSettings): BackupSettings {
  return {
    ...settings,
    apiKey: '',
    mcpServers: settings.mcpServers.map(
      ({ bearerToken: _bearerToken, headersJson: _headersJson, ...server }) => server,
    ),
  };
}

function toClipIndexEntry(clip: WebClip): ClipIndexEntry {
  return {
    id: clip.id,
    title: clip.title,
    url: clip.url,
    normalizedUrl: clip.normalizedUrl,
    domain: clip.domain,
    faviconUrl: clip.faviconUrl,
    summary: clip.summary,
    tags: clip.tags,
    createdAt: clip.createdAt,
  };
}

function toChatIndexEntry(chat: ChatSession): ChatIndexEntry {
  return {
    id: chat.id,
    title: chat.title,
    clipId: chat.clipId,
    url: chat.page?.url,
    messageCount: chat.messages.length,
    updatedAt: chat.updatedAt,
  };
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
    appVersion: APP_VERSION,
    exportedAt: new Date().toISOString(),
    stats: { clips: clips.length, chats: chats.length },
  };
  const files: Record<string, Uint8Array> = {
    'manifest.json': strToU8(JSON.stringify(manifest)),
    'clips.json': strToU8(JSON.stringify(clips)),
    'chats.json': strToU8(JSON.stringify(chats)),
    'settings.json': strToU8(JSON.stringify(sanitizeSettingsForBackup(settings))),
  };
  const data = zipSync(files);
  const buffer = new ArrayBuffer(data.byteLength);
  new Uint8Array(buffer).set(data);
  downloadBlob(
    new Blob([buffer], { type: 'application/zip' }),
    `PageTrove-Backup-${new Date().toISOString().slice(0, 10)}.zip`,
  );
}

function parseZip(arrayBuffer: ArrayBuffer): Record<string, Uint8Array> {
  if (arrayBuffer.byteLength > MAX_BACKUP_BYTES) {
    throw new AppError('SAVE_FAILED', '备份文件不能超过 50 MB');
  }

  let totalUncompressedBytes = 0;
  const seenFiles = new Set<string>();
  try {
    const files = unzipSync(new Uint8Array(arrayBuffer), {
      filter(file) {
        if (seenFiles.has(file.name)) {
          throw new AppError(
            'SAVE_FAILED',
            `备份包含重复文件：${file.name.slice(0, 100)}`,
          );
        }
        seenFiles.add(file.name);
        if (seenFiles.size > Object.keys(BACKUP_FILE_LIMITS).length) {
          throw new AppError('SAVE_FAILED', '备份包含过多文件');
        }
        const fileLimit = BACKUP_FILE_LIMITS[file.name];
        if (fileLimit === undefined) {
          throw new AppError(
            'SAVE_FAILED',
            `备份包含不允许的文件：${file.name.slice(0, 100)}`,
          );
        }
        if (file.originalSize > fileLimit) {
          throw new AppError('SAVE_FAILED', `${file.name} 解压后体积超过安全上限`);
        }
        if (
          !Number.isSafeInteger(file.size) ||
          !Number.isSafeInteger(file.originalSize) ||
          file.size < 0 ||
          file.originalSize < 0 ||
          (file.compression !== 0 && file.compression !== 8)
        ) {
          throw new AppError('SAVE_FAILED', `${file.name} ZIP 元数据无效`);
        }
        if (
          file.originalSize > 0 &&
          (file.size === 0 || file.originalSize / file.size > MAX_COMPRESSION_RATIO)
        ) {
          throw new AppError('SAVE_FAILED', `${file.name} 压缩比超过安全上限`);
        }
        totalUncompressedBytes += file.originalSize;
        if (totalUncompressedBytes > MAX_UNCOMPRESSED_BYTES) {
          throw new AppError('SAVE_FAILED', '备份解压后总体积超过安全上限');
        }
        return true;
      },
    });
    if (Object.keys(files).length !== seenFiles.size) {
      throw new AppError('SAVE_FAILED', '备份文件目录不一致');
    }
    const actualBytes = Object.entries(files).reduce((total, [name, data]) => {
      const limit = BACKUP_FILE_LIMITS[name];
      if (limit === undefined || data.byteLength > limit) {
        throw new AppError('SAVE_FAILED', `${name} 解压后体积超过安全上限`);
      }
      return total + data.byteLength;
    }, 0);
    if (actualBytes > MAX_UNCOMPRESSED_BYTES) {
      throw new AppError('SAVE_FAILED', '备份解压后总体积超过安全上限');
    }
    return files;
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError('SAVE_FAILED', '无法解压备份文件，格式可能已损坏');
  }
}

function readJsonFile(
  files: Record<string, Uint8Array>,
  name: keyof typeof BACKUP_FILE_LIMITS,
): unknown {
  const raw = files[name];
  if (!raw) {
    throw new AppError('SAVE_FAILED', `备份文件缺少 ${name}`);
  }
  if (raw.byteLength > BACKUP_FILE_LIMITS[name]) {
    throw new AppError('SAVE_FAILED', `${name} 体积超过安全上限`);
  }
  try {
    return JSON.parse(new TextDecoder().decode(raw)) as unknown;
  } catch {
    throw new AppError('SAVE_FAILED', `${name} 不是有效的 JSON`);
  }
}

function readNonNegativeInteger(value: unknown, max: number): number | undefined {
  return Number.isInteger(value) && (value as number) >= 0 && (value as number) <= max
    ? (value as number)
    : undefined;
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
  const appVersion = readOptionalString(data.appVersion, 64);
  const exportedAt = readOptionalString(data.exportedAt, 64);
  const stats = isRecord(data.stats) ? data.stats : undefined;
  const clips = readNonNegativeInteger(stats?.clips, MAX_IMPORT_CLIPS);
  const chats = readNonNegativeInteger(stats?.chats, MAX_IMPORT_CHATS);
  if (!appVersion || !exportedAt || Number.isNaN(Date.parse(exportedAt))) {
    throw new AppError('SAVE_FAILED', 'manifest.json 元数据无效');
  }
  if (clips === undefined || chats === undefined) {
    throw new AppError('SAVE_FAILED', 'manifest.json 统计信息无效');
  }
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    appVersion,
    exportedAt: new Date(exportedAt).toISOString(),
    stats: { clips, chats },
  };
}

function parseBackup(arrayBuffer: ArrayBuffer): ParsedBackup {
  const files = parseZip(arrayBuffer);
  const manifest = validateManifest(readJsonFile(files, 'manifest.json'));
  const rawClips = readJsonFile(files, 'clips.json');
  const rawChats = readJsonFile(files, 'chats.json');
  if (!Array.isArray(rawClips) || !Array.isArray(rawChats)) {
    throw new AppError('SAVE_FAILED', '备份数据结构无效');
  }
  if (rawClips.length > MAX_IMPORT_CLIPS) {
    throw new AppError('SAVE_FAILED', `收藏数量超过上限 ${MAX_IMPORT_CLIPS}`);
  }
  if (rawChats.length > MAX_IMPORT_CHATS) {
    throw new AppError('SAVE_FAILED', `会话数量超过上限 ${MAX_IMPORT_CHATS}`);
  }
  if (
    manifest.stats.clips !== rawClips.length ||
    manifest.stats.chats !== rawChats.length
  ) {
    throw new AppError('SAVE_FAILED', '备份清单统计与实际数据不一致');
  }
  return {
    manifest,
    rawClips,
    rawChats,
    rawSettings:
      'settings.json' in files ? readJsonFile(files, 'settings.json') : undefined,
  };
}

function readId(value: unknown): string | undefined {
  const id = readOptionalString(value, CHAT_LIMITS.id);
  return id && /^[a-zA-Z0-9_-]+$/.test(id) ? id : undefined;
}

function readFiniteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value
    : undefined;
}

function normalizeCitationRef(raw: unknown): CitationRef | undefined {
  if (!isRecord(raw)) return undefined;
  const citation = readOptionalString(raw.citation, 32);
  const sourceId = readId(raw.sourceId);
  const title = readOptionalString(raw.title, CHAT_LIMITS.title);
  const url = readHttpUrl(raw.url);
  if (!citation || !/^S\d+$/.test(citation) || !sourceId || !title || !url) {
    return undefined;
  }
  return { citation, sourceId, title, url: url.toString() };
}

function normalizeToolCall(raw: unknown): ChatToolCall | undefined {
  if (!isRecord(raw)) return undefined;
  const id = readId(raw.id);
  const serverName = readOptionalString(raw.serverName, 200);
  const toolName = readOptionalString(raw.toolName, 200);
  if (
    !id ||
    !serverName ||
    !toolName ||
    (raw.status !== 'success' &&
      raw.status !== 'error' &&
      raw.status !== 'denied' &&
      raw.status !== 'unknown')
  ) {
    return undefined;
  }
  const operationKey =
    typeof raw.operationKey === 'string' &&
    /^sha256-v1:[a-f0-9]{64}$/.test(raw.operationKey)
      ? raw.operationKey
      : undefined;
  const turnId = readId(raw.turnId);
  const phase =
    raw.phase === 'claimed' || raw.phase === 'in-doubt' ? raw.phase : undefined;
  const claimedAtText = readOptionalString(raw.claimedAt, 64);
  const claimedAt = claimedAtText ? readIsoDate(claimedAtText, '') : undefined;
  if (
    (raw.operationKey !== undefined && !operationKey) ||
    (raw.turnId !== undefined && !turnId) ||
    (raw.phase !== undefined && !phase) ||
    (raw.claimedAt !== undefined && !claimedAt) ||
    (raw.status !== 'unknown' && phase !== undefined) ||
    (phase === 'claimed' && !claimedAt)
  ) {
    return undefined;
  }
  return {
    id,
    serverName,
    toolName,
    status: raw.status,
    operationKey,
    turnId,
    claimedAt,
    // 备份中的租约不可能代表本进程仍在执行，导入后一律降级。
    phase: raw.status === 'unknown' ? 'in-doubt' : undefined,
    summary: readOptionalString(raw.summary, CHAT_LIMITS.toolSummary),
  };
}

function normalizeMessage(raw: unknown): ChatMessage | undefined {
  if (!isRecord(raw) || (raw.role !== 'user' && raw.role !== 'assistant')) {
    return undefined;
  }
  const content = readOptionalString(raw.content, CHAT_LIMITS.messageContent);
  if (content === undefined) return undefined;
  const message: ChatMessage = {
    id: readId(raw.id),
    role: raw.role,
    content,
    createdAt: readIsoDate(raw.createdAt, new Date().toISOString()),
  };
  if (raw.role === 'user') return message;

  if (isRecord(raw.usage)) {
    const promptTokens = readFiniteNumber(raw.usage.promptTokens);
    const completionTokens = readFiniteNumber(raw.usage.completionTokens);
    if (promptTokens !== undefined && completionTokens !== undefined) {
      message.usage = { promptTokens, completionTokens };
    }
  }
  const elapsedMs = readFiniteNumber(raw.elapsedMs);
  if (elapsedMs !== undefined) message.elapsedMs = elapsedMs;
  if (Array.isArray(raw.citationRefs)) {
    const refs = raw.citationRefs
      .slice(0, CHAT_LIMITS.citationRefs)
      .map(normalizeCitationRef)
      .filter((ref): ref is CitationRef => Boolean(ref));
    if (refs.length > 0) message.citationRefs = refs;
  }
  if (Array.isArray(raw.toolCalls)) {
    const calls = raw.toolCalls
      .slice(0, CHAT_LIMITS.toolCalls)
      .map(normalizeToolCall)
      .filter((call): call is ChatToolCall => Boolean(call));
    if (calls.length > 0) message.toolCalls = calls;
  }
  return message;
}

function normalizePageSource(raw: Record<string, unknown>): ChatSourceRef | undefined {
  const id = readId(raw.id);
  const title = readOptionalString(raw.title, CHAT_LIMITS.title);
  const url = readHttpUrl(raw.url);
  const content = readOptionalString(raw.content, CHAT_LIMITS.messageContent);
  if (!id || !title || !url || content === undefined) return undefined;
  return {
    id,
    type: 'page',
    title,
    url: url.toString(),
    faviconUrl: readHttpUrl(raw.faviconUrl)?.toString(),
    content,
    capturedAt: readIsoDate(raw.capturedAt, new Date().toISOString()),
  };
}

function normalizeClipSource(
  raw: Record<string, unknown>,
  resolveClipId: (id: string) => string | undefined,
): ChatSourceRef | undefined {
  const id = readId(raw.id);
  const oldClipId = readId(raw.clipId);
  const clipId = oldClipId ? resolveClipId(oldClipId) : undefined;
  const title = readOptionalString(raw.title, CHAT_LIMITS.title);
  const url = readHttpUrl(raw.url);
  if (!id || !clipId || !title || !url) return undefined;
  return {
    id,
    type: 'clip',
    clipId,
    title,
    url: url.toString(),
    faviconUrl: readHttpUrl(raw.faviconUrl)?.toString(),
  };
}

function normalizeScope(
  raw: unknown,
  resolveClipId: (id: string) => string | undefined,
): ChatScope | undefined {
  if (!isRecord(raw) || !Array.isArray(raw.sources)) return undefined;
  if (raw.mode !== 'tabs' && raw.mode !== 'clips') return undefined;
  if (raw.sources.length === 0 || raw.sources.length > MAX_SCOPE_SOURCES) {
    return undefined;
  }

  const mode = raw.mode;
  const sources: ChatSourceRef[] = [];
  const sourceIds = new Set<string>();
  for (const rawSource of raw.sources) {
    if (!isRecord(rawSource) || rawSource.type !== (mode === 'tabs' ? 'page' : 'clip')) {
      return undefined;
    }
    const source =
      rawSource.type === 'page'
        ? normalizePageSource(rawSource)
        : normalizeClipSource(rawSource, resolveClipId);
    if (!source || sourceIds.has(source.id)) return undefined;
    sourceIds.add(source.id);
    sources.push(source);
  }
  return { mode, sources };
}

function normalizeImportedChat(
  raw: unknown,
  usedIds: Set<string>,
  resolveClipId: (id: string) => string | undefined,
): ChatSession | undefined {
  if (!isRecord(raw)) return undefined;
  const title = readOptionalString(raw.title, CHAT_LIMITS.title);
  if (!title || !Array.isArray(raw.messages)) return undefined;
  if (raw.messages.length > CHAT_LIMITS.maxMessages) return undefined;

  const messages: ChatMessage[] = [];
  for (const rawMessage of raw.messages) {
    const message = normalizeMessage(rawMessage);
    if (!message) return undefined;
    messages.push(message);
  }

  if (
    (raw.toolExecutions !== undefined && !Array.isArray(raw.toolExecutions)) ||
    (Array.isArray(raw.toolExecutions) &&
      raw.toolExecutions.length > CHAT_LIMITS.toolExecutions)
  ) {
    return undefined;
  }
  const toolExecutions: ChatToolCall[] = [];
  if (Array.isArray(raw.toolExecutions)) {
    const executionIds = new Set<string>();
    const operationKeys = new Set<string>();
    for (const rawExecution of raw.toolExecutions) {
      const execution = normalizeToolCall(rawExecution);
      if (
        !execution ||
        (execution.status !== 'success' && execution.status !== 'unknown') ||
        !execution.operationKey ||
        !execution.turnId ||
        executionIds.has(execution.id) ||
        operationKeys.has(execution.operationKey)
      ) {
        return undefined;
      }
      executionIds.add(execution.id);
      operationKeys.add(execution.operationKey);
      toolExecutions.push(execution);
    }
  }

  const contextCount = [raw.clipId, raw.page, raw.scope].filter(
    (value) => value !== undefined,
  ).length;
  if (contextCount > 1) return undefined;

  let clipId: string | undefined;
  let page: ChatSession['page'];
  let scope: ChatScope | undefined;
  if (raw.clipId !== undefined) {
    const oldClipId = readId(raw.clipId);
    clipId = oldClipId ? resolveClipId(oldClipId) : undefined;
    if (!clipId) return undefined;
  } else if (raw.page !== undefined) {
    if (!isRecord(raw.page)) return undefined;
    const pageTitle = readOptionalString(raw.page.title, CHAT_LIMITS.title);
    const pageUrl = readHttpUrl(raw.page.url);
    const content = readOptionalString(raw.page.content, CHAT_LIMITS.messageContent);
    if (!pageTitle || !pageUrl || content === undefined) return undefined;
    page = {
      title: pageTitle,
      url: pageUrl.toString(),
      content,
    };
  } else if (raw.scope !== undefined) {
    scope = normalizeScope(raw.scope, resolveClipId);
    if (!scope) return undefined;
  }

  // citationRefs 是消息级快照，但 sourceId 仍须指向本会话最终恢复的 scope。
  const restoredSourceIds = new Set(scope?.sources.map((source) => source.id) ?? []);
  for (const message of messages) {
    if (!message.citationRefs) continue;
    const seenCitations = new Set<string>();
    const citationRefs = message.citationRefs.filter((ref) => {
      if (!restoredSourceIds.has(ref.sourceId) || seenCitations.has(ref.citation)) {
        return false;
      }
      seenCitations.add(ref.citation);
      return true;
    });
    if (citationRefs.length > 0) message.citationRefs = citationRefs;
    else delete message.citationRefs;
  }

  const preferredId = readId(raw.id);
  let id = preferredId;
  if (!id || usedIds.has(id)) {
    do {
      id = crypto.randomUUID();
    } while (usedIds.has(id));
  }
  usedIds.add(id);

  const now = new Date().toISOString();
  const createdAt = readIsoDate(raw.createdAt, now);
  const session: ChatSession = {
    id,
    title,
    messages,
    createdAt,
    updatedAt: readIsoDate(raw.updatedAt, createdAt),
  };
  if (toolExecutions.length > 0) session.toolExecutions = toolExecutions;
  if (clipId) session.clipId = clipId;
  if (page) session.page = page;
  if (scope) session.scope = scope;
  return session;
}

async function buildRestorePlan(
  parsed: ParsedBackup,
  strategy: ImportStrategy,
): Promise<RestorePlan> {
  const db = await openPageTroveDatabase();
  const existingClipEntries = strategy === 'merge' ? await db.getAll('clipEntries') : [];
  const existingChatEntries = strategy === 'merge' ? await db.getAll('chatEntries') : [];

  const existingByUrl = new Map(
    existingClipEntries.map((entry) => [entry.normalizedUrl, entry]),
  );
  const usedClipIds = new Set(existingClipEntries.map((entry) => entry.id));
  const clipIdMap = new Map<string, string>();
  const plannedByUrl = new Map<string, WebClip>();
  const clips: WebClip[] = [];
  let clipDuplicates = 0;
  let clipInvalid = 0;

  const rawClipIdCounts = new Map<string, number>();
  for (const raw of parsed.rawClips) {
    const id = isRecord(raw) ? readId(raw.id) : undefined;
    if (id) rawClipIdCounts.set(id, (rawClipIdCounts.get(id) ?? 0) + 1);
  }

  for (const raw of parsed.rawClips) {
    const oldId = isRecord(raw) ? readId(raw.id) : undefined;
    // 同一旧 ID 对应多个收藏时无法可靠重映射引用；全部视为无效。
    if (oldId && (rawClipIdCounts.get(oldId) ?? 0) > 1) {
      clipInvalid++;
      continue;
    }
    const clip = normalizeImportedClip(raw, usedClipIds);
    if (!clip) {
      clipInvalid++;
      continue;
    }
    const existing = existingByUrl.get(clip.normalizedUrl);
    const planned = plannedByUrl.get(clip.normalizedUrl);
    if (existing || planned) {
      clipDuplicates++;
      if (oldId) clipIdMap.set(oldId, (existing ?? planned)!.id);
      continue;
    }
    clips.push(clip);
    plannedByUrl.set(clip.normalizedUrl, clip);
    if (oldId) clipIdMap.set(oldId, clip.id);
  }

  // 只允许指向本备份中出现且已成功导入/去重映射的收藏，不能碰巧绑定本地同 ID 数据。
  const resolveClipId = (oldId: string): string | undefined => clipIdMap.get(oldId);
  const existingChatIds = new Set(existingChatEntries.map((entry) => entry.id));
  const usedChatIds = new Set(existingChatIds);
  const seenRawChatIds = new Set<string>();
  const chats: ChatSession[] = [];
  let chatDuplicates = 0;
  let chatInvalid = 0;

  for (const raw of parsed.rawChats) {
    const oldId = isRecord(raw) ? readId(raw.id) : undefined;
    if (oldId && (existingChatIds.has(oldId) || seenRawChatIds.has(oldId))) {
      chatDuplicates++;
      continue;
    }
    if (oldId) seenRawChatIds.add(oldId);
    const chat = normalizeImportedChat(raw, usedChatIds, resolveClipId);
    if (!chat) {
      chatInvalid++;
      continue;
    }
    chats.push(chat);
  }

  return {
    clips,
    chats,
    clipDuplicates,
    chatDuplicates,
    clipInvalid,
    chatInvalid,
  };
}

function normalizeBaseUrl(value: unknown): string | undefined {
  const text = readOptionalString(value, 8_192);
  if (!text) return undefined;
  try {
    const url = new URL(text);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return undefined;
    return url.toString().replace(/\/$/, '');
  } catch {
    return undefined;
  }
}

function buildSettingsRestorePlan(
  raw: unknown,
  current: ExtensionSettings,
): SettingsRestorePlan | undefined {
  if (!isRecord(raw)) return undefined;
  const provider = readOptionalString(raw.provider, 100);
  const preset = PROVIDERS.find((item) => item.id === provider);
  if (!provider || !preset) return undefined;

  const baseUrl =
    provider === 'custom'
      ? normalizeBaseUrl(raw.baseUrl)
      : preset.baseUrl.replace(/\/$/, '');
  if (!baseUrl) return undefined;

  const patch: Partial<ExtensionSettings> = { provider, baseUrl };
  const model = readOptionalString(raw.model, 200);
  if (model) patch.model = model;
  if (typeof raw.maxContentLength === 'number' && Number.isFinite(raw.maxContentLength)) {
    patch.maxContentLength = Math.min(
      200_000,
      Math.max(1_000, Math.round(raw.maxContentLength)),
    );
  }
  if (typeof raw.includeSelectedText === 'boolean') {
    patch.includeSelectedText = raw.includeSelectedText;
  }
  if (typeof raw.mcpVerboseLog === 'boolean') {
    patch.mcpVerboseLog = raw.mcpVerboseLog;
  }

  const endpointWillChange =
    current.provider !== provider || current.baseUrl.replace(/\/$/, '') !== baseUrl;
  if (endpointWillChange) patch.apiKey = '';
  return {
    patch,
    preview: {
      provider,
      baseUrl,
      endpointWillChange,
      clearsApiKey: endpointWillChange && Boolean(current.apiKey),
    },
  };
}

export async function previewBackup(arrayBuffer: ArrayBuffer): Promise<BackupPreview> {
  const parsed = parseBackup(arrayBuffer);
  const plan = await buildRestorePlan(parsed, 'merge');
  let settingsPlan: SettingsRestorePlan | undefined;
  let settingsStatus: BackupPreview['settingsStatus'] = 'absent';
  if (parsed.rawSettings !== undefined) {
    settingsStatus = 'invalid';
    try {
      const currentSettings = await getSettings();
      settingsPlan = buildSettingsRestorePlan(parsed.rawSettings, currentSettings);
      if (settingsPlan) settingsStatus = 'ready';
    } catch {
      // 核心数据仍可预览；不向 UI 透出 storage 的原始异常。
    }
  }
  return {
    manifest: parsed.manifest,
    clipCount: parsed.rawClips.length,
    chatCount: parsed.rawChats.length,
    hasSettings: parsed.rawSettings !== undefined,
    clipConflicts: plan.clipDuplicates,
    chatConflicts: plan.chatDuplicates,
    clipInvalid: plan.clipInvalid,
    chatInvalid: plan.chatInvalid,
    settingsStatus,
    settings: settingsPlan?.preview,
  };
}

export async function importBackup(
  arrayBuffer: ArrayBuffer,
  strategy: ImportStrategy,
  options: BackupImportOptions = {},
): Promise<BackupImportResult> {
  const parsed = parseBackup(arrayBuffer);
  const plan = await buildRestorePlan(parsed, strategy);
  if (strategy === 'overwrite' && (plan.clipInvalid > 0 || plan.chatInvalid > 0)) {
    throw new AppError(
      'SAVE_FAILED',
      '覆盖恢复已取消：备份中存在无效记录，请改用合并导入或修复备份',
    );
  }

  const db = await openPageTroveDatabase();
  try {
    const tx = db.transaction(
      ['clips', 'clipEntries', 'chats', 'chatEntries'],
      'readwrite',
    );
    const clipsStore = tx.objectStore('clips');
    const clipEntriesStore = tx.objectStore('clipEntries');
    const chatsStore = tx.objectStore('chats');
    const chatEntriesStore = tx.objectStore('chatEntries');
    const done = tx.done;
    try {
      if (strategy === 'overwrite') {
        const existingChats = await chatsStore.getAll();
        if (
          existingChats.some((chat) =>
            chat.toolExecutions?.some((execution) =>
              isActiveToolExecutionClaim(execution),
            ),
          )
        ) {
          tx.abort();
          await done.catch(() => undefined);
          throw new AppError(
            'SAVE_FAILED',
            '存在正在执行的工具调用，覆盖恢复已取消；请等待执行完成或五分钟租约到期',
          );
        }
        await Promise.all([
          clipsStore.clear(),
          clipEntriesStore.clear(),
          chatsStore.clear(),
          chatEntriesStore.clear(),
        ]);
      }
      for (const clip of plan.clips) {
        await clipsStore.add(clip);
        await clipEntriesStore.add(toClipIndexEntry(clip));
      }
      for (const chat of plan.chats) {
        await chatsStore.add(chat);
        await chatEntriesStore.add(toChatIndexEntry(chat));
      }
      await done;
    } catch (error) {
      await done.catch(() => undefined);
      throw error;
    }
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw mapDatabaseError(error);
  }

  let settingsResult: BackupImportResult['settings'] = { status: 'skipped' };
  let expectedSettingsPatch: Partial<ExtensionSettings> | undefined;
  if (parsed.rawSettings !== undefined) {
    settingsResult = {
      status: 'failed',
      error: SETTINGS_RESTORE_FAILED_MESSAGE,
    };
    try {
      const current = await getSettings();
      const settingsPlan = buildSettingsRestorePlan(parsed.rawSettings, current);
      if (settingsPlan && Object.keys(settingsPlan.patch).length > 0) {
        if (
          settingsPlan.preview.provider === 'custom' &&
          settingsPlan.preview.endpointWillChange &&
          !options.confirmCustomEndpoint
        ) {
          settingsResult = {
            status: 'failed',
            error: CUSTOM_ENDPOINT_CONFIRMATION_MESSAGE,
          };
        } else {
          expectedSettingsPatch = settingsPlan.patch;
          await saveSettings(settingsPlan.patch);
          settingsResult = { status: 'restored' };
        }
      }
    } catch {
      // 核心数据已经原子提交；结果显式返回部分失败且不泄露底层异常。
    }
  }

  let settingsRestored = settingsResult.status === 'restored';
  if (settingsRestored) {
    try {
      const current = await getSettings();
      settingsRestored = Object.entries(expectedSettingsPatch ?? {}).every(
        ([key, value]) => Object.is(current[key as keyof ExtensionSettings], value),
      );
    } catch {
      settingsRestored = false;
    }
    if (!settingsRestored) {
      settingsResult = {
        status: 'failed',
        error: SETTINGS_RESTORE_FAILED_MESSAGE,
      };
    }
  }

  if (strategy === 'overwrite' || plan.clips.length > 0) {
    emitDataChanged('clips');
  }
  if (strategy === 'overwrite' || plan.chats.length > 0) {
    emitDataChanged('chats');
  }
  return {
    clips: {
      imported: plan.clips.length,
      duplicates: plan.clipDuplicates,
      invalid: plan.clipInvalid,
    },
    chats: {
      imported: plan.chats.length,
      duplicates: plan.chatDuplicates,
      invalid: plan.chatInvalid,
    },
    settingsRestored,
    settings: settingsResult,
  };
}
