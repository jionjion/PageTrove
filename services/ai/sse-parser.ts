import type { OpenAIToolCall, RoundResult, TokenUsage } from '@/services/ai/provider';

/**
 * OpenAI 兼容 SSE 流的增量解析器(纯逻辑,无 IO):
 * 逐行喂入 `data: {...}` 载荷,累积 content/tool_calls/usage。
 */
export interface SseAccumulator {
  /** 喂入一行原始 SSE 文本(含或不含 data: 前缀均可)。content 增量时回调全文。 */
  processLine: (line: string) => void;
  /** 结束后取汇总结果(tool_calls 规范化:过滤无名调用、补全缺失 id)。 */
  finish: () => RoundResult;
}

export function createSseAccumulator(
  onDelta: (fullText: string) => void,
): SseAccumulator {
  let content = '';
  let usage: TokenUsage | undefined;
  const toolCalls: OpenAIToolCall[] = [];

  const processLine = (line: string) => {
    const trimmed = line.trim();
    if (!trimmed.startsWith('data:')) return;
    const payload = trimmed.slice(5).trim();
    if (!payload || payload === '[DONE]') return;

    try {
      const chunk = JSON.parse(payload) as {
        choices?: {
          delta?: {
            content?: string;
            tool_calls?: {
              index?: number;
              id?: string;
              type?: 'function';
              function?: { name?: string; arguments?: string };
            }[];
          };
        }[];
        usage?: { prompt_tokens?: number; completion_tokens?: number } | null;
      };
      const delta = chunk.choices?.[0]?.delta;
      if (delta?.content) {
        content += delta.content;
        onDelta(content);
      }
      for (const callDelta of delta?.tool_calls ?? []) {
        const index = callDelta.index ?? 0;
        const call =
          toolCalls[index] ??
          (toolCalls[index] = {
            id: '',
            type: 'function',
            function: { name: '', arguments: '' },
          });
        if (callDelta.id) call.id += callDelta.id;
        if (callDelta.function?.name) {
          call.function.name += callDelta.function.name;
        }
        if (callDelta.function?.arguments) {
          call.function.arguments += callDelta.function.arguments;
        }
      }
      if (chunk.usage) {
        usage = {
          promptTokens: chunk.usage.prompt_tokens ?? 0,
          completionTokens: chunk.usage.completion_tokens ?? 0,
        };
      }
    } catch {
      // 跳过无法解析的兼容接口 SSE 行。
    }
  };

  const finish = (): RoundResult => {
    const normalizedCalls = toolCalls
      .filter((call) => call?.function.name)
      .map((call, index) => ({
        ...call,
        id: call.id || `tool-call-${Date.now()}-${index}`,
      }));
    return { content, toolCalls: normalizedCalls, usage };
  };

  return { processLine, finish };
}
