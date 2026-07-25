/**
 * 多来源问答的"轻量相关段落选择"。
 * 按用户问题从各来源正文中挑选相关片段并控制总字符预算，
 * 不是向量检索，不引入 Embedding。
 */

export const MAX_SCOPE_SOURCES = 5;
export const MAX_SCOPE_TOTAL_CHARS = 36_000;
export const MIN_SOURCE_CHARS = 2_000;
const CHUNK_SIZE = 800;
const CHUNK_OVERLAP = 120;

/** 将正文切分为带重叠的段落块。 */
function chunkText(text: string): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  if (trimmed.length <= CHUNK_SIZE) return [trimmed];

  const chunks: string[] = [];
  let start = 0;
  while (start < trimmed.length) {
    chunks.push(trimmed.slice(start, start + CHUNK_SIZE));
    start += CHUNK_SIZE - CHUNK_OVERLAP;
  }
  return chunks;
}

/**
 * 从问题生成简单查询词：
 * 英文按单词切分，中文取连续片段及其双字组合。
 */
function buildQueryTerms(question: string): string[] {
  const normalized = question.normalize('NFKC').toLowerCase();
  const terms = new Set<string>();

  for (const word of normalized.match(/[a-z0-9]+/g) ?? []) {
    if (word.length >= 2) terms.add(word);
  }

  for (const run of normalized.match(/[\u4e00-\u9fff]+/g) ?? []) {
    if (run.length >= 2) terms.add(run);
    for (let index = 0; index + 2 <= run.length; index++) {
      terms.add(run.slice(index, index + 2));
    }
  }

  return [...terms];
}

function scoreChunk(chunk: string, terms: string[]): number {
  if (terms.length === 0) return 0;
  const lower = chunk.normalize('NFKC').toLowerCase();
  let score = 0;
  for (const term of terms) {
    if (lower.includes(term)) score += term.length >= 3 ? 2 : 1;
  }
  return score;
}

/**
 * 从单个来源正文中按问题挑选相关片段，并压缩到 budget 字符以内。
 * 始终保留首段；没有任何命中时回退为正文开头。
 */
export function selectRelevantExcerpt(
  content: string,
  question: string,
  budget: number,
): string {
  const trimmed = content.trim();
  if (!trimmed) return '';
  if (trimmed.length <= budget) return trimmed;

  const chunks = chunkText(trimmed);
  const terms = buildQueryTerms(question);

  const scored = chunks.map((chunk, index) => ({
    index,
    chunk,
    score: scoreChunk(chunk, terms),
  }));

  const hasHit = scored.some((item) => item.score > 0);
  if (!hasHit) {
    return trimmed.slice(0, budget);
  }

  // 首段始终保留，其余按分数从高到低补足预算。
  const picked = new Set<number>([0]);
  let used = chunks[0].length;
  const candidates = scored
    .filter((item) => item.index !== 0)
    .sort((a, b) => b.score - a.score || a.index - b.index);

  for (const candidate of candidates) {
    if (candidate.score === 0) break;
    if (used + candidate.chunk.length > budget) continue;
    picked.add(candidate.index);
    used += candidate.chunk.length;
  }

  // 按原文顺序拼接，保持可读性。
  const parts = [...picked]
    .sort((a, b) => a - b)
    .map((index) => chunks[index]);
  return parts.join('\n……\n').slice(0, budget);
}

/** 计算每个来源的字符预算。 */
export function sourceBudget(sourceCount: number): number {
  if (sourceCount <= 0) return MAX_SCOPE_TOTAL_CHARS;
  return Math.max(
    MIN_SOURCE_CHARS,
    Math.floor(MAX_SCOPE_TOTAL_CHARS / sourceCount),
  );
}
