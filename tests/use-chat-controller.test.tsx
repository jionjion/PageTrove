// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useChatController, type ChatCommand } from '@/hooks/useChatController';
import type { ChatSession } from '@/types/chat';
import { DEFAULT_SETTINGS } from '@/types/settings';
import { AppError } from '@/utils/errors';

const mocks = vi.hoisted(() => ({
  getChat: vi.fn(),
  saveChat: vi.fn(),
  recordChatToolExecution: vi.fn(),
  getClip: vi.fn(),
  getSettings: vi.fn(),
  saveSettings: vi.fn(),
  pickPageElement: vi.fn(),
  captureSelectedRegion: vi.fn(),
  extractPage: vi.fn(),
  streamChat: vi.fn(),
  storageAddListener: vi.fn(),
  storageRemoveListener: vi.fn(),
  followLatest: vi.fn(),
  resumeLatest: vi.fn(),
}));

vi.mock('wxt/browser', () => ({
  browser: {
    storage: {
      onChanged: {
        addListener: mocks.storageAddListener,
        removeListener: mocks.storageRemoveListener,
      },
    },
  },
}));

vi.mock('@/services/chat-store', () => ({
  getChat: mocks.getChat,
  saveChat: mocks.saveChat,
  recordChatToolExecution: mocks.recordChatToolExecution,
}));
vi.mock('@/services/clip-store', () => ({ getClip: mocks.getClip }));
vi.mock('@/services/settings-store', () => ({
  getSettings: mocks.getSettings,
  saveSettings: mocks.saveSettings,
}));
vi.mock('@/services/element-picker', () => ({
  pickPageElement: mocks.pickPageElement,
}));
vi.mock('@/services/screenshot-capture', () => ({
  captureSelectedRegion: mocks.captureSelectedRegion,
}));
vi.mock('@/services/page-extractor', () => ({ extractPage: mocks.extractPage }));
vi.mock('@/services/ai/chat-orchestrator', () => ({ streamChat: mocks.streamChat }));
vi.mock('@/hooks/useChatAutoScroll', () => ({
  useChatAutoScroll: () => ({
    containerRef: { current: null },
    handleScroll: vi.fn(),
    followLatest: mocks.followLatest,
    resumeLatest: mocks.resumeLatest,
    awayFromBottom: false,
  }),
}));

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function renderController(command?: ChatCommand, nonce = 0) {
  const onTitleChange = vi.fn();
  return renderHook(
    ({ nextCommand, nextNonce }) =>
      useChatController({
        command: nextCommand,
        nonce: nextNonce,
        onTitleChange,
      }),
    { initialProps: { nextCommand: command, nextNonce: nonce } },
  );
}

const session: ChatSession = {
  id: 'chat-1',
  revision: 'revision-1',
  page: { title: '测试页', url: 'https://example.com', content: '正文' },
  title: '旧会话',
  messages: [{ role: 'user', content: '旧问题', createdAt: '2026-08-12T00:00:00Z' }],
  createdAt: '2026-08-12T00:00:00Z',
  updatedAt: '2026-08-12T00:00:00Z',
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getSettings.mockResolvedValue(DEFAULT_SETTINGS);
  mocks.saveSettings.mockResolvedValue(DEFAULT_SETTINGS);
  mocks.recordChatToolExecution.mockImplementation(async (_id, execution) => ({
    kind: 'recorded',
    execution,
    session: {
      ...session,
      revision: 'journal-revision',
      updatedAt: '2026-08-12T00:01:00Z',
      toolExecutions: [],
    },
  }));
});

describe('useChatController command ownership', () => {
  it('选取进行中切换会话会立即释放 loading，旧结果不回写', async () => {
    const pendingPick = deferred<undefined>();
    mocks.pickPageElement.mockReturnValue(pendingPick.promise);
    const hook = renderController();
    await waitFor(() => expect(mocks.getSettings).toHaveBeenCalled());

    let pickTask!: Promise<void>;
    act(() => {
      pickTask = hook.result.current.handlePick();
    });
    await waitFor(() => expect(hook.result.current.picking).toBe(true));

    await act(async () => {
      hook.rerender({ nextCommand: { kind: 'new' }, nextNonce: 1 });
      await Promise.resolve();
    });
    expect(hook.result.current.picking).toBe(false);

    pendingPick.resolve(undefined);
    await act(async () => pickTask);
    expect(hook.result.current.picking).toBe(false);
  });

  it('截图进行中切换会话会立即释放 loading', async () => {
    const pendingCapture = deferred<undefined>();
    mocks.captureSelectedRegion.mockReturnValue(pendingCapture.promise);
    const hook = renderController();
    await waitFor(() => expect(hook.result.current.capabilities.vision).toBe(true));

    let captureTask!: Promise<void>;
    act(() => {
      captureTask = hook.result.current.handleCapture();
    });
    await waitFor(() => expect(hook.result.current.capturing).toBe(true));

    await act(async () => {
      hook.rerender({ nextCommand: { kind: 'new' }, nextNonce: 1 });
      await Promise.resolve();
    });
    expect(hook.result.current.capturing).toBe(false);

    pendingCapture.resolve(undefined);
    await act(async () => captureTask);
    expect(hook.result.current.capturing).toBe(false);
  });

  it('框选进行中按 Esc 会立即释放 loading', async () => {
    mocks.captureSelectedRegion.mockImplementation(
      (_signal: AbortSignal) =>
        new Promise<undefined>((_resolve, reject) => {
          queueMicrotask(() =>
            _signal.addEventListener('abort', () => reject(_signal.reason), {
              once: true,
            }),
          );
        }),
    );
    const hook = renderController();
    await waitFor(() => expect(hook.result.current.capabilities.vision).toBe(true));

    let captureTask!: Promise<void>;
    act(() => {
      captureTask = hook.result.current.handleCapture();
    });
    await waitFor(() => expect(hook.result.current.capturing).toBe(true));

    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    await act(async () => captureTask);
    expect(hook.result.current.capturing).toBe(false);
  });

  it('冲突重载等待期间切换会话时，不恢复旧 session 或错误', async () => {
    const pendingReload = deferred<ChatSession | undefined>();
    mocks.getChat
      .mockResolvedValueOnce(session)
      .mockReturnValueOnce(pendingReload.promise);
    mocks.saveChat.mockRejectedValueOnce(new AppError('WRITE_CONFLICT'));
    const hook = renderController({ kind: 'open', sessionId: session.id }, 1);
    await waitFor(() => expect(hook.result.current.session?.id).toBe(session.id));

    act(() => hook.result.current.setInput('新问题'));
    let sendTask!: Promise<void>;
    act(() => {
      sendTask = hook.result.current.handleSend();
    });
    await waitFor(() => expect(mocks.getChat).toHaveBeenCalledTimes(2));

    await act(async () => {
      hook.rerender({ nextCommand: { kind: 'new' }, nextNonce: 2 });
      await Promise.resolve();
    });
    pendingReload.resolve({ ...session, title: '冲突后的旧会话' });
    await act(async () => sendTask);

    expect(hook.result.current.session).toBeUndefined();
    expect(hook.result.current.error).toBeUndefined();
    expect(hook.result.current.input).toBe('');
  });

  it('当前会话已被删除时清除僵尸会话，并保留待重发的问题', async () => {
    mocks.getChat.mockResolvedValueOnce(session).mockResolvedValueOnce(undefined);
    mocks.saveChat.mockRejectedValueOnce(new AppError('WRITE_CONFLICT'));
    const hook = renderController({ kind: 'open', sessionId: session.id }, 1);
    await waitFor(() => expect(hook.result.current.session?.id).toBe(session.id));

    act(() => hook.result.current.setInput('删除后仍需回答的问题'));
    await act(async () => hook.result.current.handleSend());

    expect(hook.result.current.session).toBeUndefined();
    expect(hook.result.current.input).toBe('删除后仍需回答的问题');
    expect(hook.result.current.error).toContain('当前会话已被删除');
    expect(mocks.streamChat).not.toHaveBeenCalled();
  });

  it('模型后续轮次失败时保留审计，可沿用原 turn 安全继续', async () => {
    let execution!: {
      id: string;
      serverName: string;
      toolName: string;
      status: 'success';
      summary: string;
      turnId: string;
    };
    mocks.getChat.mockResolvedValueOnce(session);
    mocks.saveChat.mockResolvedValue(undefined);
    mocks.recordChatToolExecution.mockImplementation(async (_id, value) => ({
      kind: 'recorded',
      execution: value,
      session: {
        ...session,
        revision: 'journal-revision',
        updatedAt: '2026-08-12T00:01:00Z',
        toolExecutions: [value],
      },
    }));
    mocks.streamChat.mockImplementationOnce(async (...args: unknown[]) => {
      const options = args[5] as {
        toolTurnId: string;
        onToolExecution: (value: typeof execution) => Promise<void>;
      };
      const claim = {
        id: 'execution-1',
        serverName: '测试 MCP',
        toolName: 'create_item',
        status: 'unknown' as const,
        phase: 'claimed' as const,
        claimedAt: new Date().toISOString(),
        operationKey: `sha256-v1:${'a'.repeat(64)}`,
        turnId: options.toolTurnId,
      };
      await options.onToolExecution(claim as never);
      execution = {
        ...claim,
        status: 'success',
        summary: '调用成功',
      };
      await options.onToolExecution(execution);
      throw new Error('后续模型轮次失败');
    });
    const hook = renderController({ kind: 'open', sessionId: session.id }, 1);
    await waitFor(() => expect(hook.result.current.session?.id).toBe(session.id));

    act(() => hook.result.current.setInput('请执行'));
    await act(async () => hook.result.current.handleSend());

    expect(mocks.recordChatToolExecution).toHaveBeenNthCalledWith(
      1,
      session.id,
      expect.objectContaining({ status: 'unknown', phase: 'claimed' }),
      expect.objectContaining({ revision: expect.any(String) }),
    );
    expect(mocks.recordChatToolExecution).toHaveBeenNthCalledWith(
      2,
      session.id,
      execution,
      undefined,
    );
    expect(hook.result.current.session?.toolExecutions).toEqual([execution]);
    expect(hook.result.current.error).toBe('后续模型轮次失败');

    const interruptedTurnId = hook.result.current.session?.messages.at(-1)?.id;
    expect(interruptedTurnId).toBe(execution.turnId);
    mocks.streamChat.mockResolvedValueOnce({
      content: '继续后的回答',
      elapsedMs: 1,
      toolCalls: [execution],
    });
    await act(async () =>
      hook.result.current.handleRetryInterruptedTurn(interruptedTurnId!),
    );

    expect(mocks.streamChat).toHaveBeenCalledTimes(2);
    expect(mocks.streamChat.mock.calls[1][5]).toMatchObject({
      toolTurnId: interruptedTurnId,
    });
    expect(hook.result.current.session?.messages.at(-1)).toMatchObject({
      role: 'assistant',
      content: '继续后的回答',
    });
  });
});
