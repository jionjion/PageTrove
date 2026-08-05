// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useChatAutoScroll } from '@/hooks/useChatAutoScroll';

/** 构造带可写滚动指标的容器，scrollTo 同步更新 scrollTop。 */
function makeContainer(options: {
  scrollHeight: number;
  clientHeight: number;
  scrollTop: number;
}) {
  const container = document.createElement('div');
  let scrollTop = options.scrollTop;
  Object.defineProperty(container, 'scrollHeight', {
    configurable: true,
    get: () => options.scrollHeight,
  });
  Object.defineProperty(container, 'clientHeight', {
    configurable: true,
    get: () => options.clientHeight,
  });
  Object.defineProperty(container, 'scrollTop', {
    configurable: true,
    get: () => scrollTop,
    set: (value: number) => {
      scrollTop = value;
    },
  });
  container.scrollTo = vi.fn((arg?: ScrollToOptions | number) => {
    if (typeof arg === 'object' && arg?.top !== undefined) {
      scrollTop = arg.top;
    }
  }) as never;
  return container;
}

function setup(metrics: {
  scrollHeight: number;
  clientHeight: number;
  scrollTop: number;
}) {
  const hook = renderHook(() => useChatAutoScroll());
  const container = makeContainer(metrics);
  // RefObject.current 在类型上是只读的，测试中直接注入容器
  (hook.result.current.containerRef as { current: HTMLDivElement }).current =
    container;
  return { hook, container };
}

beforeEach(() => {
  // rAF 同步执行，保证断言确定性
  vi.stubGlobal(
    'requestAnimationFrame',
    (callback: FrameRequestCallback): number => {
      callback(0);
      return 0;
    },
  );
  vi.stubGlobal('cancelAnimationFrame', () => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useChatAutoScroll（BUG-001 回归）', () => {
  it('读者在底部时 followLatest 滚动到底', () => {
    const { hook, container } = setup({
      scrollHeight: 1000,
      clientHeight: 400,
      scrollTop: 600, // 距底 0
    });
    Object.defineProperty(container, 'scrollHeight', {
      configurable: true,
      get: () => 1200, // 新内容到达
    });

    act(() => hook.result.current.followLatest());
    expect(container.scrollTop).toBe(1200);
    expect(hook.result.current.awayFromBottom).toBe(false);
  });

  it('上滚离底超过阈值后 followLatest 不再劫持位置', () => {
    const { hook, container } = setup({
      scrollHeight: 1000,
      clientHeight: 400,
      scrollTop: 100, // 距底 500 > 64
    });

    act(() => hook.result.current.handleScroll());
    expect(hook.result.current.awayFromBottom).toBe(true);

    act(() => hook.result.current.followLatest());
    expect(container.scrollTop).toBe(100); // 位置不被劫持
    expect(container.scrollTo).not.toHaveBeenCalled();
  });

  it('resumeLatest 回底并恢复跟随，awayFromBottom 复位', () => {
    const { hook, container } = setup({
      scrollHeight: 1000,
      clientHeight: 400,
      scrollTop: 100,
    });
    act(() => hook.result.current.handleScroll());
    expect(hook.result.current.awayFromBottom).toBe(true);

    act(() => hook.result.current.resumeLatest());
    expect(container.scrollTop).toBe(1000);
    expect(hook.result.current.awayFromBottom).toBe(false);

    // 恢复跟随：后续 followLatest 再次生效
    Object.defineProperty(container, 'scrollHeight', {
      configurable: true,
      get: () => 1500,
    });
    act(() => hook.result.current.followLatest());
    expect(container.scrollTop).toBe(1500);
  });

  it('滚回底部附近（阈值内）后自动恢复跟随', () => {
    const { hook, container } = setup({
      scrollHeight: 1000,
      clientHeight: 400,
      scrollTop: 100,
    });
    act(() => hook.result.current.handleScroll()); // 离底
    expect(hook.result.current.awayFromBottom).toBe(true);

    container.scrollTop = 560; // 距底 40 <= 64
    act(() => hook.result.current.handleScroll());
    expect(hook.result.current.awayFromBottom).toBe(false);

    act(() => hook.result.current.followLatest());
    expect(container.scrollTop).toBe(1000);
  });
});
