import { afterEach, describe, expect, it, vi } from 'vitest';
import type { OpenAIMessage } from '@/services/ai/provider';
import {
  AI_RESPONSE_LIMITS,
  MODEL_LIST_LIMITS,
  requestJsonCompletion,
  requestModelList,
  requestStreamingRound,
} from '@/services/ai/openai-compatible-provider';
import { DEFAULT_SETTINGS } from '@/types/settings';
import { AppError } from '@/utils/errors';

const encoder = new TextEncoder();
const settings = { ...DEFAULT_SETTINGS, apiKey: 'test-key' };
const messages: OpenAIMessage[] = [{ role: 'user', content: 'test' }];

function byteStream(chunks: (string | Uint8Array)[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(typeof chunk === 'string' ? encoder.encode(chunk) : chunk);
      }
      controller.close();
    },
  });
}

function streamResponse(chunks: (string | Uint8Array)[]): Response {
  return new Response(byteStream(chunks), { status: 200 });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('requestJsonCompletion', () => {
  it('读取受限响应体并返回首个 choice 内容', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        streamResponse([
          JSON.stringify({
            choices: [{ message: { content: '{"summary":"ok"}' } }],
          }),
        ]),
      ),
    );

    await expect(requestJsonCompletion(settings, messages)).resolves.toBe(
      '{"summary":"ok"}',
    );
  });

  it('timeout 覆盖已经收到响应头但仍卡住的 body', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        const signal = init?.signal;
        return new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(encoder.encode('{"choices":'));
              signal?.addEventListener('abort', () => controller.error(signal.reason), {
                once: true,
              });
            },
          }),
        );
      }),
    );

    const promise = requestJsonCompletion(settings, messages, 10);
    await expect(promise).rejects.toMatchObject({ code: 'REQUEST_TIMEOUT' });
  });

  it('响应体超过硬限制时拒绝且不解析', async () => {
    const oversized = new Uint8Array(AI_RESPONSE_LIMITS.jsonBodyBytes + 1);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => streamResponse([oversized])),
    );

    await expect(requestJsonCompletion(settings, messages)).rejects.toThrow(
      '响应体超过限制',
    );
  });

  it('原样传播外部 AbortSignal 的 reason', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async (_input: RequestInfo | URL, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            const signal = init?.signal;
            signal?.addEventListener('abort', () => reject(signal.reason), {
              once: true,
            });
          }),
      ),
    );
    const controller = new AbortController();
    const reason = new AppError('REQUEST_CANCELLED', '测试取消');
    const promise = requestJsonCompletion(settings, messages, 1_000, controller.signal);
    controller.abort(reason);

    await expect(promise).rejects.toBe(reason);
  });
});

describe('requestStreamingRound', () => {
  it('处理跨 chunk 行并接受 finish_reason', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        streamResponse([
          'data: {"choices":[{"delta":{"content":"o',
          'k"},"finish_reason":"stop"}]}\n',
        ]),
      ),
    );
    const onDelta = vi.fn();

    const result = await requestStreamingRound(
      settings,
      messages,
      [],
      onDelta,
      new AbortController().signal,
    );

    expect(result.content).toBe('ok');
    expect(onDelta).toHaveBeenCalledWith('ok');
  });

  it('流在没有 [DONE] 或 finish_reason 时结束则失败关闭', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        streamResponse(['data: {"choices":[{"delta":{"content":"partial"}}]}\n']),
      ),
    );

    await expect(
      requestStreamingRound(
        settings,
        messages,
        [],
        vi.fn(),
        new AbortController().signal,
      ),
    ).rejects.toThrow('未正常结束');
  });

  it('未换行缓冲区超过限制时中止', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        streamResponse([`data: ${'x'.repeat(AI_RESPONSE_LIMITS.streamBufferChars + 1)}`]),
      ),
    );

    await expect(
      requestStreamingRound(
        settings,
        messages,
        [],
        vi.fn(),
        new AbortController().signal,
      ),
    ).rejects.toThrow('缓冲区超过限制');
  });

  it('流式响应体超过限制时中止', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response('data: [DONE]\n', {
            headers: {
              'content-length': String(AI_RESPONSE_LIMITS.streamBodyBytes + 1),
            },
          }),
      ),
    );

    await expect(
      requestStreamingRound(
        settings,
        messages,
        [],
        vi.fn(),
        new AbortController().signal,
      ),
    ).rejects.toThrow('响应体超过限制');
  });

  it('没有 Content-Length 时仍按实际流量限制响应体', async () => {
    const oversized = new Uint8Array(AI_RESPONSE_LIMITS.streamBodyBytes + 1);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => streamResponse([oversized])),
    );

    await expect(
      requestStreamingRound(
        settings,
        messages,
        [],
        vi.fn(),
        new AbortController().signal,
      ),
    ).rejects.toThrow('响应体超过限制');
  });

  it('读取流式 body 时取消也原样传播 signal.reason', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        const signal = init?.signal;
        return new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(
                encoder.encode('data: {"choices":[{"delta":{"content":"x"}}]}\n'),
              );
              signal?.addEventListener('abort', () => controller.error(signal.reason), {
                once: true,
              });
            },
          }),
        );
      }),
    );
    const controller = new AbortController();
    const reason = new AppError('REQUEST_CANCELLED', '停止生成');
    const promise = requestStreamingRound(
      settings,
      messages,
      [],
      vi.fn(),
      controller.signal,
    );
    controller.abort(reason);

    await expect(promise).rejects.toBe(reason);
  });
});

describe('requestModelList', () => {
  it('GET /models 并解析、去重、过滤非对话模型', async () => {
    const fetchMock = vi.fn(async () =>
      streamResponse([
        JSON.stringify({
          data: [
            { id: 'deepseek-v4-flash' },
            { id: 'deepseek-v4-pro' },
            { id: 'deepseek-v4-flash' },
            { id: 'deepseek-embedding' },
            { id: '   ' },
            { nope: true },
          ],
        }),
      ]),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(requestModelList(settings)).resolves.toEqual([
      'deepseek-v4-flash',
      'deepseek-v4-pro',
    ]);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://dashscope.aliyuncs.com/compatible-mode/v1/models',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({
          Authorization: 'Bearer test-key',
        }),
      }),
    );
  });

  it('兼容裸数组与 models 字段', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => streamResponse([JSON.stringify(['glm-5.2', 'glm-5'])])),
    );
    await expect(
      requestModelList({ baseUrl: 'https://open.bigmodel.cn/api/paas/v4', apiKey: 'k' }),
    ).resolves.toEqual(['glm-5.2', 'glm-5']);

    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        streamResponse([JSON.stringify({ models: [{ id: 'kimi-k3' }] })]),
      ),
    );
    await expect(
      requestModelList({ baseUrl: 'https://api.moonshot.cn/v1', apiKey: 'k' }),
    ).resolves.toEqual(['kimi-k3']);
  });

  it('超过数量上限时截断', async () => {
    const data = Array.from({ length: MODEL_LIST_LIMITS.models + 10 }, (_, index) => ({
      id: `chat-model-${index}`,
    }));
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => streamResponse([JSON.stringify({ data })])),
    );

    const models = await requestModelList({
      baseUrl: 'https://example.com/v1',
      apiKey: 'k',
    });
    expect(models).toHaveLength(MODEL_LIST_LIMITS.models);
  });

  it('供应商不支持 /models 时返回空列表（回退到预设）', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('', { status: 404 })),
    );
    await expect(
      requestModelList({ baseUrl: 'https://open.bigmodel.cn/api/paas/v4', apiKey: 'k' }),
    ).resolves.toEqual([]);
  });

  it('鉴权失败映射为 AI_UNAUTHORIZED', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('', { status: 401 })),
    );
    await expect(
      requestModelList({ baseUrl: 'https://api.deepseek.com', apiKey: 'bad' }),
    ).rejects.toMatchObject({ code: 'AI_UNAUTHORIZED' });
  });

  it('无效 JSON 与异常结构被拒绝', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => streamResponse(['not-json'])),
    );
    await expect(requestModelList(settings)).rejects.toMatchObject({
      code: 'INVALID_AI_RESPONSE',
    });

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => streamResponse([JSON.stringify({ unexpected: [] })])),
    );
    await expect(requestModelList(settings)).rejects.toMatchObject({
      code: 'INVALID_AI_RESPONSE',
    });
  });
});
