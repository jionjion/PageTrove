import type { ClipIndexEntry, ClipQuery, WebClip } from '@/types/clip';
import { AppError } from '@/utils/errors';
import { normalizeUrl } from '@/services/url-utils';
import { mapDatabaseError, openPageTroveDatabase } from '@/services/database';
import { emitDataChanged } from '@/services/data-events';

export const EXPORT_VERSION = 1;
export const MAX_IMPORT_BYTES = 10 * 1024 * 1024;
export const MAX_IMPORT_CLIPS = 5_000;

export const IMPORT_LIMITS = {
  id: 128,
  url: 8_192,
  title: 500,
  description: 2_000,
  summary: 1_000,
  tagCount: 20,
  tagLength: 50,
  note: 50_000,
  selectedText: 100_000,
  extractedText: 200_000,
  faviconUrl: 100_000,
} as const;

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toIndexEntry(clip: WebClip): ClipIndexEntry {
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

export async function createClip(clip: WebClip): Promise<void> {
  const db = await openPageTroveDatabase();
  try {
    const tx = db.transaction(['clips', 'clipEntries'], 'readwrite');
    await tx.objectStore('clips').put(clip);
    await tx.objectStore('clipEntries').put(toIndexEntry(clip));
    await tx.done;
  } catch (error) {
    throw mapDatabaseError(error);
  }
  emitDataChanged('clips');
}

export async function updateClip(
  id: string,
  patch: Partial<WebClip>,
): Promise<WebClip> {
  const db = await openPageTroveDatabase();
  let next: WebClip;
  try {
    const tx = db.transaction(['clips', 'clipEntries'], 'readwrite');
    const clips = tx.objectStore('clips');
    const existing = await clips.get(id);
    if (!existing) {
      throw new AppError('SAVE_FAILED', '收藏不存在或已被删除');
    }
    next = {
      ...existing,
      ...patch,
      id,
      updatedAt: new Date().toISOString(),
    };
    await clips.put(next);
    await tx.objectStore('clipEntries').put(toIndexEntry(next));
    await tx.done;
  } catch (error) {
    throw mapDatabaseError(error);
  }
  emitDataChanged('clips');
  return next;
}

export async function removeClip(id: string): Promise<void> {
  const db = await openPageTroveDatabase();
  try {
    const tx = db.transaction(['clips', 'clipEntries'], 'readwrite');
    await tx.objectStore('clips').delete(id);
    await tx.objectStore('clipEntries').delete(id);
    await tx.done;
  } catch (error) {
    throw mapDatabaseError(error);
  }
  emitDataChanged('clips');
}

export async function getClip(id: string): Promise<WebClip | undefined> {
  const db = await openPageTroveDatabase();
  try {
    return await db.get('clips', id);
  } catch (error) {
    throw mapDatabaseError(error);
  }
}

/** 批量读取收藏详情；同一 readonly 事务内并发 get，返回顺序与传入 ID 一致。 */
export async function getClipsByIds(ids: string[]): Promise<WebClip[]> {
  const uniqueIds = [...new Set(ids)];
  if (uniqueIds.length === 0) return [];

  const db = await openPageTroveDatabase();
  try {
    const tx = db.transaction('clips', 'readonly');
    const results = await Promise.all(
      uniqueIds.map((id) => tx.store.get(id)),
    );
    await tx.done;
    return results.filter((clip): clip is WebClip => clip !== undefined);
  } catch (error) {
    throw mapDatabaseError(error);
  }
}

export async function findByNormalizedUrl(
  normalizedUrl: string,
): Promise<ClipIndexEntry | undefined> {
  const db = await openPageTroveDatabase();
  try {
    return await db.getFromIndex('clipEntries', 'normalizedUrl', normalizedUrl);
  } catch (error) {
    throw mapDatabaseError(error);
  }
}

async function readAllEntries(): Promise<ClipIndexEntry[]> {
  const db = await openPageTroveDatabase();
  try {
    return await db.getAll('clipEntries');
  } catch (error) {
    throw mapDatabaseError(error);
  }
}

export async function queryClips(query: ClipQuery = {}): Promise<ClipIndexEntry[]> {
  let entries = await readAllEntries();

  const keyword = query.keyword?.trim().toLowerCase();
  if (keyword) {
    entries = entries.filter(
      (e) =>
        e.title.toLowerCase().includes(keyword) ||
        e.domain.toLowerCase().includes(keyword) ||
        (e.summary ?? '').toLowerCase().includes(keyword) ||
        e.tags.some((t) => t.toLowerCase().includes(keyword)),
    );
  }
  if (query.tags && query.tags.length > 0) {
    entries = entries.filter((e) =>
      query.tags!.some((tag) => e.tags.includes(tag)),
    );
  }
  if (query.domain) {
    entries = entries.filter((e) => e.domain === query.domain);
  }

  entries.sort((a, b) =>
    query.sort === 'createdAt_asc'
      ? a.createdAt.localeCompare(b.createdAt)
      : b.createdAt.localeCompare(a.createdAt),
  );
  return entries;
}

/** 收集索引中出现过的全部标签，用于筛选器 */
export async function collectFacets(): Promise<{ tags: string[] }> {
  const entries = await readAllEntries();
  const tags = new Set<string>();
  for (const entry of entries) {
    entry.tags.forEach((t) => tags.add(t));
  }
  return { tags: [...tags].sort() };
}

/** 导出全部收藏为 JSON 字符串（不包含设置和 API Key） */
export async function exportAll(): Promise<string> {
  const db = await openPageTroveDatabase();
  let clips: WebClip[];
  try {
    clips = await db.getAll('clips');
  } catch (error) {
    throw mapDatabaseError(error);
  }
  clips.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return JSON.stringify(
    {
      version: EXPORT_VERSION,
      exportedAt: new Date().toISOString(),
      clips,
    },
    null,
    2,
  );
}

export function readOptionalString(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const text = value.trim();
  return text ? text.slice(0, maxLength) : undefined;
}

export function readHttpUrl(value: unknown): URL | undefined {
  const text = readOptionalString(value, IMPORT_LIMITS.url);
  if (!text) return undefined;
  try {
    const url = new URL(text);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url : undefined;
  } catch {
    return undefined;
  }
}

function readFaviconUrl(value: unknown): string | undefined {
  const text = readOptionalString(value, IMPORT_LIMITS.faviconUrl);
  if (!text) return undefined;
  try {
    const url = new URL(text);
    return ['http:', 'https:', 'data:'].includes(url.protocol) ? text : undefined;
  } catch {
    return undefined;
  }
}

export function readTags(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const tags = value
    .filter((tag): tag is string => typeof tag === 'string')
    .map((tag) => tag.trim().slice(0, IMPORT_LIMITS.tagLength))
    .filter(Boolean);
  return [...new Set(tags)].slice(0, IMPORT_LIMITS.tagCount);
}

export function readIsoDate(value: unknown, fallback: string): string {
  const text = readOptionalString(value, 64);
  if (!text) return fallback;
  const time = Date.parse(text);
  return Number.isNaN(time) ? fallback : new Date(time).toISOString();
}

function nextImportId(value: unknown, usedIds: Set<string>): string {
  const candidate = readOptionalString(value, IMPORT_LIMITS.id);
  if (
    candidate &&
    /^[a-zA-Z0-9_-]+$/.test(candidate) &&
    !usedIds.has(candidate)
  ) {
    usedIds.add(candidate);
    return candidate;
  }

  let id: string;
  do {
    id = crypto.randomUUID();
  } while (usedIds.has(id));
  usedIds.add(id);
  return id;
}

export function normalizeImportedClip(
  raw: unknown,
  usedIds: Set<string>,
): WebClip | undefined {
  if (!isRecord(raw)) return undefined;

  const url = readHttpUrl(raw.url);
  const title = readOptionalString(raw.title, IMPORT_LIMITS.title);
  if (!url || !title) return undefined;

  const canonical = readHttpUrl(raw.canonicalUrl);
  const now = new Date().toISOString();
  const createdAt = readIsoDate(raw.createdAt, now);

  return {
    id: nextImportId(raw.id, usedIds),
    url: url.toString(),
    canonicalUrl: canonical?.toString(),
    normalizedUrl: normalizeUrl(url.toString(), canonical?.toString()),
    domain: url.hostname.toLowerCase(),
    title,
    description: readOptionalString(
      raw.description,
      IMPORT_LIMITS.description,
    ),
    faviconUrl: readFaviconUrl(raw.faviconUrl),
    summary: readOptionalString(raw.summary, IMPORT_LIMITS.summary),
    tags: readTags(raw.tags),
    userNote: readOptionalString(raw.userNote, IMPORT_LIMITS.note),
    selectedText: readOptionalString(
      raw.selectedText,
      IMPORT_LIMITS.selectedText,
    ),
    extractedText: readOptionalString(
      raw.extractedText,
      IMPORT_LIMITS.extractedText,
    ),
    createdAt,
    updatedAt: readIsoDate(raw.updatedAt, createdAt),
  };
}

export interface ImportResult {
  imported: number;
  duplicates: number;
  invalid: number;
}

/** 校验并导入收藏，按重新计算后的 normalizedUrl 去重（含库内与批内去重）。 */
export async function importAll(json: string): Promise<ImportResult> {
  if (new TextEncoder().encode(json).byteLength > MAX_IMPORT_BYTES) {
    throw new AppError('SAVE_FAILED', '导入文件不能超过 10 MB');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new AppError('SAVE_FAILED', '导入文件不是有效的 JSON');
  }

  if (!isRecord(parsed)) {
    throw new AppError('SAVE_FAILED', '导入文件结构无效');
  }
  if (parsed.version !== EXPORT_VERSION) {
    throw new AppError(
      'SAVE_FAILED',
      `不支持的导出版本：${String(parsed.version ?? '缺失')}`,
    );
  }

  const clips = parsed.clips;
  if (!Array.isArray(clips)) {
    throw new AppError('SAVE_FAILED', '导入文件缺少 clips 字段');
  }
  if (clips.length > MAX_IMPORT_CLIPS) {
    throw new AppError(
      'SAVE_FAILED',
      `单次最多导入 ${MAX_IMPORT_CLIPS} 条收藏`,
    );
  }

  // 事务外完成全部校验和去重计算
  const existing = await readAllEntries();
  // existingUrls 同时承担库内去重和批内去重：批内后出现的同 normalizedUrl 记录
  // 计入 duplicates，避免唯一索引 ConstraintError 使整批事务中止。
  const existingUrls = new Set(existing.map((e) => e.normalizedUrl));
  const usedIds = new Set(existing.map((entry) => entry.id));
  const importedClips: WebClip[] = [];
  let duplicates = 0;
  let invalid = 0;

  for (const raw of clips) {
    const clip = normalizeImportedClip(raw, usedIds);
    if (!clip) {
      invalid++;
      continue;
    }
    if (existingUrls.has(clip.normalizedUrl)) {
      duplicates++;
      continue;
    }

    existingUrls.add(clip.normalizedUrl);
    importedClips.push(clip);
  }

  if (importedClips.length > 0) {
    const db = await openPageTroveDatabase();
    try {
      const tx = db.transaction(['clips', 'clipEntries'], 'readwrite');
      const clipsStore = tx.objectStore('clips');
      const entriesStore = tx.objectStore('clipEntries');
      for (const clip of importedClips) {
        void clipsStore.put(clip);
        void entriesStore.put(toIndexEntry(clip));
      }
      await tx.done;
    } catch (error) {
      throw mapDatabaseError(error);
    }
    emitDataChanged('clips');
  }

  return {
    imported: importedClips.length,
    duplicates,
    invalid,
  };
}
