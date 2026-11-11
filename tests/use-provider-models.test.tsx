// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useProviderModels } from '@/hooks/useProviderModels';
import { requestModelList } from '@/services/ai/openai-compatible-provider';

vi.mock('@/services/ai/openai-compatible-provider', () => ({
  requestModelList: vi.fn(),
}));

const requestModelListMock = vi.mocked(requestModelList);

afterEach(() => {
  requestModelListMock.mockReset();
});

describe('useProviderModels', () => {
  it('Key 或地址为空时跳过请求', async () => {
    const { result } = renderHook(() =>
      useProviderModels({ baseUrl: 'https://api.deepseek.com', apiKey: '  ' }),
    );

    await act(async () => {
      await result.current.refresh();
    });

    expect(requestModelListMock).not.toHaveBeenCalled();
    expect(result.current.models).toEqual([]);
    expect(result.current.loading).toBe(false);
  });

  it('刷新后保存模型列表并结束 loading', async () => {
    requestModelListMock.mockResolvedValueOnce(['deepseek-v4-flash']);
    const { result } = renderHook(() =>
      useProviderModels({ baseUrl: 'https://api.deepseek.com', apiKey: 'sk-1' }),
    );

    await act(async () => {
      await result.current.refresh();
    });

    expect(requestModelListMock).toHaveBeenCalledWith(
      { baseUrl: 'https://api.deepseek.com', apiKey: 'sk-1' },
      15_000,
      expect.any(AbortSignal),
    );
    expect(result.current.models).toEqual(['deepseek-v4-flash']);
    expect(result.current.error).toBeUndefined();
    expect(result.current.loading).toBe(false);
  });

  it('失败时清空列表并暴露可读错误', async () => {
    requestModelListMock.mockRejectedValueOnce(
      new Error('API Key 无效或额度不足，请检查设置'),
    );
    const { result } = renderHook(() =>
      useProviderModels({ baseUrl: 'https://api.deepseek.com', apiKey: 'bad' }),
    );

    await act(async () => {
      await result.current.refresh();
    });

    expect(result.current.models).toEqual([]);
    expect(result.current.error).toBe('API Key 无效或额度不足，请检查设置');
    expect(result.current.loading).toBe(false);
  });

  it('切换供应商或修改 Key 后丢弃旧列表', async () => {
    requestModelListMock.mockResolvedValueOnce(['old-model']);
    const { result, rerender } = renderHook(
      (props: { baseUrl: string; apiKey: string }) => useProviderModels(props),
      { initialProps: { baseUrl: 'https://api.deepseek.com', apiKey: 'sk-1' } },
    );

    await act(async () => {
      await result.current.refresh();
    });
    expect(result.current.models).toEqual(['old-model']);

    rerender({ baseUrl: 'https://open.bigmodel.cn/api/paas/v4', apiKey: 'sk-1' });

    expect(result.current.models).toEqual([]);
    expect(result.current.error).toBeUndefined();
  });
});
