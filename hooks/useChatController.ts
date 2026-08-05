import { useEffect, useReducer, useRef, useState } from 'react';
import { browser } from 'wxt/browser';
import type { ChatScope, ChatSession, CitationRef } from '@/types/chat';
import type { QuoteChatIntent } from '@/types/chat-intent';
import { getChat, saveChat } from '@/services/chat-store';
import { getClip } from '@/services/clip-store';
import {
  buildQuotePageContext,
  buildUserMessageContent,
  resolveChatContext,
  scopeTitle,
} from '@/services/chat-context';
import {
  type ChatContext,
  type ChatToolActivity,
} from '@/services/ai/provider';
import { streamChat } from '@/services/ai/chat-orchestrator';
import { extractPage } from '@/services/page-extractor';
import { pickPageElement } from '@/services/element-picker';
import {
  type CapturedImage,
  captureSelectedRegion,
} from '@/services/screenshot-capture';
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
  const streaming =
    sendPhase.status === 'streaming' ? sendPhase.text : undefined;
  const streamingRefs =
    sendPhase.status === 'streaming' ? sendPhase.refs : undefined;
  const toolActivities =
    sendPhase.status === 'idle' ? EMPTY_ACTIVITIES : sendPhase.toolActivities;
  const [error, setError] = useState<string>();
  const [copiedIndex, setCopiedIndex] = useState<number>();
  const [ratings, setRatings] = useState<Record<number, 'like' | 'dislike'>>({});
  const abortRef = useRef<AbortController>();
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
    setModelOptions(
      [...new Set([settings.model, ...presetModels])].filter(Boolean),
    );
  };

  useEffect(() => {
    void getSettings().then(applySettings);
    const onStorageChanged = (
      changes: Record<string, Browser.storage.StorageChange>,
      areaName: string,
    ) => {
      if (areaName === 'local' && changes.settings) {
        void getSettings().then(applySettings);
      }
    };
    browser.storage.onChanged.addListener(onStorageChanged);
    return () => browser.storage.onChanged.removeListener(onStorageChanged);
  }, []);

  const capabilities = chatSettings
    ? getModelCapabilities(chatSettings)
    : { vision: false, tools: false };

  const handleModelChange = (model: string) => {
    setChatSettings((current) => (current ? { ...current, model } : current));
    void saveSettings({ model });
  };

  useEffect(() => {
    followLatest();
  }, [session?.messages.length, streaming, toolActivities, followLatest]);

  useEffect(() => {
    resumeLatest('auto');
  }, [session?.id, resumeLatest]);

  const updateToolActivity = (activity: ChatToolActivity) => {
    dispatchSendPhase({ type: 'tool-activity', activity });
  };

  const resetState = () => {
    abortRef.current?.abort();
    setSession(undefined);
    setDraftClipId(undefined);
    setDraftScope(undefined);
    setDraftQuote(undefined);
    setScopeNotice(undefined);
    setError(undefined);
    dispatchSendPhase({ type: 'finish' });
    setInput('');
    setPicked(undefined);
    setAttachment(undefined);
    setRatings({});
    setCopiedIndex(undefined);
  };

  const startNewSession = async (clipId?: string, quote?: QuoteChatIntent) => {
    resetState();
    setDraftClipId(clipId);
    setDraftQuote(quote);
    if (clipId) {
      const clip = await getClip(clipId);
      onTitleChange(clip?.title ?? '关联收藏');
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
    const loaded = await getChat(id);
    if (!loaded) return;
    resetState();
    setSession(loaded);
    if (loaded.scope) {
      onTitleChange(scopeTitle(loaded.scope));
    } else if (loaded.page) {
      onTitleChange(loaded.page.title);
    } else if (loaded.clipId) {
      const clip = await getClip(loaded.clipId);
      onTitleChange(clip?.title ?? '关联收藏（已删除）');
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
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nonce]);

  /** scope 路径的 notice 需无条件应用(含清除);其余路径不碰 notice。 */
  const resolveContext = async (
    value: {
      clipId?: string;
      page?: ChatContext;
      scope?: ChatScope;
    },
    question: string,
  ): Promise<ChatContext> => {
    const result = await resolveChatContext(value, question);
    if (value.scope) setScopeNotice(result.notice);
    return result.context;
  };

  /**
   * 发送与重新生成的公共尾部:解析上下文 → 流式请求 → 保存 assistant 消息。
   * 调用方需已 dispatch start 并把 base 会话写入 state。
   */
  const runAssistantTurn = async (
    base: ChatSession,
    question: string,
    settings: ExtensionSettings,
    imageDataUrl?: string,
  ) => {
    const context = await resolveContext(base, question);
    const refs = toCitationRefs(context);
    const controller = new AbortController();
    abortRef.current = controller;
    dispatchSendPhase({ type: 'stream-start', refs });

    const reply = await streamChat(
      context,
      base.messages.map(({ role, content }) => ({ role, content })),
      settings,
      (text) => dispatchSendPhase({ type: 'chunk', text }),
      controller.signal,
      {
        imageDataUrl,
        onToolActivity: updateToolActivity,
      },
    );

    const done: ChatSession = {
      ...base,
      messages: [
        ...base.messages,
        {
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
    setSession(done);
    await saveChat(done);
  };

  const handleSend = async () => {
    const question = input.trim();
    if (!question || busy) return;
    resumeLatest('auto');

    const image = attachment;
    const quote = draftQuote;
    const content = buildUserMessageContent({
      question,
      hasImage: Boolean(image),
      picked,
      quoteText: quote?.text,
    });

    setError(undefined);
    dispatchSendPhase({ type: 'start' });
    setInput('');
    setPicked(undefined);
    setAttachment(undefined);

    try {
      const settings = await getSettings();
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
            if (quoteResult.notice) setScopeNotice(quoteResult.notice);
            page = quoteResult.context;
            onTitleChange(page.title);
          } else {
            const snapshot = await extractPage({
              maxContentLength: settings.maxContentLength,
              includeSelectedText: settings.includeSelectedText,
            });
            page = {
              title: snapshot.title,
              url: snapshot.url,
              content: [
                snapshot.description,
                snapshot.selectedText,
                snapshot.mainText,
              ]
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
      setDraftQuote(undefined);

      const withUser: ChatSession = {
        ...current,
        messages: [
          ...current.messages,
          { role: 'user', content, createdAt: now },
        ],
        updatedAt: now,
      };
      setSession(withUser);
      await saveChat(withUser);

      await runAssistantTurn(withUser, question, settings, image?.dataUrl);
    } catch (caught) {
      if (!(caught instanceof DOMException && caught.name === 'AbortError')) {
        setError(toErrorMessage(caught));
      }
    } finally {
      dispatchSendPhase({ type: 'finish' });
      abortRef.current = undefined;
    }
  };

  const handleStop = () => abortRef.current?.abort();

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
    const previousMessages = session.messages.slice(0, index);
    const lastUser = [...previousMessages]
      .reverse()
      .find((message) => message.role === 'user');
    if (lastUser?.content.includes('[截图]')) {
      setError('这条问题包含未保存的截图，请重新截图后再发送');
      return;
    }

    setError(undefined);
    dispatchSendPhase({ type: 'start' });
    const truncated: ChatSession = {
      ...session,
      messages: previousMessages,
      updatedAt: new Date().toISOString(),
    };
    setSession(truncated);
    setRatings((current) =>
      Object.fromEntries(
        Object.entries(current).filter(([key]) => Number(key) < index),
      ),
    );

    try {
      const settings = await getSettings();
      await runAssistantTurn(truncated, lastUser?.content ?? '', settings);
    } catch (caught) {
      if (!(caught instanceof DOMException && caught.name === 'AbortError')) {
        setError(toErrorMessage(caught));
      }
    } finally {
      dispatchSendPhase({ type: 'finish' });
      abortRef.current = undefined;
    }
  };

  const handlePick = async () => {
    if (picking || busy) return;
    setError(undefined);
    setPicking(true);
    try {
      const result = await pickPageElement(3_000, capabilities.vision);
      if (!result) return;
      if (result.text) setPicked(result.text);
      if (result.image) setAttachment(result.image);
      if (!result.text && result.hasVisual && !capabilities.vision) {
        setError('选中内容只有图片，请先在设置中为当前模型启用图片输入');
      }
    } catch (caught) {
      setError(toErrorMessage(caught));
    } finally {
      setPicking(false);
    }
  };

  const handleCapture = async () => {
    if (capturing || busy) return;
    if (!capabilities.vision) {
      setError('当前模型未启用图片输入，请先前往设置开启');
      return;
    }
    setError(undefined);
    setCapturing(true);
    try {
      const image = await captureSelectedRegion();
      if (image) setAttachment(image);
    } catch (caught) {
      setError(toErrorMessage(caught));
    } finally {
      setCapturing(false);
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
    handlePick,
    handleCapture,
    handleCopy,
    handleRate,
    handleModelChange,
  } as const;
}
