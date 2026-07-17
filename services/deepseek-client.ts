import type { AnalyzeResult } from '@/types/ai';
import type { PageSnapshot } from '@/types/page-snapshot';
import type { ExtensionSettings } from '@/types/settings';
import { AppError } from '@/utils/errors';

const SYSTEM_PROMPT = `你是一个"有趣网站收藏整理助手"。

你的任务是根据用户提供的网页快照，整理这个网站值得收藏的原因，并输出结构化 json 结果。

要求：

1. 只能依据输入内容，不得虚构网页功能。
2. 如果网页信息不足，应明确体现"信息不足"。
3. 摘要用于让用户快速了解这个收藏：说明网站是什么、有什么内容、为什么值得收藏，控制在100个汉字以内。
4. 标签输出3至5个。
5. 不要复述大段网页原文。
6. 不要输出Markdown。
7. 只输出符合下面结构的 json，不要输出其他内容：

{
  "summary": "摘要",
  "tags": ["标签1", "标签2", "标签3"],
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
  summary: 200,
  tagMax: 5,
  tagLength: 20,
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
    tags,
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
      `${settings.baseUrl.replace(/\/$/, '')}/chat/completions`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${settings.apiKey}`,
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
  if (!settings.apiKey.trim()) {
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

/* ------------------------- 网页对话（流式） ------------------------- */

export interface ChatContext {
  title: string;
  url: string;
  content: string;
}

function buildChatSystemPrompt(ctx: ChatContext): string {
  return `你是"拾页"的网页问答助手。请基于下面的网页内容回答用户的问题。

要求：

1. 优先依据网页内容回答；网页内容中没有的信息要如实说明，不得编造。
2. 回答使用中文，简洁明了。
3. 可以结合常识做适度延伸，但要区分"网页内容"和"你的补充"。

网页标题：${ctx.title}
网页地址：${ctx.url}

网页内容：
${ctx.content || '（内容为空）'}`;
}

/** 只发送最近的若干轮，避免上下文无限增长 */
const MAX_HISTORY_MESSAGES = 12;

export interface ChatStreamResult {
  content: string;
  /** 服务端返回的 token 统计；部分兼容网关可能不返回 */
  usage?: {
    promptTokens: number;
    completionTokens: number;
  };
  /** 从发起请求到流结束的耗时（毫秒） */
  elapsedMs: number;
}

/**
 * 流式对话。每收到一段增量文本调用一次 onDelta（参数为累计的完整文本）。
 * 返回完整回复及 token/耗时统计。
 */
export async function streamChat(
  ctx: ChatContext,
  history: { role: 'user' | 'assistant'; content: string }[],
  settings: ExtensionSettings,
  onDelta: (fullText: string) => void,
  signal?: AbortSignal,
): Promise<ChatStreamResult> {
  if (!settings.apiKey.trim()) {
    throw new AppError('MISSING_API_KEY');
  }

  const startedAt = performance.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 120_000);
  signal?.addEventListener('abort', () => controller.abort());

  let response: Response;
  try {
    response = await fetch(
      `${settings.baseUrl.replace(/\/$/, '')}/chat/completions`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${settings.apiKey}`,
        },
        body: JSON.stringify({
          model: settings.model,
          messages: [
            { role: 'system', content: buildChatSystemPrompt(ctx) },
            ...history.slice(-MAX_HISTORY_MESSAGES),
          ],
          temperature: 1.0,
          stream: true,
          stream_options: { include_usage: true },
        }),
        signal: controller.signal,
      },
    );
  } catch (error) {
    clearTimeout(timer);
    if (signal?.aborted) throw error;
    throw new AppError('NETWORK_ERROR');
  }

  if (response.status === 401 || response.status === 402 || response.status === 403) {
    clearTimeout(timer);
    throw new AppError('AI_UNAUTHORIZED');
  }
  if (!response.ok || !response.body) {
    clearTimeout(timer);
    throw new AppError('AI_ANALYZE_FAILED', `AI 请求失败（HTTP ${response.status}）`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let fullText = '';
  let usage: ChatStreamResult['usage'];

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue;
        const payload = trimmed.slice(5).trim();
        if (payload === '[DONE]') continue;

        try {
          const chunk = JSON.parse(payload) as {
            choices?: { delta?: { content?: string } }[];
            usage?: { prompt_tokens?: number; completion_tokens?: number } | null;
          };
          const delta = chunk.choices?.[0]?.delta?.content;
          if (delta) {
            fullText += delta;
            onDelta(fullText);
          }
          if (chunk.usage) {
            usage = {
              promptTokens: chunk.usage.prompt_tokens ?? 0,
              completionTokens: chunk.usage.completion_tokens ?? 0,
            };
          }
        } catch {
          // 跳过无法解析的 SSE 行
        }
      }
    }
  } finally {
    clearTimeout(timer);
    reader.releaseLock();
  }

  if (!fullText.trim()) {
    throw new AppError('INVALID_AI_RESPONSE');
  }
  return {
    content: fullText,
    usage,
    elapsedMs: Math.round(performance.now() - startedAt),
  };
}
