import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Input, Select } from 'antd';
import {
  AimOutlined,
  CaretDownOutlined,
  CaretRightOutlined,
  CaretUpOutlined,
  CheckOutlined,
  ClockCircleOutlined,
  CloseOutlined,
  CopyOutlined,
  DislikeFilled,
  DislikeOutlined,
  LikeFilled,
  LikeOutlined,
  LoadingOutlined,
  PictureOutlined,
  ReadOutlined,
  ReloadOutlined,
  ScissorOutlined,
  SendOutlined,
  StopOutlined,
  ToolOutlined,
} from '@ant-design/icons';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { browser } from 'wxt/browser';
import type { ChatScope, ChatSession, ChatToolCall } from '@/types/chat';
import type { QuoteChatIntent } from '@/types/chat-intent';
import { getChat, saveChat } from '@/services/chat-store';
import { getClip } from '@/services/clip-store';
import {
  streamChat,
  type ChatContext,
  type ChatToolActivity,
  type ResolvedChatSource,
} from '@/services/deepseek-client';
import {
  selectRelevantExcerpt,
  sourceBudget,
} from '@/services/content-excerpts';
import { extractPage } from '@/services/page-extractor';
import { ChatSourceList } from '@/components/ChatSourceList';
import { pickPageElement } from '@/services/element-picker';
import {
  captureSelectedRegion,
  type CapturedImage,
} from '@/services/screenshot-capture';
import { getSettings, saveSettings } from '@/services/settings-store';
import {
  PROVIDERS,
  getModelCapabilities,
  type ExtensionSettings,
} from '@/types/settings';
import { AppError, toErrorMessage } from '@/utils/errors';
import { useChatAutoScroll } from '@/hooks/useChatAutoScroll';

/** App 头部图标下发的指令：开启新会话 / 打开历史会话 / 开启多来源探究会话。 */
export type ChatCommand =
  | { kind: 'new'; clipId?: string; quote?: QuoteChatIntent }
  | { kind: 'new-scope'; scope: ChatScope }
  | { kind: 'open'; sessionId: string };

interface Props {
  command?: ChatCommand;
  /** nonce 变化时执行 command。 */
  nonce: number;
  /** 会话上下文标题变化时通知父组件（显示在 App 头部）。 */
  onTitleChange: (title: string) => void;
}

function ToolActivityList({
  calls,
  verbose,
}: {
  calls: (ChatToolCall | ChatToolActivity)[];
  verbose: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  if (calls.length === 0) return null;
  const running = calls.find((call) => call.status === 'running');
  const canExpand = verbose;
  return (
    <div className="tool-activity-list">
      <button
        type="button"
        className="tool-activity-header"
        onClick={() => canExpand && setExpanded((current) => !current)}
      >
        {canExpand ? (
          expanded ? <CaretDownOutlined /> : <CaretRightOutlined />
        ) : (
          <span style={{ width: 14, display: 'inline-block' }} />
        )}
        <ToolOutlined />
        {running ? (
          <>
            <span className="tool-activity-title">
              {verbose
                ? `正在调用 ${running.serverName} · ${running.toolName}…`
                : `正在调用工具（已执行 ${calls.filter((call) => call.status !== 'running').length} 个）…`}
            </span>
            <LoadingOutlined spin />
          </>
        ) : (
          <span className="tool-activity-title">已调用 {calls.length} 个工具</span>
        )}
      </button>
      {verbose &&
        expanded &&
        calls.map((call) => (
          <div className={`tool-activity ${call.status}`} key={call.id}>
            <div className="tool-activity-row">
              {call.status === 'running' && <LoadingOutlined spin />}
              <span className="tool-activity-name">
                {call.serverName} · {call.toolName}
              </span>
            </div>
            {call.summary && (
              <pre className="tool-activity-summary">{call.summary}</pre>
            )}
          </div>
        ))}
    </div>
  );
}

export function ChatView({ command, nonce, onTitleChange }: Props) {
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
  const [streaming, setStreaming] = useState<string>();
  const [toolActivities, setToolActivities] = useState<ChatToolActivity[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [copiedIndex, setCopiedIndex] = useState<number>();
  const [ratings, setRatings] = useState<Record<number, 'like' | 'dislike'>>({});
  const abortRef = useRef<AbortController>();
  const {
    containerRef: messagesRef,
    handleScroll: handleMessagesScroll,
    followLatest,
    resumeLatest,
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
    setToolActivities((current) => {
      const index = current.findIndex((item) => item.id === activity.id);
      if (index < 0) return [...current, activity];
      return current.map((item, itemIndex) =>
        itemIndex === index ? activity : item,
      );
    });
  };

  const resetState = () => {
    abortRef.current?.abort();
    setSession(undefined);
    setDraftClipId(undefined);
    setDraftScope(undefined);
    setDraftQuote(undefined);
    setScopeNotice(undefined);
    setError(undefined);
    setStreaming(undefined);
    setToolActivities([]);
    setInput('');
    setPicked(undefined);
    setAttachment(undefined);
    setRatings({});
    setCopiedIndex(undefined);
  };

  const scopeTitle = (scope: ChatScope) =>
    scope.mode === 'tabs'
      ? `探究 · ${scope.sources.length} 个网页`
      : `探究 · ${scope.sources.length} 条收藏`;

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

  /** 将 scope 解析为多来源上下文；clip 来源实时读取正文，缺失时按回退链处理。 */
  const resolveScopeContext = async (
    scope: ChatScope,
    question: string,
  ): Promise<ChatContext> => {
    const skipped: string[] = [];
    const resolved: ResolvedChatSource[] = [];

    for (const source of scope.sources) {
      if (source.type === 'page') {
        resolved.push({
          id: source.id,
          citation: '',
          title: source.title,
          url: source.url,
          content: source.content,
        });
        continue;
      }
      const clip = await getClip(source.clipId);
      if (!clip) {
        skipped.push(`${source.title}（收藏已删除）`);
        continue;
      }
      const content =
        clip.extractedText ||
        clip.selectedText ||
        clip.description ||
        clip.summary ||
        clip.userNote ||
        '';
      if (!content.trim()) {
        skipped.push(`${clip.title}（没有可用于问答的正文）`);
        continue;
      }
      resolved.push({
        id: source.id,
        citation: '',
        title: clip.title,
        url: clip.url,
        content,
      });
    }

    if (resolved.length === 0) {
      throw new AppError('AI_ANALYZE_FAILED', '选中的收藏已被删除或没有可用正文');
    }
    setScopeNotice(
      skipped.length > 0 ? `已跳过不可用来源：${skipped.join('、')}` : undefined,
    );

    const budget = sourceBudget(resolved.length);
    const sources = resolved.map((source, index) => ({
      ...source,
      citation: `S${index + 1}`,
      content: selectRelevantExcerpt(source.content, question, budget),
    }));

    return {
      title: scopeTitle(scope),
      url: '',
      content: '',
      sources,
    };
  };

  const resolveContext = async (
    value: {
      clipId?: string;
      page?: ChatContext;
      scope?: ChatScope;
    },
    question: string,
  ): Promise<ChatContext> => {
    if (value.scope) return resolveScopeContext(value.scope, question);
    if (value.page) return value.page;
    if (value.clipId) {
      const clip = await getClip(value.clipId);
      if (!clip) {
        throw new AppError('SAVE_FAILED', '关联的收藏已被删除，无法继续对话');
      }
      return {
        title: clip.title,
        url: clip.url,
        content:
          clip.extractedText ||
          [clip.description, clip.summary, clip.userNote]
            .filter(Boolean)
            .join('\n'),
      };
    }
    throw new AppError('AI_ANALYZE_FAILED', '会话缺少网页上下文');
  };

  /**
   * 为右键引用会话构建页面上下文：优先采集原标签页；
   * 标签页已关闭、已导航或无法采集时，回退为"标题 + URL + 引用文字"。
   */
  const buildQuotePageContext = async (
    quote: QuoteChatIntent,
    settings: ExtensionSettings,
  ): Promise<ChatContext> => {
    const fallback: ChatContext = {
      title: quote.title || '引用内容',
      url: quote.url,
      content: quote.text,
    };
    try {
      const tab = await browser.tabs.get(quote.tabId);
      if (!tab.url || tab.url !== quote.url) {
        // 标签页已导航到其他地址：不读取新页面。
        setScopeNotice('原网页已关闭或已跳转，将只根据引用文字回答');
        return fallback;
      }
      const snapshot = await extractPage(
        {
          maxContentLength: settings.maxContentLength,
          includeSelectedText: false,
        },
        quote.tabId,
      );
      return {
        title: snapshot.title,
        url: snapshot.url,
        content: [snapshot.description, snapshot.mainText]
          .filter(Boolean)
          .join('\n'),
      };
    } catch {
      setScopeNotice('原网页已关闭，将只根据引用文字回答');
      return fallback;
    }
  };

  const handleSend = async () => {
    const question = input.trim();
    if (!question || busy) return;
    resumeLatest('auto');

    const image = attachment;
    const quote = draftQuote;
    const content = [
      image ? '[截图]' : undefined,
      picked ? `【页面选取内容】\n${picked}` : undefined,
      quote
        ? quote.text
            .split('\n')
            .map((line) => `> ${line}`)
            .join('\n')
        : undefined,
      question,
    ]
      .filter(Boolean)
      .join('\n\n');

    setError(undefined);
    setBusy(true);
    setInput('');
    setPicked(undefined);
    setAttachment(undefined);
    setToolActivities([]);

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
            page = await buildQuotePageContext(quote, settings);
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

      const context = await resolveContext(withUser, question);
      const controller = new AbortController();
      abortRef.current = controller;
      setStreaming('');

      const reply = await streamChat(
        context,
        withUser.messages.map(({ role, content: messageContent }) => ({
          role,
          content: messageContent,
        })),
        settings,
        setStreaming,
        controller.signal,
        {
          imageDataUrl: image?.dataUrl,
          onToolActivity: updateToolActivity,
        },
      );

      const done: ChatSession = {
        ...withUser,
        messages: [
          ...withUser.messages,
          {
            role: 'assistant',
            content: reply.content,
            createdAt: new Date().toISOString(),
            usage: reply.usage,
            elapsedMs: reply.elapsedMs,
            toolCalls: reply.toolCalls,
          },
        ],
        updatedAt: new Date().toISOString(),
      };
      setSession(done);
      setToolActivities([]);
      await saveChat(done);
    } catch (caught) {
      if (!(caught instanceof DOMException && caught.name === 'AbortError')) {
        setError(toErrorMessage(caught));
      }
    } finally {
      setStreaming(undefined);
      setBusy(false);
      abortRef.current = undefined;
    }
  };

  const handleStop = () => abortRef.current?.abort();

  const formatTokens = (value: number) => {
    if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
    if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
    return String(value);
  };

  const formatTime = (iso: string) => {
    const date = new Date(iso);
    const sameDay = date.toDateString() === new Date().toDateString();
    const time = `${String(date.getHours()).padStart(2, '0')}:${String(
      date.getMinutes(),
    ).padStart(2, '0')}`;
    return sameDay ? time : `${date.getMonth() + 1}-${date.getDate()} ${time}`;
  };

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
    setBusy(true);
    setToolActivities([]);
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
      const context = await resolveContext(
        truncated,
        lastUser?.content ?? '',
      );
      const controller = new AbortController();
      abortRef.current = controller;
      setStreaming('');

      const reply = await streamChat(
        context,
        truncated.messages.map(({ role, content }) => ({ role, content })),
        settings,
        setStreaming,
        controller.signal,
        { onToolActivity: updateToolActivity },
      );

      const done: ChatSession = {
        ...truncated,
        messages: [
          ...truncated.messages,
          {
            role: 'assistant',
            content: reply.content,
            createdAt: new Date().toISOString(),
            usage: reply.usage,
            elapsedMs: reply.elapsedMs,
            toolCalls: reply.toolCalls,
          },
        ],
        updatedAt: new Date().toISOString(),
      };
      setSession(done);
      setToolActivities([]);
      await saveChat(done);
    } catch (caught) {
      if (!(caught instanceof DOMException && caught.name === 'AbortError')) {
        setError(toErrorMessage(caught));
      }
    } finally {
      setStreaming(undefined);
      setBusy(false);
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
   * 将回答中的 [S1] 引用标注替换为指向对应来源的 Markdown 链接；
   * 已是链接形式（[S1](…)）的不重复处理，超出来源数的编号保持原样。
   */
  const linkifyCitations = (markdown: string): string => {
    const sources = activeScope?.sources;
    if (!sources || sources.length === 0) return markdown;
    return markdown.replace(/\[S(\d+)\](?!\()/g, (matched, num: string) => {
      const source = sources[Number(num) - 1];
      return source ? `[S${num}](${source.url})` : matched;
    });
  };

  /** 引用链接（S1、S2…）渲染为上标小徽标，悬停显示来源标题；其余链接新标签页打开。 */
  const markdownComponents = {
    a: ({ href, children }: { href?: string; children?: React.ReactNode }) => {
      const citation =
        typeof children === 'string' && /^S(\d+)$/.test(children)
          ? activeScope?.sources[Number(children.slice(1)) - 1]
          : undefined;
      return (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className={citation ? 'citation-link' : undefined}
          title={citation ? citation.title || citation.url : href}
        >
          {children}
        </a>
      );
    },
  };

  return (
    <div className="chat-session">
      <div
        ref={messagesRef}
        className="chat-messages"
        onScroll={handleMessagesScroll}
      >
        {(session?.messages ?? []).map((message, index) => (
          <div key={index} className={`msg-group ${message.role}`}>
            <div className="msg-time">{formatTime(message.createdAt)}</div>
            {message.toolCalls && (
              <ToolActivityList
                calls={message.toolCalls}
                verbose={chatSettings?.mcpVerboseLog ?? true}
              />
            )}
            <div className={`bubble ${message.role}`}>
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={markdownComponents}
              >
                {message.role === 'assistant'
                  ? linkifyCitations(message.content)
                  : message.content}
              </ReactMarkdown>
            </div>
            {message.role === 'assistant' && (
              <div className="msg-footer">
                <div className="msg-stats">
                  {message.usage && (
                    <span className="msg-meta">
                      <CaretUpOutlined />
                      {formatTokens(message.usage.promptTokens)}
                      <CaretDownOutlined />
                      {formatTokens(message.usage.completionTokens)}
                    </span>
                  )}
                  {message.elapsedMs !== undefined && (
                    <span className="msg-meta">
                      <ClockCircleOutlined />
                      {(message.elapsedMs / 1_000).toFixed(1)}s
                    </span>
                  )}
                </div>
                <div className="msg-actions">
                  <Button
                    type="text"
                    size="small"
                    title="复制"
                    icon={
                      copiedIndex === index ? <CheckOutlined /> : <CopyOutlined />
                    }
                    onClick={() => void handleCopy(message.content, index)}
                  />
                  <Button
                    type="text"
                    size="small"
                    title="有帮助"
                    className={ratings[index] === 'like' ? 'rated' : undefined}
                    icon={
                      ratings[index] === 'like' ? <LikeFilled /> : <LikeOutlined />
                    }
                    onClick={() => handleRate(index, 'like')}
                  />
                  <Button
                    type="text"
                    size="small"
                    title="没帮助"
                    className={
                      ratings[index] === 'dislike' ? 'rated' : undefined
                    }
                    icon={
                      ratings[index] === 'dislike' ? (
                        <DislikeFilled />
                      ) : (
                        <DislikeOutlined />
                      )
                    }
                    onClick={() => handleRate(index, 'dislike')}
                  />
                  <Button
                    type="text"
                    size="small"
                    title="重新回答"
                    icon={<ReloadOutlined />}
                    disabled={busy}
                    onClick={() => void handleRegenerate(index)}
                  />
                </div>
              </div>
            )}
          </div>
        ))}
        {(streaming !== undefined || toolActivities.length > 0) && (
          <div className="msg-group assistant">
            <ToolActivityList
              calls={toolActivities}
              verbose={chatSettings?.mcpVerboseLog ?? true}
            />
            <div className="bubble assistant">
              {streaming ? (
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  components={markdownComponents}
                >
                  {linkifyCitations(streaming)}
                </ReactMarkdown>
              ) : (
                <span className="msg-generating">
                  <LoadingOutlined spin /> 正在生成…
                </span>
              )}
            </div>
          </div>
        )}
        {(session?.messages.length ?? 0) === 0 &&
          streaming === undefined &&
          (activeScope ? (
            <div className="scope-quick-questions">
              <ReadOutlined className="chat-empty-icon" />
              <div>已就绪，可针对所选来源提问</div>
              <div className="scope-quick-divider">
                <span className="scope-quick-divider-line" />
                <span className="scope-quick-divider-dot" />
                <span className="scope-quick-divider-line" />
              </div>
              {[
                '比较这些页面的核心差异',
                '整理成一份结构化报告',
              ].map((preset) => (
                <span
                  key={preset}
                  className="scope-quick-question"
                  onClick={() => setInput(preset)}
                >
                  {preset}
                </span>
              ))}
            </div>
          ) : (
            <div className="empty-hint chat-empty">
              <ReadOutlined className="chat-empty-icon" />
              <div>拾取互联网中有价值的碎片</div>
            </div>
          ))}
      </div>
      {error && (
        <Alert
          type="error"
          showIcon
          title={error}
          closable={{ onClose: () => setError(undefined) }}
          style={{ marginBottom: 8 }}
        />
      )}

      {scopeNotice && (
        <Alert
          type="warning"
          showIcon
          title={scopeNotice}
          closable={{ onClose: () => setScopeNotice(undefined) }}
          style={{ marginBottom: 8 }}
        />
      )}

      {draftQuote && (
        <div className="quote-card">
          <div className="quote-card-text">{draftQuote.text}</div>
          <span
            className="quote-card-close"
            onClick={() => setDraftQuote(undefined)}
          >
            <CloseOutlined />
          </span>
        </div>
      )}

      {activeScope && <ChatSourceList scope={activeScope} />}

      {picked && (
        <Alert
          type="info"
          showIcon
          icon={<AimOutlined />}
          title={`已选取页面文字（${picked.length} 字），将随下一条消息发送`}
          closable={{ onClose: () => setPicked(undefined) }}
          style={{ marginBottom: 8 }}
        />
      )}

      {attachment && (
        <div className="screenshot-preview">
          <img src={attachment.dataUrl} alt="待发送截图" />
          <span className="screenshot-preview-close" onClick={() => setAttachment(undefined)}>
            <CloseOutlined />
          </span>
        </div>
      )}

      <div className="chat-input">
        <div className="chat-input-card">
          <Input.TextArea
            variant="borderless"
            autoSize={{ minRows: 3, maxRows: 8 }}
            placeholder="输入问题…"
            value={input}
            disabled={busy}
            onChange={(event) => setInput(event.target.value)}
            onPressEnter={(event) => {
              if (!event.shiftKey) {
                event.preventDefault();
                void handleSend();
              }
            }}
          />
          <div className="chat-input-footer">
            <Select
              size="small"
              variant="borderless"
              title="选择模型"
              style={{ maxWidth: 150 }}
              popupMatchSelectWidth={false}
              value={chatSettings?.model}
              onChange={handleModelChange}
              options={modelOptions.map((model) => ({ value: model, label: model }))}
            />
            <div className="chat-input-actions">
              {busy ? (
                <Button
                  size="small"
                  danger
                  icon={<StopOutlined />}
                  onClick={handleStop}
                />
              ) : (
                <Button
                  size="small"
                  type="primary"
                  title="发送"
                  icon={<SendOutlined />}
                  disabled={!input.trim()}
                  onClick={() => void handleSend()}
                />
              )}
              <Button
                size="small"
                title="选取页面元素"
                icon={<AimOutlined />}
                loading={picking}
                disabled={busy}
                onClick={() => void handlePick()}
              />
              <Button
                size="small"
                title={
                  capabilities.vision
                    ? '框选页面截图'
                    : '当前模型未启用图片输入'
                }
                icon={<ScissorOutlined />}
                loading={capturing}
                disabled={busy || !capabilities.vision}
                onClick={() => void handleCapture()}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
