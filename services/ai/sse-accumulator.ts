import type { OpenAIToolCall, RoundResult, TokenUsage } from '@/services/ai/provider';
import { AppError } from '@/utils/errors';

export interface SseAccumulatorLimits {
  maxLineChars: number;
  maxContentChars: number;
  maxToolArgumentBytes: number;
  maxToolCalls: number;
  maxToolIdChars: number;
  maxToolNameChars: number;
}

export const DEFAULT_SSE_LIMITS: SseAccumulatorLimits = {
  maxLineChars: 256 * 1024,
  maxContentChars: 1024 * 1024,
  maxToolArgumentBytes: 32 * 1024,
  maxToolCalls: 64,
  maxToolIdChars: 256,
  maxToolNameChars: 256,
};

export interface SseAccumulator {
  processLine: (line: string) => void;
  /** 流必须由 `[DONE]` 或非空 `finish_reason` 正常结束，否则拒绝部分结果。 */
  finish: () => RoundResult;
}

interface MutableToolCall extends OpenAIToolCall {
  argumentBytes: number;
}

function invalidResponse(message: string): AppError {
  return new AppError('INVALID_AI_RESPONSE', message);
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw invalidResponse(`${label}格式异常`);
  }
  return value as Record<string, unknown>;
}

function readUsage(value: unknown): TokenUsage {
  const usage = asRecord(value, 'AI usage');
  const readCount = (key: string): number => {
    const count = usage[key];
    if (count === undefined) return 0;
    if (typeof count !== 'number' || !Number.isFinite(count) || count < 0) {
      throw invalidResponse('AI usage 格式异常');
    }
    return count;
  };
  return {
    promptTokens: readCount('prompt_tokens'),
    completionTokens: readCount('completion_tokens'),
  };
}

/** OpenAI 兼容 SSE 的有界、失败关闭增量解析器。 */
export function createSseAccumulator(
  onDelta: (fullText: string) => void,
  limitOverrides: Partial<SseAccumulatorLimits> = {},
): SseAccumulator {
  const limits = { ...DEFAULT_SSE_LIMITS, ...limitOverrides };
  const encoder = new TextEncoder();
  const toolCalls = new Map<number, MutableToolCall>();
  let content = '';
  let usage: TokenUsage | undefined;
  let sawDone = false;
  let sawFinishReason = false;

  const processToolDelta = (value: unknown) => {
    const delta = asRecord(value, 'AI tool_call');
    const index = delta.index;
    if (
      typeof index !== 'number' ||
      !Number.isInteger(index) ||
      index < 0 ||
      index >= limits.maxToolCalls
    ) {
      throw invalidResponse('AI tool_call index 超出范围');
    }

    let call = toolCalls.get(index);
    if (!call) {
      if (toolCalls.size >= limits.maxToolCalls) {
        throw invalidResponse('AI 工具调用数量超过限制');
      }
      call = {
        id: '',
        type: 'function',
        function: { name: '', arguments: '' },
        argumentBytes: 0,
      };
      toolCalls.set(index, call);
    }

    if (delta.type !== undefined && delta.type !== 'function') {
      throw invalidResponse('AI 返回了不支持的工具调用类型');
    }
    if (delta.id !== undefined) {
      if (typeof delta.id !== 'string') {
        throw invalidResponse('AI tool_call id 格式异常');
      }
      call.id += delta.id;
      if (call.id.length > limits.maxToolIdChars) {
        throw invalidResponse('AI tool_call id 超过限制');
      }
    }

    if (delta.function !== undefined) {
      const fn = asRecord(delta.function, 'AI tool_call function');
      if (fn.name !== undefined) {
        if (typeof fn.name !== 'string') {
          throw invalidResponse('AI 工具名称格式异常');
        }
        call.function.name += fn.name;
        if (call.function.name.length > limits.maxToolNameChars) {
          throw invalidResponse('AI 工具名称超过限制');
        }
      }
      if (fn.arguments !== undefined) {
        if (typeof fn.arguments !== 'string') {
          throw invalidResponse('AI 工具参数格式异常');
        }
        call.argumentBytes += encoder.encode(fn.arguments).byteLength;
        if (call.argumentBytes > limits.maxToolArgumentBytes) {
          throw invalidResponse('AI 工具参数超过限制');
        }
        call.function.arguments += fn.arguments;
      }
    }
  };

  const processLine = (line: string) => {
    if (line.length > limits.maxLineChars) {
      throw invalidResponse('AI SSE 单行超过限制');
    }
    const trimmed = line.trim();
    if (!trimmed.startsWith('data:')) return;
    const payload = trimmed.slice(5).trim();
    if (!payload) return;
    if (payload === '[DONE]') {
      sawDone = true;
      return;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(payload);
    } catch {
      throw invalidResponse('AI SSE 包含无效 JSON');
    }
    const chunk = asRecord(parsed, 'AI SSE 数据');

    if (chunk.usage !== undefined && chunk.usage !== null) {
      usage = readUsage(chunk.usage);
    }
    if (chunk.choices === undefined) return;
    if (!Array.isArray(chunk.choices)) {
      throw invalidResponse('AI choices 格式异常');
    }
    const firstChoice = chunk.choices[0];
    if (firstChoice === undefined) return;
    const choice = asRecord(firstChoice, 'AI choice');

    if (choice.finish_reason !== undefined && choice.finish_reason !== null) {
      if (typeof choice.finish_reason !== 'string' || !choice.finish_reason.trim()) {
        throw invalidResponse('AI finish_reason 格式异常');
      }
      sawFinishReason = true;
    }

    if (choice.delta === undefined || choice.delta === null) return;
    const delta = asRecord(choice.delta, 'AI delta');
    if (delta.content !== undefined && delta.content !== null) {
      if (typeof delta.content !== 'string') {
        throw invalidResponse('AI content 格式异常');
      }
      if (content.length + delta.content.length > limits.maxContentChars) {
        throw invalidResponse('AI 流式正文超过限制');
      }
      content += delta.content;
      if (delta.content) onDelta(content);
    }

    if (delta.tool_calls !== undefined) {
      if (!Array.isArray(delta.tool_calls)) {
        throw invalidResponse('AI tool_calls 格式异常');
      }
      delta.tool_calls.forEach(processToolDelta);
    }
  };

  const finish = (): RoundResult => {
    if (!sawDone && !sawFinishReason) {
      throw invalidResponse('AI 流未正常结束，已拒绝不完整结果');
    }

    const normalizedCalls = [...toolCalls.entries()]
      .sort(([left], [right]) => left - right)
      .map(([, call]) => {
        if (!call.id.trim() || !call.function.name.trim()) {
          throw invalidResponse('AI 返回了残缺的工具调用');
        }
        if (!call.function.arguments.trim()) {
          throw invalidResponse('AI 返回了残缺的工具参数');
        }
        let parsedArguments: unknown;
        try {
          parsedArguments = JSON.parse(call.function.arguments);
        } catch {
          throw invalidResponse('AI 返回了残缺的工具参数');
        }
        if (
          typeof parsedArguments !== 'object' ||
          parsedArguments === null ||
          Array.isArray(parsedArguments)
        ) {
          throw invalidResponse('AI 工具参数必须是 JSON 对象');
        }
        const { argumentBytes: _argumentBytes, ...result } = call;
        return result;
      });

    return { content, toolCalls: normalizedCalls, usage };
  };

  return { processLine, finish };
}
