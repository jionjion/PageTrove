import type { ExtensionSettings } from '@/types/settings';
import { AppError } from '@/utils/errors';
import type {
  OpenAIMessage,
  OpenAITool,
  RoundResult,
} from '@/services/ai/provider';
import { createSseAccumulator } from '@/services/ai/sse-parser';

/**
 * OpenAI 兼容供应商:只负责请求/流协议,
 * 不读取 React 状态或 IndexedDB,不组装业务消息。
 */

function endpoint(settings: ExtensionSettings): string {
  return `${settings.baseUrl.replace(/\/$/, '')}/chat/completions`;
}

function authHeaders(settings: ExtensionSettings): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${settings.apiKey}`,
  };
}

function assertResponseOk(response: Response, label: string): void {
  if (
    response.status === 401 ||
    response.status === 402 ||
    response.status === 403
  ) {
    throw new AppError('AI_UNAUTHORIZED');
  }
  if (!response.ok) {
    throw new AppError('AI_ANALYZE_FAILED', `${label}（HTTP ${response.status}）`);
  }
}

/** 非流式 JSON 补全(收藏整理用),返回首个 choice 的文本。 */
export async function requestJsonCompletion(
  settings: ExtensionSettings,
  messages: OpenAIMessage[],
  timeoutMs = 180_000,
): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let response: Response;
  try {
    response = await fetch(endpoint(settings), {
      method: 'POST',
      headers: authHeaders(settings),
      body: JSON.stringify({
        model: settings.model,
        messages,
        response_format: { type: 'json_object' },
        temperature: 0.3,
        // 整理任务不需要深度思考；两种字段兼容不同网关（DashScope 顶层 / vLLM chat_template_kwargs）
        enable_thinking: false,
        chat_template_kwargs: { enable_thinking: false },
        stream: false,
      }),
      signal: controller.signal,
    });
  } catch {
    throw new AppError('NETWORK_ERROR');
  } finally {
    clearTimeout(timer);
  }

  assertResponseOk(response, 'AI 分析失败');

  const body = (await response.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const content = body.choices?.[0]?.message?.content;
  if (!content) {
    throw new AppError('INVALID_AI_RESPONSE');
  }
  return content;
}

/** 单轮流式补全(对话用),onDelta 收到累计全文。 */
export async function requestStreamingRound(
  settings: ExtensionSettings,
  messages: OpenAIMessage[],
  tools: OpenAITool[],
  onDelta: (fullText: string) => void,
  signal: AbortSignal,
): Promise<RoundResult> {
  let response: Response;
  try {
    response = await fetch(endpoint(settings), {
      method: 'POST',
      headers: authHeaders(settings),
      body: JSON.stringify({
        model: settings.model,
        messages,
        ...(tools.length > 0 ? { tools, tool_choice: 'auto' } : {}),
        temperature: 1.0,
        stream: true,
        stream_options: { include_usage: true },
      }),
      signal,
    });
  } catch (error) {
    if (signal.aborted) throw error;
    throw new AppError('NETWORK_ERROR');
  }

  assertResponseOk(response, 'AI 请求失败');
  if (!response.body) {
    throw new AppError('AI_ANALYZE_FAILED', `AI 请求失败（HTTP ${response.status}）`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const accumulator = createSseAccumulator(onDelta);
  let buffer = '';

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      lines.forEach(accumulator.processLine);
    }
    buffer += decoder.decode();
    if (buffer.trim()) accumulator.processLine(buffer);
  } finally {
    reader.releaseLock();
  }

  const result = accumulator.finish();
  if (!result.content.trim() && result.toolCalls.length === 0) {
    throw new AppError('INVALID_AI_RESPONSE');
  }
  return result;
}
