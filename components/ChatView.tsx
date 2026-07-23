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
import type { ChatSession, ChatToolCall } from '@/types/chat';
import { getChat, saveChat } from '@/services/chat-store';
import { getClip } from '@/services/clip-store';
import {
  streamChat,
  type ChatContext,
  type ChatToolActivity,
} from '@/services/deepseek-client';
import { extractCurrentPage } from '@/services/page-extractor';
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

/** App 头部图标下发的指令：开启新会话 / 打开历史会话。 */
export type ChatCommand =
  | { kind: 'new'; clipId?: string }
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
}: {
  calls: (ChatToolCall | ChatToolActivity)[];
}) {
  const [expanded, setExpanded] = useState(false);
  if (calls.length === 0) return null;
  const running = calls.find((call) => call.status === 'running');
  return (
    <div className="tool-activity-list">
      <button
        type="button"
        className="tool-activity-header"
        onClick={() => setExpanded((current) => !current)}
      >
        {expanded ? <CaretDownOutlined /> : <CaretRightOutlined />}
        <ToolOutlined />
        {running ? (
          <>
            <span className="tool-activity-title">
              正在调用 {running.serverName} · {running.toolName}…
            </span>
            <LoadingOutlined spin />
          </>
        ) : (
          <span className="tool-activity-title">
            已调用 {calls.length} 个工具
          </span>
        )}
      </button>
      {expanded &&
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
  const bottomRef = useRef<HTMLDivElement>(null);

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
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [session?.messages.length, streaming, toolActivities]);

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
    setError(undefined);
    setStreaming(undefined);
    setToolActivities([]);
    setInput('');
    setPicked(undefined);
    setAttachment(undefined);
    setRatings({});
    setCopiedIndex(undefined);
  };

  const startNewSession = async (clipId?: string) => {
    resetState();
    setDraftClipId(clipId);
    if (clipId) {
      const clip = await getClip(clipId);
      onTitleChange(clip?.title ?? '关联收藏');
    } else {
      onTitleChange('当前网页');
    }
  };

  const openSession = async (id: string) => {
    const loaded = await getChat(id);
    if (!loaded) return;
    resetState();
    setSession(loaded);
    if (loaded.page) {
      onTitleChange(loaded.page.title);
    } else if (loaded.clipId) {
      const clip = await getClip(loaded.clipId);
      onTitleChange(clip?.title ?? '关联收藏（已删除）');
    }
  };

  useEffect(() => {
    if (nonce > 0 && command) {
      if (command.kind === 'new') void startNewSession(command.clipId);
      else void openSession(command.sessionId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nonce]);

  const resolveContext = async (value: {
    clipId?: string;
    page?: ChatContext;
  }): Promise<ChatContext> => {
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

  const handleSend = async () => {
    const question = input.trim();
    if (!question || busy) return;

    const image = attachment;
    const content = [
      image ? '[截图]' : undefined,
      picked ? `【页面选取内容】\n${picked}` : undefined,
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
        if (!draftClipId) {
          const snapshot = await extractCurrentPage({
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
        current = {
          id: crypto.randomUUID(),
          clipId: draftClipId,
          page,
          title: question.slice(0, 30),
          messages: [],
          createdAt: now,
          updatedAt: now,
        };
      }

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

      const context = await resolveContext(withUser);
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
      const context = await resolveContext(truncated);
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

  return (
    <div className="chat-session">
      <div className="chat-messages">
        {(session?.messages ?? []).map((message, index) => (
          <div key={index} className={`msg-group ${message.role}`}>
            <div className="msg-time">{formatTime(message.createdAt)}</div>
            {message.toolCalls && <ToolActivityList calls={message.toolCalls} />}
            <div className={`bubble ${message.role}`}>
              {message.role === 'assistant' ? (
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {message.content}
                </ReactMarkdown>
              ) : (
                message.content
              )}
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
            <ToolActivityList calls={toolActivities} />
            <div className="bubble assistant">
              {streaming ? (
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {streaming}
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
          streaming === undefined && (
            <div className="empty-hint chat-empty">
              <ReadOutlined className="chat-empty-icon" />
              <div>拾取互联网中有价值的碎片</div>
            </div>
          )}
        <div ref={bottomRef} />
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