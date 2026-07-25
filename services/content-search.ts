import type { WebClip } from '@/types/clip';

/** 单条搜索结果：命中收藏 id、总分和正文命中片段。 */
export interface ContentSearchHit {
  id: string;
  score: number;
  /** 正文 / 备注 / 选中文字命中时，命中位置附近的片段。 */
  excerpt?: string;
}

const WEIGHTS = {
  title: 6,
  tags: 5,
  summary: 4,
  userNote: 3,
  selectedText: 3,
  domain: 2,
  extractedText: 1,
} as const;

const EXCERPT_RADIUS = 60; // 命中位置前后各 60 字符，共约 120 字符

function normalize(text: string): string {
  return text.normalize('NFKC').toLowerCase();
}

/** 按空白切分查询词；中文连续输入没有空格时整体作为一个词。 */
export function parseQueryTerms(query: string): string[] {
  return normalize(query.trim())
    .split(/\s+/)
    .filter(Boolean);
}

function fieldScore(
  value: string | undefined,
  term: string,
  weight: number,
): number {
  if (!value) return 0;
  return normalize(value).includes(term) ? weight : 0;
}

function excerptAround(text: string, term: string): string | undefined {
  const index = normalize(text).indexOf(term);
  if (index < 0) return undefined;
  const start = Math.max(0, index - EXCERPT_RADIUS);
  const end = Math.min(text.length, index + term.length + EXCERPT_RADIUS);
  const prefix = start > 0 ? '…' : '';
  const suffix = end < text.length ? '…' : '';
  return `${prefix}${text.slice(start, end).replace(/\s+/g, ' ').trim()}${suffix}`;
}

/**
 * 在内存中对收藏详情做加权全文搜索。
 * 多个查询词为 AND 关系；按总分降序、收藏时间倒序排列。
 */
export function searchClipContents(
  clips: WebClip[],
  query: string,
): ContentSearchHit[] {
  const terms = parseQueryTerms(query);
  if (terms.length === 0) return [];

  const hits: (ContentSearchHit & { createdAt: string })[] = [];

  for (const clip of clips) {
    let total = 0;
    let excerpt: string | undefined;
    let matchedAll = true;

    for (const term of terms) {
      let score = 0;
      score += fieldScore(clip.title, term, WEIGHTS.title);
      score += clip.tags.some((tag) => normalize(tag).includes(term))
        ? WEIGHTS.tags
        : 0;
      score += fieldScore(clip.summary, term, WEIGHTS.summary);
      score += fieldScore(clip.userNote, term, WEIGHTS.userNote);
      score += fieldScore(clip.selectedText, term, WEIGHTS.selectedText);
      score += fieldScore(clip.domain, term, WEIGHTS.domain);
      score += fieldScore(clip.extractedText, term, WEIGHTS.extractedText);

      if (score === 0) {
        matchedAll = false;
        break;
      }
      total += score;

      // 正文 / 备注 / 选中文字命中时提取片段（取第一个命中的词）。
      if (!excerpt) {
        for (const field of [
          clip.extractedText,
          clip.userNote,
          clip.selectedText,
        ]) {
          if (!field) continue;
          const found = excerptAround(field, term);
          if (found) {
            excerpt = found;
            break;
          }
        }
      }
    }

    if (matchedAll) {
      hits.push({ id: clip.id, score: total, excerpt, createdAt: clip.createdAt });
    }
  }

  hits.sort(
    (a, b) => b.score - a.score || b.createdAt.localeCompare(a.createdAt),
  );
  return hits.map(({ id, score, excerpt }) => ({ id, score, excerpt }));
}
