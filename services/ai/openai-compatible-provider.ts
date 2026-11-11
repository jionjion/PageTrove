import type { ExtensionSettings } from '@/types/settings';
import { AppError } from '@/utils/errors';
import type { OpenAIMessage, OpenAITool, RoundResult } from '@/services/ai/provider';
import { createSseAccumulator } from '@/services/ai/sse-accumulator';

/**
 * OpenAI 兼容供应商:只负责请求/流协议,
 * 不读取 React 状态或 IndexedDB,不组装业务消息。
 */

function endpoint(settings: Pick<ExtensionSettings, 'baseUrl'>): string {
  return `${settings.baseUrl.replace(/\/+$/, '')}/chat/completions`;
}

function modelsEndpoint(settings: Pick<ExtensionSettings, 'baseUrl'>): string {
  return `${settings.baseUrl.replace(/\/+$/, '')}/models`;
}

function authHeaders(
  settings: Pick<ExtensionSettings, 'apiKey'>,
): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${settings.apiKey}`,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assertResponseOk(response: Response, label: string): void {
  if (response.status === 401 || response.status === 402 || response.status === 403) {
    throw new AppError('AI_UNAUTHORIZED');
  }
  if (!response.ok) {
    throw new AppError('AI_ANALYZE_FAILED', `${label}（HTTP ${response.status}）`);
  }
}

export const AI_RESPONSE_LIMITS = {
  jsonBodyBytes: 2 * 1024 * 1024,
  streamBodyBytes: 8 * 1024 * 1024,
  streamBufferChars: 256 * 1024,
} as const;

function invalidResponse(message: string): AppError {
  return new AppError('INVALID_AI_RESPONSE', message);
}

function throwIfAborted(signal: AbortSignal): void {
  if (!signal.aborted) return;
  throw signal.reason ?? new DOMException('请求已取消', 'AbortError');
}

function assertContentLength(response: Response, maxBytes: number): void {
  const rawLength = response.headers.get('content-length');
  if (!rawLength) return;
  const length = Number(rawLength);
  if (Number.isFinite(length) && length > maxBytes) {
    throw invalidResponse('AI 响应体超过限制');
  }
}

async function readBoundedText(
  response: Response,
  maxBytes: number,
  signal: AbortSignal,
): Promise<string> {
  assertContentLength(response, maxBytes);
  if (!response.body) throw invalidResponse('AI 响应缺少正文');

  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let totalBytes = 0;
  let text = '';
  let completed = false;
  try {
    for (;;) {
      throwIfAborted(signal);
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        throw invalidResponse('AI 响应体超过限制');
      }
      try {
        text += decoder.decode(value, { stream: true });
      } catch {
        throw invalidResponse('AI 响应不是有效 UTF-8');
      }
    }
    try {
      text += decoder.decode();
    } catch {
      throw invalidResponse('AI 响应不是有效 UTF-8');
    }
    throwIfAborted(signal);
    completed = true;
    return text;
  } finally {
    if (!completed) await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

function linkAbortSignal(controller: AbortController, signal?: AbortSignal): () => void {
  if (!signal) return () => undefined;
  const abortFromCaller = () => controller.abort(signal.reason);
  if (signal.aborted) abortFromCaller();
  else signal.addEventListener('abort', abortFromCaller, { once: true });
  return () => signal.removeEventListener('abort', abortFromCaller);
}

function rethrowRequestError(error: unknown, signal: AbortSignal): never {
  if (signal.aborted) {
    throw signal.reason ?? error;
  }
  if (error instanceof AppError) throw error;
  throw new AppError('NETWORK_ERROR');
}

export const MODEL_LIST_LIMITS = {
  models: 200,
  inspected: 1_000,
  idLength: 200,
} as const;

/** OpenAI 兼容 /models 中混有嵌入、语音、图像等非对话模型，选择模型时过滤掉。 */
const NON_CHAT_MODEL =
  /(?:embedding|embed-|rerank|tts|asr|whisper|speech|transcri|moderation|audio|image-generation|video-generation|wanx|cosyvoice|paraformer)/i;

/** 兼容 `{ data: [...] }`、`{ models: [...] }` 与裸数组三种常见返回结构。 */
function readModelIds(body: unknown): string[] {
  const entries = Array.isArray(body)
    ? body
    : isRecord(body)
      ? Array.isArray(body.data)
        ? body.data
        : Array.isArray(body.models)
          ? body.models
          : undefined
      : undefined;
  if (!entries) throw invalidResponse('模型列表返回格式异常');

  const ids: string[] = [];
  for (const entry of entries.slice(0, MODEL_LIST_LIMITS.inspected)) {
    const rawId =
      typeof entry === 'string'
        ? entry
        : isRecord(entry) && typeof entry.id === 'string'
          ? entry.id
          : undefined;
    if (rawId === undefined) continue;
    const id = rawId.trim();
    if (!id || id.length > MODEL_LIST_LIMITS.idLength) continue;
    if (NON_CHAT_MODEL.test(id)) continue;
    ids.push(id);
    if (ids.length >= MODEL_LIST_LIMITS.models) break;
  }
  return [...new Set(ids)];
}

/**
 * GET /models：读取供应商当前可用的模型 ID（OpenAI 兼容端点）。
 * 只负责协议与边界校验；合并选项和错误提示由调用方处理。
 */
export async function requestModelList(
  settings: Pick<ExtensionSettings, 'baseUrl' | 'apiKey'>,
  timeoutMs = 15_000,
  signal?: AbortSignal,
): Promise<string[]> {
  const controller = new AbortController();
  const unlink = linkAbortSignal(controller, signal);
  const timer = setTimeout(
    () => controller.abort(new AppError('REQUEST_TIMEOUT')),
    timeoutMs,
  );
  try {
    const response = await fetch(modelsEndpoint(settings), {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${settings.apiKey}`,
      },
      signal: controller.signal,
    });
    throwIfAborted(controller.signal);
    // 部分供应商不提供 /models（如智谱、Kimi 的某些网关）；静默回退到内置预设。
    if (response.status === 404 || response.status === 405) return [];
    assertResponseOk(response, '模型列表获取失败');

    const text = await readBoundedText(
      response,
      AI_RESPONSE_LIMITS.jsonBodyBytes,
      controller.signal,
    );
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      throw invalidResponse('模型列表返回了无效 JSON');
    }
    return readModelIds(body);
  } catch (error) {
    rethrowRequestError(error, controller.signal);
  } finally {
    clearTimeout(timer);
    unlink();
  }
}

/** 非流式 JSON 补全(收藏整理用),返回首个 choice 的文本。 */
export async function requestJsonCompletion(
  settings: ExtensionSettings,
  messages: OpenAIMessage[],
  timeoutMs = 180_000,
  signal?: AbortSignal,
): Promise<string> {
  const controller = new AbortController();
  const unlink = linkAbortSignal(controller, signal);
  const timer = setTimeout(
    () => controller.abort(new AppError('REQUEST_TIMEOUT')),
    timeoutMs,
  );
  try {
    const response = await fetch(endpoint(settings), {
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
    throwIfAborted(controller.signal);
    assertResponseOk(response, 'AI 分析失败');

    const text = await readBoundedText(
      response,
      AI_RESPONSE_LIMITS.jsonBodyBytes,
      controller.signal,
    );
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      throw invalidResponse('AI 返回了无效 JSON');
    }
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      throw invalidResponse('AI 返回格式异常');
    }
    const choices = (body as Record<string, unknown>).choices;
    if (!Array.isArray(choices)) throw invalidResponse('AI 返回格式异常');
    const first = choices[0];
    if (typeof first !== 'object' || first === null || Array.isArray(first)) {
      throw invalidResponse('AI 返回格式异常');
    }
    const message = (first as Record<string, unknown>).message;
    if (typeof message !== 'object' || message === null || Array.isArray(message)) {
      throw invalidResponse('AI 返回格式异常');
    }
    const content = (message as Record<string, unknown>).content;
    if (typeof content !== 'string' || !content) {
      throw invalidResponse('AI 返回格式异常');
    }
    return content;
  } catch (error) {
    rethrowRequestError(error, controller.signal);
  } finally {
    clearTimeout(timer);
    unlink();
  }
}

/** 单轮流式补全(对话用),onDelta 收到累计全文。 */
export async function requestStreamingRound(
  settings: ExtensionSettings,
  messages: OpenAIMessage[],
  tools: OpenAITool[],
  onDelta: (fullText: string) => void,
  signal: AbortSignal,
): Promise<RoundResult> {
  try {
    const response = await fetch(endpoint(settings), {
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
    throwIfAborted(signal);
    assertResponseOk(response, 'AI 请求失败');
    assertContentLength(response, AI_RESPONSE_LIMITS.streamBodyBytes);
    if (!response.body) throw invalidResponse('AI 流式响应缺少正文');

    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8', { fatal: true });
    const accumulator = createSseAccumulator(onDelta);
    let buffer = '';
    let totalBytes = 0;
    let completed = false;
    try {
      for (;;) {
        throwIfAborted(signal);
        const { done, value } = await reader.read();
        if (done) break;
        totalBytes += value.byteLength;
        if (totalBytes > AI_RESPONSE_LIMITS.streamBodyBytes) {
          throw invalidResponse('AI 流式响应体超过限制');
        }
        try {
          buffer += decoder.decode(value, { stream: true });
        } catch {
          throw invalidResponse('AI 流式响应不是有效 UTF-8');
        }

        let newline = buffer.indexOf('\n');
        while (newline >= 0) {
          const line = buffer.slice(0, newline);
          buffer = buffer.slice(newline + 1);
          accumulator.processLine(line);
          newline = buffer.indexOf('\n');
        }
        if (buffer.length > AI_RESPONSE_LIMITS.streamBufferChars) {
          throw invalidResponse('AI SSE 缓冲区超过限制');
        }
      }
      try {
        buffer += decoder.decode();
      } catch {
        throw invalidResponse('AI 流式响应不是有效 UTF-8');
      }
      if (buffer.length > AI_RESPONSE_LIMITS.streamBufferChars) {
        throw invalidResponse('AI SSE 缓冲区超过限制');
      }
      if (buffer.trim()) accumulator.processLine(buffer);
      throwIfAborted(signal);
      const result = accumulator.finish();
      if (!result.content.trim() && result.toolCalls.length === 0) {
        throw invalidResponse('AI 返回内容为空');
      }
      completed = true;
      return result;
    } finally {
      if (!completed) await reader.cancel().catch(() => undefined);
      reader.releaseLock();
    }
  } catch (error) {
    rethrowRequestError(error, signal);
  }
}
