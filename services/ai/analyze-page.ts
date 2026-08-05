import type { AnalyzeResult } from '@/types/ai';
import type { PageSnapshot } from '@/types/page-snapshot';
import type { ExtensionSettings } from '@/types/settings';
import { AppError } from '@/utils/errors';
import {
  ANALYZE_SYSTEM_PROMPT,
  ANALYZE_SYSTEM_PROMPT_WITH_CONTENT,
  buildAnalyzeUserPrompt,
} from '@/services/ai/prompt-builder';
import { requestJsonCompletion } from '@/services/ai/openai-compatible-provider';

const LIMITS = {
  summary: 200,
  tagMax: 5,
  tagLength: 20,
  content: 200_000,
};

function cleanStringArray(
  value: unknown,
  maxItems: number,
  maxLength: number,
): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim().slice(0, maxLength))
    .filter(Boolean)
    .slice(0, maxItems);
}

export function validateAnalyzeResult(raw: unknown): AnalyzeResult {
  if (typeof raw !== 'object' || raw === null) {
    throw new AppError('INVALID_AI_RESPONSE');
  }
  const data = raw as Record<string, unknown>;

  const summary =
    typeof data.summary === 'string'
      ? data.summary.trim().slice(0, LIMITS.summary)
      : '';
  if (!summary) {
    throw new AppError('INVALID_AI_RESPONSE');
  }

  const tags = cleanStringArray(data.tags, LIMITS.tagMax, LIMITS.tagLength);
  if (tags.length === 0) {
    throw new AppError('INVALID_AI_RESPONSE');
  }

  const confidence =
    typeof data.confidence === 'number'
      ? Math.min(1, Math.max(0, data.confidence))
      : 0.5;

  const content =
    typeof data.content === 'string'
      ? data.content.trim().slice(0, LIMITS.content) || undefined
      : undefined;

  return {
    summary,
    tags,
    content,
    confidence,
  };
}

/** 分析网页快照,输出摘要/标签/(可选)整理后的正文。 */
export async function analyzePage(
  snapshot: PageSnapshot,
  note: string,
  settings: ExtensionSettings,
  refineContent: boolean,
): Promise<AnalyzeResult> {
  if (!settings.apiKey.trim()) {
    throw new AppError('MISSING_API_KEY');
  }

  if (!snapshot.mainText && !snapshot.selectedText && !snapshot.description) {
    throw new AppError('EMPTY_CONTENT');
  }

  // 输出解析失败时允许重试一次
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    const content = await requestJsonCompletion(settings, [
      {
        role: 'system',
        content: refineContent
          ? ANALYZE_SYSTEM_PROMPT_WITH_CONTENT
          : ANALYZE_SYSTEM_PROMPT,
      },
      { role: 'user', content: buildAnalyzeUserPrompt(snapshot, note) },
    ]);
    try {
      return validateAnalyzeResult(JSON.parse(content));
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof AppError
    ? lastError
    : new AppError('INVALID_AI_RESPONSE');
}
