import { browser } from 'wxt/browser';
import type { ClipIndexEntry, ClipQuery, WebClip } from '@/types/clip';
import { AppError } from '@/utils/errors';

const INDEX_KEY = 'clips:index';

const clipKey = (id: string) => `clip:${id}`;

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
  return (result[INDEX_KEY] as ClipIndexEntry[] | undefined) ?? [];
}

async function writeIndex(index: ClipIndexEntry[]): Promise<void> {
  await browser.storage.local.set({ [INDEX_KEY]: index });
}

async function writeClip(clip: WebClip): Promise<void> {
  try {
    await browser.storage.local.set({ [clipKey(clip.id)]: clip });
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (message.includes('QUOTA') || message.includes('quota')) {
      throw new AppError('STORAGE_FULL');
    }
    throw new AppError('SAVE_FAILED');
  }
}

export async function createClip(clip: WebClip): Promise<void> {
  await writeClip(clip);
  const index = await readIndex();
  await writeIndex([toIndexEntry(clip), ...index.filter((e) => e.id !== clip.id)]);
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
  await writeClip(next);

  const index = await readIndex();
  await writeIndex(index.map((e) => (e.id === id ? toIndexEntry(next) : e)));
  return next;
}

export async function removeClip(id: string): Promise<void> {
  await browser.storage.local.remove(clipKey(id));
  const index = await readIndex();
  await writeIndex(index.filter((e) => e.id !== id));
}

export async function getClip(id: string): Promise<WebClip | undefined> {
  const result = await browser.storage.local.get(clipKey(id));
  return result[clipKey(id)] as WebClip | undefined;
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
  if (query.tag) {
    entries = entries.filter((e) => e.tags.includes(query.tag!));
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
  return JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), clips }, null, 2);
}

/** 导入 JSON，按 normalizedUrl 去重，返回导入条数 */
export async function importAll(json: string): Promise<number> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new AppError('SAVE_FAILED', '导入文件不是有效的 JSON');
  }

  const clips = (parsed as { clips?: unknown }).clips;
  if (!Array.isArray(clips)) {
    throw new AppError('SAVE_FAILED', '导入文件缺少 clips 字段');
  }

  const index = await readIndex();
  const existingUrls = new Set(index.map((e) => e.normalizedUrl));
  let imported = 0;

  for (const raw of clips) {
    const clip = raw as WebClip;
    if (!clip.id || !clip.url || !clip.normalizedUrl || !clip.title) continue;
    if (existingUrls.has(clip.normalizedUrl)) continue;

    await writeClip({
      ...clip,
      tags: clip.tags ?? [],
    });
    index.unshift(toIndexEntry(clip));
    existingUrls.add(clip.normalizedUrl);
    imported++;
  }

  await writeIndex(index);
  return imported;
}
