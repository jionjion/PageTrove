import { browser } from 'wxt/browser';
import type { ClipIndexEntry, ClipQuery, WebClip } from '@/types/clip';
import { AppError } from '@/utils/errors';
import { normalizeUrl } from '@/services/url-utils';

const INDEX_KEY = 'clips:index';
const EXPORT_VERSION = 1;
const MAX_IMPORT_BYTES = 10 * 1024 * 1024;
const MAX_IMPORT_CLIPS = 5_000;

const IMPORT_LIMITS = {
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

const clipKey = (id: string) => `clip:${id}`;

function isRecord(value: unknown): value is Record<string, unknown> {
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

async function readIndex(): Promise<ClipIndexEntry[]> {
  const result = await browser.storage.local.get(INDEX_KEY);
  const stored = result[INDEX_KEY];
  if (!Array.isArray(stored)) return [];

  return stored
    .filter(
      (entry): entry is Record<string, unknown> =>
        isRecord(entry) &&
        typeof entry.id === 'string' &&
        typeof entry.title === 'string' &&
        typeof entry.url === 'string' &&
        typeof entry.normalizedUrl === 'string' &&
        typeof entry.domain === 'string' &&
        typeof entry.createdAt === 'string',
    )
    .map(
      (entry): ClipIndexEntry => ({
        id: entry.id as string,
        title: entry.title as string,
        url: entry.url as string,
        normalizedUrl: entry.normalizedUrl as string,
        domain: entry.domain as string,
        faviconUrl:
          typeof entry.faviconUrl === 'string' ? entry.faviconUrl : undefined,
        summary: typeof entry.summary === 'string' ? entry.summary : undefined,
        tags: Array.isArray(entry.tags)
          ? entry.tags.filter((tag): tag is string => typeof tag === 'string')
          : [],
        createdAt: entry.createdAt as string,
      }),
    );
}

async function writeStorage(values: Record<string, unknown>): Promise<void> {
  try {
    await browser.storage.local.set(values);
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (message.toLowerCase().includes('quota')) {
      throw new AppError('STORAGE_FULL');
    }
    throw new AppError('SAVE_FAILED');
  }
}

export async function createClip(clip: WebClip): Promise<void> {
  const index = await readIndex();
  const nextIndex = [
    toIndexEntry(clip),
    ...index.filter((entry) => entry.id !== clip.id),
  ];
  await writeStorage({
    [clipKey(clip.id)]: clip,
    [INDEX_KEY]: nextIndex,
  });
}

export async function updateClip(
  id: string,
  patch: Partial<WebClip>,
): Promise<WebClip> {
  const existing = await getClip(id);
  if (!existing) {
    throw new AppError('SAVE_FAILED', '收藏不存在或已被删除');
  }
  const next: WebClip = {
    ...existing,
    ...patch,
    id,
    updatedAt: new Date().toISOString(),
  };

  const index = await readIndex();
  const nextIndex = index.map((entry) =>
    entry.id === id ? toIndexEntry(next) : entry,
  );
  await writeStorage({
    [clipKey(id)]: next,
    [INDEX_KEY]: nextIndex,
  });
  return next;
}

export async function removeClip(id: string): Promise<void> {
  const index = await readIndex();
  await writeStorage({
    [INDEX_KEY]: index.filter((entry) => entry.id !== id),
  });
  try {
    await browser.storage.local.remove(clipKey(id));
  } catch {
    // 索引已经移除；即使详情清理失败，也不会留下无法打开的可见记录。
    throw new AppError('SAVE_FAILED', '收藏已从列表移除，但详情清理失败');
  }
}

export async function getClip(id: string): Promise<WebClip | undefined> {
  const result = await browser.storage.local.get(clipKey(id));
  return result[clipKey(id)] as WebClip | undefined;
}

/** 批量读取收藏详情；分批执行避免一次拉起全部正文。 */
export async function getClipsByIds(ids: string[]): Promise<WebClip[]> {
  const BATCH_SIZE = 50;
  const clips: WebClip[] = [];
  for (let start = 0; start < ids.length; start += BATCH_SIZE) {
    const batch = ids.slice(start, start + BATCH_SIZE);
    const result = await browser.storage.local.get(batch.map(clipKey));
    for (const id of batch) {
      const clip = result[clipKey(id)] as WebClip | undefined;
      if (clip) clips.push(clip);
    }
  }
  return clips;
}

export async function findByNormalizedUrl(
  normalizedUrl: string,
): Promise<ClipIndexEntry | undefined> {
  const index = await readIndex();
  return index.find((e) => e.normalizedUrl === normalizedUrl);
}

export async function queryClips(query: ClipQuery = {}): Promise<ClipIndexEntry[]> {
  let entries = await readIndex();

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
  const index = await readIndex();
  const tags = new Set<string>();
  for (const entry of index) {
    entry.tags.forEach((t) => tags.add(t));
  }
  return { tags: [...tags].sort() };
}

/** 导出全部收藏为 JSON 字符串（不包含设置和 API Key） */
export async function exportAll(): Promise<string> {
  const index = await readIndex();
  const clips: WebClip[] = [];
  for (const entry of index) {
    const clip = await getClip(entry.id);
    if (clip) clips.push(clip);
  }
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

function readOptionalString(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const text = value.trim();
  return text ? text.slice(0, maxLength) : undefined;
}

function readHttpUrl(value: unknown): URL | undefined {
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

function readTags(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const tags = value
    .filter((tag): tag is string => typeof tag === 'string')
    .map((tag) => tag.trim().slice(0, IMPORT_LIMITS.tagLength))
    .filter(Boolean);
  return [...new Set(tags)].slice(0, IMPORT_LIMITS.tagCount);
}

function readIsoDate(value: unknown, fallback: string): string {
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

function normalizeImportedClip(
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

/** 校验并导入收藏，按重新计算后的 normalizedUrl 去重。 */
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

  const index = await readIndex();
  const existingUrls = new Set(index.map((e) => e.normalizedUrl));
  const usedIds = new Set(index.map((entry) => entry.id));
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
    const values: Record<string, unknown> = {
      [INDEX_KEY]: [
        ...importedClips.map(toIndexEntry),
        ...index,
      ],
    };
    for (const clip of importedClips) {
      values[clipKey(clip.id)] = clip;
    }
    await writeStorage(values);
  }

  return {
    imported: importedClips.length,
    duplicates,
    invalid,
  };
}
