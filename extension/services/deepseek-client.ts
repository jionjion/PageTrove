import type { AnalyzeResult } from '@/types/ai';
import type { PageSnapshot } from '@/types/page-snapshot';
import type { ExtensionSettings } from '@/types/settings';
import { AppError } from '@/utils/errors';

const SYSTEM_PROMPT = `你是一个"有趣网站收藏整理助手"。

你的任务是根据用户提供的网页快照，整理这个网站值得收藏的原因，并输出结构化 json 结果。

要求：

1. 只能依据输入内容，不得虚构网页功能。
2. 如果网页信息不足，应明确体现"信息不足"。
3. 一句话介绍不超过50个汉字。
4. 标签输出3至6个。
5. "好玩的地方"关注用户为什么值得收藏。
6. "值得借鉴"关注产品、交互、视觉、内容和创意。
7. 不要复述大段网页原文。
8. 不要输出Markdown。
9. 只输出符合下面结构的 json，不要输出其他内容：

{
  "summary": "一句话介绍",
  "interestingPoints": ["好玩的地方1", "好玩的地方2"],
  "inspiration": ["值得借鉴的设计或功能1", "值得借鉴的设计或功能2"],
  "tags": ["标签1", "标签2", "标签3"],
  "category": "网站分类",
  "confidence": 0.85
}

confidence 为0到1之间的小数。`;

function buildUserPrompt(snapshot: PageSnapshot, note: string): string {
  return `请整理下面的网页快照，输出 json。

网页标题：
${snapshot.title || '（无）'}

网页地址：
${snapshot.url}

网页描述：
${snapshot.description || '（无）'}

用户选中的内容：
${snapshot.selectedText || '（无）'}

网页正文：
${snapshot.mainText || '（无）'}

用户备注：
${note || '（无）'}`;
}

const LIMITS = {
  summary: 100,
  listItem: 200,
  listMax: 5,
  tagMax: 6,
  tagLength: 20,
  category: 50,
};

function cleanStringArray(value: unknown, maxItems: number, maxLength: number): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim().slice(0, maxLength))
    .filter(Boolean)
    .slice(0, maxItems);
}

function validateAnalyzeResult(raw: unknown): AnalyzeResult {
  if (typeof raw !== 'object' || raw === null) {
    throw new AppError('INVALID_AI_RESPONSE');
  }
  const data = raw as Record<string, unknown>;

  const summary =
    typeof data.summary === 'string' ? data.summary.trim().slice(0, LIMITS.summary) : '';
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

  return {
    summary,
    interestingPoints: cleanStringArray(data.interestingPoints, LIMITS.listMax, LIMITS.listItem),
    inspiration: cleanStringArray(data.inspiration, LIMITS.listMax, LIMITS.listItem),
    tags,
    category:
      typeof data.category === 'string'
        ? data.category.trim().slice(0, LIMITS.category)
        : '未分类',
    confidence,
  };
}

async function requestChatCompletion(
  settings: ExtensionSettings,
  snapshot: PageSnapshot,
  note: string,
): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60_000);

  let response: Response;
  try {
    response = await fetch(
      `${settings.deepseekBaseUrl.replace(/\/$/, '')}/chat/completions`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${settings.deepseekApiKey}`,
        },
        body: JSON.stringify({
          model: settings.model,
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: buildUserPrompt(snapshot, note) },
          ],
          response_format: { type: 'json_object' },
          temperature: 1.0,
          stream: false,
        }),
        signal: controller.signal,
      },
    );
  } catch {
    throw new AppError('NETWORK_ERROR');
  } finally {
    clearTimeout(timer);
  }

  if (response.status === 401 || response.status === 402 || response.status === 403) {
    throw new AppError('AI_UNAUTHORIZED');
  }
  if (!response.ok) {
    throw new AppError('AI_ANALYZE_FAILED', `AI 分析失败（HTTP ${response.status}）`);
  }

  const body = (await response.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const content = body.choices?.[0]?.message?.content;
  if (!content) {
    throw new AppError('INVALID_AI_RESPONSE');
  }
  return content;
}

export async function analyzePage(
  snapshot: PageSnapshot,
  note: string,
  settings: ExtensionSettings,
): Promise<AnalyzeResult> {
  if (!settings.deepseekApiKey.trim()) {
    throw new AppError('MISSING_API_KEY');
  }

  if (!snapshot.mainText && !snapshot.selectedText && !snapshot.description) {
    throw new AppError('EMPTY_CONTENT');
  }

  // 输出解析失败时允许重试一次
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    const content = await requestChatCompletion(settings, snapshot, note);
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
