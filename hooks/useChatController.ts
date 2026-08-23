import { useEffect, useReducer, useRef, useState } from 'react';
import { browser } from 'wxt/browser';
import type { ChatScope, ChatSession, CitationRef } from '@/types/chat';
import type { QuoteChatIntent } from '@/types/chat-intent';
import type { ToolApprovalDecision, ToolApprovalRequest } from '@/types/mcp-tool';
import {
  getChat,
  recordChatToolExecution,
  saveChat,
  type ChatWriteVersion,
} from '@/services/chat-store';
import { getClip } from '@/services/clip-store';
import {
  buildQuotePageContext,
  buildUserMessageContent,
  resolveChatContext,
  scopeTitle,
} from '@/services/chat-context';
import { type ChatContext, type ChatToolActivity } from '@/services/ai/provider';
import { streamChat } from '@/services/ai/chat-orchestrator';
import { extractPage } from '@/services/page-extractor';
import { pickPageElement } from '@/services/element-picker';
import { type CapturedImage, captureSelectedRegion } from '@/services/screenshot-capture';
import { getSettings, saveSettings } from '@/services/settings-store';
import {
  type ExtensionSettings,
  getModelCapabilities,
  PROVIDERS,
} from '@/types/settings';
import { AppError, toErrorMessage } from '@/utils/errors';
import { useChatAutoScroll } from '@/hooks/useChatAutoScroll';
import { toCitationRefs } from '@/services/citations';
import { IDLE_PHASE, sendPhaseReducer } from '@/services/chat-send-phase';

/** 空活动列表常量,避免 idle 态每次渲染新数组导致 effect 依赖抖动。 */
const EMPTY_ACTIVITIES: ChatToolActivity[] = [];

/** App 头部图标下发的指令：开启新会话 / 打开历史会话 / 开启多来源探究会话。 */
export type ChatCommand =
  | { kind: 'new'; clipId?: string; quote?: QuoteChatIntent }
  | { kind: 'new-scope'; scope: ChatScope }
  | { kind: 'open'; sessionId: string };

interface Options {
  command?: ChatCommand;
  /** nonce 变化时执行 command。 */
  nonce: number;
  /** 会话上下文标题变化时通知父组件（显示在 App 头部）。 */
  onTitleChange: (title: string) => void;
}

interface ActiveRun {
  id: string;
  controller: AbortController;
}

type ConflictReloadResult = 'reloaded' | 'missing' | 'superseded' | 'failed';

function cancelled(message = '请求已取消'): DOMException {
  return new DOMException(message, 'AbortError');
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

function isWriteConflict(error: unknown): error is AppError {
  return error instanceof AppError && error.code === 'WRITE_CONFLICT';
}

/** 聊天会话的全部状态与动作;ChatView 只负责组合渲染。 */
export function useChatController({ command, nonce, onTitleChange }: Options) {
  const [session, setSession] = useState<ChatSession>();
  /** 新会话尚未发送第一条消息时的目标收藏 id。 */
  const [draftClipId, setDraftClipId] = useState<string>();
  /** 新会话尚未发送第一条消息时的多来源范围。 */
  const [draftScope, setDraftScope] = useState<ChatScope>();
  /** 右键引用草稿；随第一条消息发送后清除。 */
  const [draftQuote, setDraftQuote] = useState<QuoteChatIntent>();
  /** 多来源部分来源不可用时的提示（如收藏已删除）。 */
  const [scopeNotice, setScopeNotice] = useState<string>();

  const [input, setInput] = useState('');
  const [picked, setPicked] = useState<string>();
  const [attachment, setAttachment] = useState<CapturedImage>();
  const [picking, setPicking] = useState(false);
  const [capturing, setCapturing] = useState(false);
  /** 发送生命周期:idle → preparing → streaming → idle。 */
  const [sendPhase, dispatchSendPhase] = useReducer(sendPhaseReducer, IDLE_PHASE);
  const busy = sendPhase.status !== 'idle';
  const streaming = sendPhase.status === 'streaming' ? sendPhase.text : undefined;
  const streamingRefs = sendPhase.status === 'streaming' ? sendPhase.refs : undefined;
  const toolActivities =
    sendPhase.status === 'idle' ? EMPTY_ACTIVITIES : sendPhase.toolActivities;
  const pendingApproval =
    sendPhase.status === 'idle' ? undefined : sendPhase.pendingApproval;
  const [error, setError] = useState<string>();
  const [copiedIndex, setCopiedIndex] = useState<number>();
  const [ratings, setRatings] = useState<Record<number, 'like' | 'dislike'>>({});
  const activeRunRef = useRef<ActiveRun>();
  const commandIdRef = useRef(crypto.randomUUID());
  const modelChangeIdRef = useRef(crypto.randomUUID());
  const settingsRefreshIdRef = useRef(0);
  const modelSaveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const approvalResolversRef = useRef(
    new Map<
      string,
      {
        runId: string;
        resolve: (decision: ToolApprovalDecision) => void;
        reject: (reason: unknown) => void;
        signal: AbortSignal;
        onAbort: () => void;
      }
    >(),
  );
  const continueWithoutExecutionRunIdRef = useRef<string>();
  const pickControllerRef = useRef<AbortController>();
  const captureControllerRef = useRef<AbortController>();
  const {
    containerRef: messagesRef,
    handleScroll: handleMessagesScroll,
    followLatest,
    resumeLatest,
    awayFromBottom,
  } = useChatAutoScroll();

  const [chatSettings, setChatSettings] = useState<ExtensionSettings>();
  const [modelOptions, setModelOptions] = useState<string[]>([]);

  const applySettings = (settings: ExtensionSettings) => {
    setChatSettings(settings);
    const presetModels =
      PROVIDERS.find((provider) => provider.id === settings.provider)?.models ?? [];
    setModelOptions([...new Set([settings.model, ...presetModels])].filter(Boolean));
  };

  useEffect(() => {
    let disposed = false;
    const refreshSettings = async () => {
      const refreshId = ++settingsRefreshIdRef.current;
      try {
        const settings = await getSettings();
        if (!disposed && settingsRefreshIdRef.current === refreshId) {
          applySettings(settings);
        }
      } catch (caught) {
        if (!disposed && settingsRefreshIdRef.current === refreshId) {
          setError(toErrorMessage(caught));
        }
      }
    };
    void refreshSettings();
    const onStorageChanged = (
      changes: Record<string, Browser.storage.StorageChange>,
      areaName: string,
    ) => {
      if (areaName === 'local' && changes.settings) {
        void refreshSettings();
      }
    };
    browser.storage.onChanged.addListener(onStorageChanged);
    return () => {
      disposed = true;
      browser.storage.onChanged.removeListener(onStorageChanged);
    };
  }, []);

  useEffect(
    () => () => {
      commandIdRef.current = crypto.randomUUID();
      activeRunRef.current?.controller.abort(cancelled('组件已卸载'));
      pickControllerRef.current?.abort(cancelled('组件已卸载'));
      captureControllerRef.current?.abort(cancelled('组件已卸载'));
      activeRunRef.current = undefined;
      pickControllerRef.current = undefined;
      captureControllerRef.current = undefined;
    },
    [],
  );

  // 侧边栏保持键盘焦点时，页面注入脚本的 keydown 监听收不到 Esc；
  // 在侧边栏捕获 Esc，终止进行中的选取/框选并移除页面遮罩。
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      pickControllerRef.current?.abort(cancelled('用户已取消'));
      captureControllerRef.current?.abort(cancelled('用户已取消'));
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  const capabilities = chatSettings
    ? getModelCapabilities(chatSettings)
    : { vision: false, tools: false };

  const handleModelChange = (model: string) => {
    const changeId = crypto.randomUUID();
    // 废弃所有已经在读的 storage refresh，防止旧模型覆盖新选择。
    settingsRefreshIdRef.current += 1;
    modelChangeIdRef.current = changeId;
    setChatSettings((current) => (current ? { ...current, model } : current));
    const save = modelSaveQueueRef.current.then(() => saveSettings({ model }));
    modelSaveQueueRef.current = save.then(
      () => undefined,
      () => undefined,
    );
    void save.catch((caught: unknown) => {
      if (modelChangeIdRef.current !== changeId) return;
      setError(toErrorMessage(caught));
      void getSettings()
        .then((settings) => {
          if (modelChangeIdRef.current === changeId) applySettings(settings);
        })
        .catch(() => undefined);
    });
  };

  useEffect(() => {
    followLatest();
  }, [session?.messages.length, streaming, toolActivities, followLatest]);

  useEffect(() => {
    resumeLatest('auto');
  }, [session?.id, resumeLatest]);

  const beginRun = (): ActiveRun => {
    activeRunRef.current?.controller.abort(cancelled('请求已被新操作替代'));
    const run = {
      id: crypto.randomUUID(),
      controller: new AbortController(),
    };
    activeRunRef.current = run;
    dispatchSendPhase({ type: 'start', runId: run.id });
    return run;
  };

  const assertCurrentRun = (run: ActiveRun) => {
    if (activeRunRef.current?.id !== run.id) {
      throw cancelled('请求已被新操作替代');
    }
    run.controller.signal.throwIfAborted();
  };

  const finishRun = (run: ActiveRun) => {
    if (activeRunRef.current?.id !== run.id) return;
    activeRunRef.current = undefined;
    dispatchSendPhase({ type: 'finish', runId: run.id });
  };

  const reloadConflictedSession = async (
    id: string | undefined,
    run: ActiveRun,
  ): Promise<ConflictReloadResult> => {
    if (!id) return 'missing';
    let latest: ChatSession | undefined;
    try {
      latest = await getChat(id);
    } catch {
      return activeRunRef.current?.id === run.id ? 'failed' : 'superseded';
    }
    if (activeRunRef.current?.id !== run.id) return 'superseded';
    if (!latest) return 'missing';
    setSession(latest);
    setRatings({});
    return 'reloaded';
  };

  const clearDeletedSession = () => {
    setSession(undefined);
    setDraftClipId(undefined);
    setDraftScope(undefined);
    setDraftQuote(undefined);
    setScopeNotice(undefined);
    setRatings({});
  };

  const updateToolActivity = (runId: string, activity: ChatToolActivity) => {
    dispatchSendPhase({ type: 'tool-activity', runId, activity });
  };

  const requestToolApproval = (
    runId: string,
    request: ToolApprovalRequest,
    signal: AbortSignal,
  ): Promise<ToolApprovalDecision> => {
    if (signal.aborted) {
      return Promise.reject(
        signal.reason ?? new DOMException('请求已取消', 'AbortError'),
      );
    }
    if (continueWithoutExecutionRunIdRef.current === runId) {
      return Promise.resolve({ kind: 'continue-without-execution' });
    }
    return new Promise((resolve, reject) => {
      const onAbort = () => {
        approvalResolversRef.current.delete(request.requestId);
        dispatchSendPhase({
          type: 'approval-cleared',
          runId,
          requestId: request.requestId,
        });
        reject(signal.reason ?? new DOMException('请求已取消', 'AbortError'));
      };
      approvalResolversRef.current.set(request.requestId, {
        runId,
        resolve,
        reject,
        signal,
        onAbort,
      });
      signal.addEventListener('abort', onAbort, { once: true });
      dispatchSendPhase({ type: 'approval-requested', runId, request });
    });
  };

  const settleToolApproval = (requestId: string, decision: ToolApprovalDecision) => {
    const pending = approvalResolversRef.current.get(requestId);
    if (!pending) return;
    approvalResolversRef.current.delete(requestId);
    pending.signal.removeEventListener('abort', pending.onAbort);
    dispatchSendPhase({
      type: 'approval-cleared',
      runId: pending.runId,
      requestId,
    });
    pending.resolve(decision);
  };

  const resetState = () => {
    const commandId = crypto.randomUUID();
    commandIdRef.current = commandId;
    activeRunRef.current?.controller.abort(cancelled('会话已切换'));
    activeRunRef.current = undefined;
    pickControllerRef.current?.abort(cancelled('会话已切换'));
    captureControllerRef.current?.abort(cancelled('会话已切换'));
    pickControllerRef.current = undefined;
    captureControllerRef.current = undefined;
    continueWithoutExecutionRunIdRef.current = undefined;
    setSession(undefined);
    setDraftClipId(undefined);
    setDraftScope(undefined);
    setDraftQuote(undefined);
    setScopeNotice(undefined);
    setError(undefined);
    dispatchSendPhase({ type: 'reset' });
    setInput('');
    setPicked(undefined);
    setAttachment(undefined);
    setPicking(false);
    setCapturing(false);
    setRatings({});
    setCopiedIndex(undefined);
    return commandId;
  };

  const startNewSession = async (clipId?: string, quote?: QuoteChatIntent) => {
    const commandId = resetState();
    setDraftClipId(clipId);
    setDraftQuote(quote);
    if (clipId) {
      try {
        const clip = await getClip(clipId);
        if (commandIdRef.current !== commandId) return;
        onTitleChange(clip?.title ?? '关联收藏');
      } catch (caught) {
        if (commandIdRef.current !== commandId) return;
        setError(toErrorMessage(caught));
        onTitleChange('关联收藏');
      }
    } else if (quote) {
      onTitleChange(quote.title || '当前网页');
    } else {
      onTitleChange('当前网页');
    }
  };

  const startScopeSession = (scope: ChatScope) => {
    resetState();
    setDraftScope(scope);
    onTitleChange(scopeTitle(scope));
  };

  const openSession = async (id: string) => {
    const commandId = resetState();
    try {
      const loaded = await getChat(id);
      if (!loaded || commandIdRef.current !== commandId) return;
      setSession(loaded);
      if (loaded.scope) {
        onTitleChange(scopeTitle(loaded.scope));
      } else if (loaded.page) {
        onTitleChange(loaded.page.title);
      } else if (loaded.clipId) {
        const clip = await getClip(loaded.clipId);
        if (commandIdRef.current !== commandId) return;
        onTitleChange(clip?.title ?? '关联收藏（已删除）');
      }
    } catch (caught) {
      if (commandIdRef.current === commandId) setError(toErrorMessage(caught));
    }
  };

  /**
   * 处理右键引用意图：当前正处于同一网页的普通会话（含未发送的草稿会话）时，
   * 直接把引用附加到当前对话；否则才新开会话。
   */
  const applyQuoteIntent = (quote: QuoteChatIntent) => {
    const samePage = session
      ? !session.clipId && !session.scope && session.page?.url === quote.url
      : !draftClipId && !draftScope;
    if (samePage) {
      setDraftQuote(quote);
      if (!session) onTitleChange(quote.title || '当前网页');
      return;
    }
    void startNewSession(undefined, quote);
  };

  useEffect(() => {
    if (nonce > 0 && command) {
      // 微任务中处理指令，避免在 effect 体内同步 setState 触发级联渲染
      queueMicrotask(() => {
        if (command.kind === 'new') {
          if (command.quote) {
            applyQuoteIntent(command.quote);
          } else {
            void startNewSession(command.clipId);
          }
        } else if (command.kind === 'new-scope') {
          startScopeSession(command.scope);
        } else {
          void openSession(command.sessionId);
        }
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nonce]);

  /**
   * 发送与重新生成的公共尾部:解析上下文 → 流式请求 → 保存 assistant 消息。
   * 所有异步边界都验证 runId；保存使用 revision 做乐观并发检查。
   */
  const runAssistantTurn = async (
    base: ChatSession,
    question: string,
    turnId: string,
    settings: ExtensionSettings,
    run: ActiveRun,
    expectedPersisted: ChatWriteVersion,
    imageDataUrl?: string,
  ) => {
    const resolved = await resolveChatContext(base, question);
    assertCurrentRun(run);
    if (base.scope) setScopeNotice(resolved.notice);
    const context = resolved.context;
    const refs = toCitationRefs(context);
    let persistedVersion = expectedPersisted;
    let persistedToolExecutions = base.toolExecutions;
    dispatchSendPhase({ type: 'stream-start', runId: run.id, refs });

    const reply = await streamChat(
      context,
      base.messages.map(({ role, content }) => ({ role, content })),
      settings,
      (text) => dispatchSendPhase({ type: 'chunk', runId: run.id, text }),
      run.controller.signal,
      {
        imageDataUrl,
        toolTurnId: turnId,
        onToolActivity: (activity) => updateToolActivity(run.id, activity),
        onToolExecution: async (execution) => {
          const isClaim = execution.status === 'unknown' && execution.phase === 'claimed';
          const record = await recordChatToolExecution(
            base.id,
            execution,
            isClaim ? persistedVersion : undefined,
          );
          const updated = record.session;
          if (isClaim) {
            persistedVersion = {
              updatedAt: updated.updatedAt,
              revision: updated.revision,
            };
          }
          persistedToolExecutions = updated.toolExecutions;
          if (activeRunRef.current?.id === run.id) {
            // regenerate 时 UI 使用未落盘的截断消息；只同步审计与 CAS 令牌。
            setSession((current) =>
              current?.id === base.id
                ? {
                    ...current,
                    toolExecutions: updated.toolExecutions,
                    revision: updated.revision,
                    updatedAt: updated.updatedAt,
                  }
                : current,
            );
          }
          return { kind: record.kind, execution: record.execution };
        },
        requestToolApproval: (request, signal) =>
          requestToolApproval(run.id, request, signal),
      },
    );
    assertCurrentRun(run);

    const done: ChatSession = {
      ...base,
      revision: crypto.randomUUID(),
      toolExecutions: persistedToolExecutions,
      messages: [
        ...base.messages,
        {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: reply.content,
          createdAt: new Date().toISOString(),
          usage: reply.usage,
          elapsedMs: reply.elapsedMs,
          toolCalls: reply.toolCalls,
          citationRefs: refs,
        },
      ],
      updatedAt: new Date().toISOString(),
    };
    // 提交开始后不再用 AbortSignal 中止 IDB，避免“已经提交却按取消回滚 UI”的不确定态。
    await saveChat(done, persistedVersion);
    if (activeRunRef.current?.id === run.id) setSession(done);
  };

  const handleSend = async () => {
    const question = input.trim();
    if (!question || busy) return;
    resumeLatest('auto');

    const run = beginRun();
    const image = attachment;
    const quote = draftQuote;
    const pickedText = picked;
    const content = buildUserMessageContent({
      question,
      hasImage: Boolean(image),
      picked: pickedText,
      quoteText: quote?.text,
    });
    let userSaved = false;
    let savedSessionId = session?.id;

    setError(undefined);
    setInput('');
    setPicked(undefined);
    setAttachment(undefined);

    try {
      const settings = await getSettings();
      assertCurrentRun(run);
      if (image && !getModelCapabilities(settings).vision) {
        throw new AppError(
          'AI_ANALYZE_FAILED',
          '当前模型未启用图片输入，请在设置中开启后重试',
        );
      }
      const now = new Date().toISOString();

      let current = session;
      if (!current) {
        let page: ChatContext | undefined;
        if (!draftClipId && !draftScope) {
          if (quote) {
            const quoteResult = await buildQuotePageContext(quote, settings);
            assertCurrentRun(run);
            if (quoteResult.notice) setScopeNotice(quoteResult.notice);
            page = quoteResult.context;
            onTitleChange(page.title);
          } else {
            const snapshot = await extractPage({
              maxContentLength: settings.maxContentLength,
              includeSelectedText: settings.includeSelectedText,
            });
            assertCurrentRun(run);
            page = {
              title: snapshot.title,
              url: snapshot.url,
              content: [snapshot.description, snapshot.selectedText, snapshot.mainText]
                .filter(Boolean)
                .join('\n'),
            };
            onTitleChange(snapshot.title);
          }
        }
        current = {
          id: crypto.randomUUID(),
          clipId: draftClipId,
          page,
          scope: draftScope,
          title: question.slice(0, 30),
          messages: [],
          createdAt: now,
          updatedAt: now,
        };
      }
      const withUser: ChatSession = {
        ...current,
        revision: crypto.randomUUID(),
        messages: [
          ...current.messages,
          { id: crypto.randomUUID(), role: 'user', content, createdAt: now },
        ],
        updatedAt: now,
      };
      savedSessionId = withUser.id;
      const expected = session
        ? { updatedAt: session.updatedAt, revision: session.revision }
        : null;
      // IDB 提交是明确边界；开始提交前已校验 run，提交后以 runId 决定是否更新当前 UI。
      await saveChat(withUser, expected);
      userSaved = true;
      if (activeRunRef.current?.id === run.id) {
        setSession(withUser);
        setDraftQuote(undefined);
      }
      assertCurrentRun(run);

      await runAssistantTurn(
        withUser,
        question,
        withUser.messages.at(-1)!.id!,
        settings,
        run,
        { updatedAt: withUser.updatedAt, revision: withUser.revision },
        image?.dataUrl,
      );
    } catch (caught) {
      if (activeRunRef.current?.id === run.id) {
        if (isWriteConflict(caught)) {
          const reloadResult = await reloadConflictedSession(savedSessionId, run);
          if (reloadResult === 'superseded' || activeRunRef.current?.id !== run.id) {
            return;
          }
          if (reloadResult === 'missing') {
            clearDeletedSession();
            setInput(question);
            setPicked(pickedText);
            setAttachment(image);
            setError('当前会话已被删除；问题已保留，请重新发送以创建新会话');
            return;
          }
          if (reloadResult === 'failed' && session) setSession(session);
        }
        if (activeRunRef.current?.id !== run.id) return;
        if (!userSaved) {
          setInput(question);
          setPicked(pickedText);
          setAttachment(image);
        }
        if (!isAbortError(caught)) setError(toErrorMessage(caught));
      }
    } finally {
      finishRun(run);
    }
  };

  const handleStop = () =>
    activeRunRef.current?.controller.abort(cancelled('用户已停止请求'));

  const handleCopy = async (content: string, index: number) => {
    try {
      await navigator.clipboard.writeText(content);
      setCopiedIndex(index);
      setTimeout(
        () => setCopiedIndex((value) => (value === index ? undefined : value)),
        1_500,
      );
    } catch {
      setError('复制失败');
    }
  };

  const handleRate = (index: number, value: 'like' | 'dislike') => {
    setRatings((current) => {
      const next = { ...current };
      if (next[index] === value) delete next[index];
      else next[index] = value;
      return next;
    });
  };

  const handleRegenerate = async (index: number) => {
    if (!session || busy) return;
    resumeLatest('auto');
    const original = session;
    const originalRatings = ratings;
    const previousMessages = session.messages.slice(0, index);
    const lastUser = [...previousMessages]
      .reverse()
      .find((message) => message.role === 'user');
    if (!lastUser) {
      setError('没有可重新生成的用户消息');
      return;
    }
    if (lastUser?.content.includes('[截图]')) {
      setError('这条问题包含未保存的截图，请重新截图后再发送');
      return;
    }

    const run = beginRun();
    setError(undefined);
    const truncated: ChatSession = {
      ...session,
      messages: previousMessages,
      // 消息分支可被截断，外部副作用审计必须 append-only 保留。
      toolExecutions: session.toolExecutions,
      updatedAt: new Date().toISOString(),
    };

    try {
      const settings = await getSettings();
      assertCurrentRun(run);
      setSession(truncated);
      setRatings(
        Object.fromEntries(
          Object.entries(originalRatings).filter(([key]) => Number(key) < index),
        ),
      );
      const lastUserIndex = previousMessages.lastIndexOf(lastUser);
      await runAssistantTurn(
        truncated,
        lastUser.content,
        lastUser.id ??
          `legacy_${lastUser.createdAt.replace(/[^a-zA-Z0-9]/g, '_')}_${lastUserIndex}`,
        settings,
        run,
        {
          updatedAt: original.updatedAt,
          revision: original.revision,
        },
      );
    } catch (caught) {
      if (activeRunRef.current?.id === run.id) {
        if (isWriteConflict(caught)) {
          const reloadResult = await reloadConflictedSession(original.id, run);
          if (reloadResult === 'superseded' || activeRunRef.current?.id !== run.id) {
            return;
          }
          if (reloadResult === 'missing') {
            clearDeletedSession();
            setError('当前会话已被删除，请新建会话后重新提问');
            return;
          }
          if (reloadResult === 'failed') {
            setSession(original);
            setRatings(originalRatings);
          }
        } else {
          let latest: ChatSession | undefined;
          try {
            latest = await getChat(original.id);
          } catch {
            // 审计日志读取失败时回退到运行前 UI，原错误仍会展示。
          }
          if (activeRunRef.current?.id !== run.id) return;
          setSession(latest ?? original);
          setRatings(originalRatings);
        }
        if (activeRunRef.current?.id !== run.id) return;
        if (!isAbortError(caught)) setError(toErrorMessage(caught));
      }
    } finally {
      finishRun(run);
    }
  };

  /**
   * 工具已写入审计但未产生 assistant 回答时，沿用原 user turn 继续。
   * 这会命中 operationKey，已成功或结果未知的相同副作用不会再执行。
   */
  const handleRetryInterruptedTurn = async (turnId: string) => {
    if (!session || busy) return;
    const original = session;
    const messageIndex = original.messages.findIndex(
      (message) => message.role === 'user' && message.id === turnId,
    );
    const message = original.messages[messageIndex];
    if (
      !message ||
      message.role !== 'user' ||
      messageIndex !== original.messages.length - 1
    ) {
      setError('只能继续当前会话最后一个未完成的问题');
      return;
    }
    resumeLatest('auto');
    const run = beginRun();
    continueWithoutExecutionRunIdRef.current = run.id;
    setError(undefined);
    try {
      const settings = await getSettings();
      assertCurrentRun(run);
      await runAssistantTurn(original, message.content, turnId, settings, run, {
        updatedAt: original.updatedAt,
        revision: original.revision,
      });
    } catch (caught) {
      if (activeRunRef.current?.id !== run.id) return;
      if (isWriteConflict(caught)) {
        const reloadResult = await reloadConflictedSession(original.id, run);
        if (reloadResult === 'superseded' || activeRunRef.current?.id !== run.id) {
          return;
        }
        if (reloadResult === 'missing') {
          clearDeletedSession();
          setInput(message.content);
          setError('当前会话已被删除；问题已保留，请重新发送以创建新会话');
          return;
        }
      } else {
        try {
          const latest = await getChat(original.id);
          if (activeRunRef.current?.id !== run.id) return;
          if (latest) setSession(latest);
        } catch {
          // 保留当前 UI 中已同步的审计，不用旧 session 覆盖。
        }
      }
      if (activeRunRef.current?.id === run.id && !isAbortError(caught)) {
        setError(toErrorMessage(caught));
      }
    } finally {
      if (continueWithoutExecutionRunIdRef.current === run.id) {
        continueWithoutExecutionRunIdRef.current = undefined;
      }
      finishRun(run);
    }
  };

  const handlePick = async () => {
    if (picking || capturing || busy) return;
    const commandId = commandIdRef.current;
    const controller = new AbortController();
    pickControllerRef.current = controller;
    setError(undefined);
    setPicking(true);
    try {
      const result = await pickPageElement(3_000, capabilities.vision, controller.signal);
      if (!result || commandIdRef.current !== commandId) return;
      if (result.text) setPicked(result.text);
      if (result.image) setAttachment(result.image);
      if (!result.text && result.hasVisual && !capabilities.vision) {
        setError('选中内容只有图片，请先在设置中为当前模型启用图片输入');
      }
    } catch (caught) {
      if (commandIdRef.current === commandId) setError(toErrorMessage(caught));
    } finally {
      if (pickControllerRef.current === controller) {
        pickControllerRef.current = undefined;
      }
      if (commandIdRef.current === commandId) setPicking(false);
    }
  };

  const handleCapture = async () => {
    if (capturing || picking || busy) return;
    const commandId = commandIdRef.current;
    if (!capabilities.vision) {
      setError('当前模型未启用图片输入，请先前往设置开启');
      return;
    }
    const controller = new AbortController();
    captureControllerRef.current = controller;
    setError(undefined);
    setCapturing(true);
    try {
      const image = await captureSelectedRegion(controller.signal);
      if (image && commandIdRef.current === commandId) setAttachment(image);
    } catch (caught) {
      if (commandIdRef.current === commandId) setError(toErrorMessage(caught));
    } finally {
      if (captureControllerRef.current === controller) {
        captureControllerRef.current = undefined;
      }
      if (commandIdRef.current === commandId) setCapturing(false);
    }
  };

  const activeScope = session?.scope ?? draftScope;

  /**
   * legacy 兼容:旧 assistant 消息没有 citationRefs 时,
   * 按当前 scope 下标现场构建映射(维持旧行为),不写回存储。
   */
  const legacyRefs: CitationRef[] | undefined = activeScope?.sources.length
    ? activeScope.sources.map((source, index) => ({
        citation: `S${index + 1}`,
        sourceId: source.id,
        title: source.title,
        url: source.url,
      }))
    : undefined;

  return {
    // 渲染数据
    session,
    activeScope,
    legacyRefs,
    scopeNotice,
    error,
    input,
    picked,
    attachment,
    draftQuote,
    picking,
    capturing,
    busy,
    streaming,
    streamingRefs,
    toolActivities,
    pendingApproval,
    chatSettings,
    modelOptions,
    capabilities,
    copiedIndex,
    ratings,
    // 自动滚动
    messagesRef,
    handleMessagesScroll,
    awayFromBottom,
    resumeLatest,
    // 动作
    setInput,
    setError,
    setScopeNotice,
    setPicked,
    setAttachment,
    setDraftQuote,
    handleSend,
    handleStop,
    handleRegenerate,
    handleRetryInterruptedTurn,
    handlePick,
    handleCapture,
    handleCopy,
    handleRate,
    handleModelChange,
    settleToolApproval,
  } as const;
}
