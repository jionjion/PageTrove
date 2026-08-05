import { describe, expect, it, vi } from 'vitest';
import { createSseAccumulator } from '@/services/ai/sse-parser';

function feed(lines: string[], onDelta = vi.fn()) {
  const acc = createSseAccumulator(onDelta);
  lines.forEach(acc.processLine);
  return { result: acc.finish(), onDelta };
}

describe('createSseAccumulator', () => {
  it('累积 content 增量并回调全文', () => {
    const { result, onDelta } = feed([
      'data: {"choices":[{"delta":{"content":"你"}}]}',
      'data: {"choices":[{"delta":{"content":"好"}}]}',
    ]);
    expect(result.content).toBe('你好');
    expect(onDelta).toHaveBeenNthCalledWith(1, '你');
    expect(onDelta).toHaveBeenNthCalledWith(2, '你好');
  });

  it('忽略非 data 行、空载荷与 [DONE]', () => {
    const { result, onDelta } = feed([
      ': keep-alive',
      'event: message',
      'data:',
      'data: [DONE]',
    ]);
    expect(result.content).toBe('');
    expect(onDelta).not.toHaveBeenCalled();
  });

  it('跳过无法解析的 SSE 行不中断', () => {
    const { result } = feed([
      'data: {broken json',
      'data: {"choices":[{"delta":{"content":"ok"}}]}',
    ]);
    expect(result.content).toBe('ok');
  });

  it('按 index 拼接分片 tool_calls,并规范化缺失 id', () => {
    const { result } = feed([
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"name":"sea"}}]}}]}',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"name":"rch","arguments":"{\\"q\\":"}}]}}]}',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\\"x\\"}"}}]}}]}',
    ]);
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0].function.name).toBe('search');
    expect(result.toolCalls[0].function.arguments).toBe('{"q":"x"}');
    expect(result.toolCalls[0].id).toMatch(/^tool-call-/);
  });

  it('过滤没有 name 的 tool_call', () => {
    const { result } = feed([
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"abc"}]}}]}',
    ]);
    expect(result.toolCalls).toHaveLength(0);
  });

  it('读取 usage 统计', () => {
    const { result } = feed([
      'data: {"choices":[{"delta":{"content":"x"}}]}',
      'data: {"usage":{"prompt_tokens":10,"completion_tokens":5}}',
    ]);
    expect(result.usage).toEqual({ promptTokens: 10, completionTokens: 5 });
  });
});
