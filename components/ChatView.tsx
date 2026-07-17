import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Input, Select } from 'antd';
import {
  AimOutlined,
  CaretDownOutlined,
  CaretUpOutlined,
  CheckOutlined,
  ClockCircleOutlined,
  CopyOutlined,
  DislikeFilled,
  DislikeOutlined,
  LikeFilled,
  LikeOutlined,
  LoadingOutlined,
  ReadOutlined,
  ReloadOutlined,
  SendOutlined,
  StopOutlined,
} from '@ant-design/icons';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { ChatSession } from '@/types/chat';
import { getChat, saveChat } from '@/services/chat-store';
import { getClip } from '@/services/clip-store';
import { streamChat, type ChatContext } from '@/services/deepseek-client';
import { extractCurrentPage } from '@/services/page-extractor';
import { pickPageElement } from '@/services/element-picker';
import { getSettings, saveSettings } from '@/services/settings-store';
import { PROVIDERS } from '@/types/settings';
import { AppError, toErrorMessage } from '@/utils/errors';

/** App 头部图标下发的指令：开启新会话 / 打开历史会话 */
export type ChatCommand =
  | { kind: 'new'; clipId?: string }
  | { kind: 'open'; sessionId: string };

interface Props {
  command?: ChatCommand;
  /** nonce 变化时执行 command */
  nonce: number;
  /** 会话上下文标题变化时通知父组件（显示在 App 头部） */
  onTitleChange: (title: string) => void;
}

export function ChatView({ command, nonce, onTitleChange }: Props) {
  const [session, setSession] = useState<ChatSession>();
  /** 新会话尚未发送第一条消息时的目标收藏 id（undefined 表示当前网页） */
  const [draftClipId, setDraftClipId] = useState<string>();

  const [input, setInput] = useState('');
  /** 通过"选取元素"从页面拾取的文本，随下一条消息一起发送 */
  const [picked, setPicked] = useState<string>();
  const [picking, setPicking] = useState(false);
  const [streaming, setStreaming] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  /** 刚复制的消息下标，用于短暂显示"已复制"状态 */
  const [copiedIndex, setCopiedIndex] = useState<number>();
  /** 点赞/点踩状态（仅本次会话内展示，不持久化） */
  const [ratings, setRatings] = useState<Record<number, 'like' | 'dislike'>>({});
  const abortRef = useRef<AbortController>();
  const bottomRef = useRef<HTMLDivElement>(null);

  /** 当前模型及所属供应商的可选模型列表 */
  const [model, setModel] = useState<string>();
  const [modelOptions, setModelOptions] = useState<string[]>([]);

  useEffect(() => {
    void getSettings().then((s) => {
      setModel(s.model);
      const presetModels = PROVIDERS.find((p) => p.id === s.provider)?.models ?? [];
      setModelOptions([...new Set([s.model, ...presetModels])].filter(Boolean));
    });
  }, []);

  const handleModelChange = (value: string) => {
    setModel(value);
    void saveSettings({ model: value });
  };

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [session?.messages.length, streaming]);

  const resetState = () => {
    abortRef.current?.abort();
    setSession(undefined);
    setDraftClipId(undefined);
    setError(undefined);
    setStreaming(undefined);
    setInput('');
    setPicked(undefined);
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

  // 头部图标指令：新对话 / 打开历史对话
  useEffect(() => {
    if (nonce > 0 && command) {
      if (command.kind === 'new') {
        void startNewSession(command.clipId);
      } else {
        void openSession(command.sessionId);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nonce]);

  const resolveContext = async (s: {
    clipId?: string;
    page?: ChatContext;
  }): Promise<ChatContext> => {
    if (s.page) return s.page;
    if (s.clipId) {
      const clip = await getClip(s.clipId);
      if (!clip) {
        throw new AppError('SAVE_FAILED', '关联的收藏已被删除，无法继续对话');
      }
      return {
        title: clip.title,
        url: clip.url,
        content:
          clip.extractedText ||
          [clip.description, clip.summary, clip.userNote].filter(Boolean).join('\n'),
      };
    }
    throw new AppError('AI_ANALYZE_FAILED', '会话缺少网页上下文');
  };

  const handleSend = async () => {
    const question = input.trim();
    if (!question || busy) return;

    // 携带选取的页面片段一起提问
    const content = picked
      ? `【页面选取内容】\n${picked}\n\n${question}`
      : question;

    setError(undefined);
    setBusy(true);
    setInput('');
    setPicked(undefined);

    try {
      const settings = await getSettings();
      const now = new Date().toISOString();

      // 首条消息：先确定会话的网页上下文
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
            content: [snapshot.description, snapshot.selectedText, snapshot.mainText]
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
        withUser.messages.map(({ role, content }) => ({ role, content })),
        settings,
        setStreaming,
        controller.signal,
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
          },
        ],
        updatedAt: new Date().toISOString(),
      };
      setSession(done);
      await saveChat(done);
    } catch (e) {
      if (!(e instanceof DOMException && e.name === 'AbortError')) {
        setError(toErrorMessage(e));
      }
    } finally {
      setStreaming(undefined);
      setBusy(false);
      abortRef.current = undefined;
    }
  };

  const handleStop = () => {
    abortRef.current?.abort();
  };

  /** token 数格式化：1234 → 1.2k，1234567 → 1.2M */
  const formatTokens = (n: number) => {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
    return String(n);
  };

  const formatTime = (iso: string) => {
    const d = new Date(iso);
    const sameDay = d.toDateString() === new Date().toDateString();
    const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    return sameDay ? hm : `${d.getMonth() + 1}-${d.getDate()} ${hm}`;
  };

  const handleCopy = async (content: string, index: number) => {
    try {
      await navigator.clipboard.writeText(content);
      setCopiedIndex(index);
      setTimeout(() => setCopiedIndex((v) => (v === index ? undefined : v)), 1500);
    } catch {
      setError('复制失败');
    }
  };

  const handleRate = (index: number, value: 'like' | 'dislike') => {
    setRatings((prev) => {
      const next = { ...prev };
      if (next[index] === value) {
        delete next[index]; // 再点一次取消
      } else {
        next[index] = value;
      }
      return next;
    });
  };

  /** 重新回答：丢弃第 index 条（assistant）消息，用其之前的对话重新生成 */
  const handleRegenerate = async (index: number) => {
    if (!session || busy) return;
    setError(undefined);
    setBusy(true);

    const truncated: ChatSession = {
      ...session,
      messages: session.messages.slice(0, index),
      updatedAt: new Date().toISOString(),
    };
    setSession(truncated);
    // 被丢弃及之后的消息，点赞/点踩状态一并清除
    setRatings((prev) =>
      Object.fromEntries(Object.entries(prev).filter(([k]) => Number(k) < index)),
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
          },
        ],
        updatedAt: new Date().toISOString(),
      };
      setSession(done);
      await saveChat(done);
    } catch (e) {
      if (!(e instanceof DOMException && e.name === 'AbortError')) {
        setError(toErrorMessage(e));
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
      const text = await pickPageElement(3000);
      if (text) setPicked(text);
    } catch (e) {
      setError(toErrorMessage(e));
    } finally {
      setPicking(false);
    }
  };

  return (
    <div className="chat-session">
      <div className="chat-messages">
        {(session?.messages ?? []).map((m, i) => (
          <div key={i} className={`msg-group ${m.role}`}>
            <div className="msg-time">{formatTime(m.createdAt)}</div>
            <div className={`bubble ${m.role}`}>
              {m.role === 'assistant' ? (
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{m.content}</ReactMarkdown>
              ) : (
                m.content
              )}
            </div>
            {m.role === 'assistant' && (
              <div className="msg-footer">
                <div className="msg-stats">
                  {m.usage && (
                    <span className="msg-meta">
                      <CaretUpOutlined /> {formatTokens(m.usage.promptTokens)}
                      <CaretDownOutlined /> {formatTokens(m.usage.completionTokens)}
                    </span>
                  )}
                  {m.elapsedMs !== undefined && (
                    <span className="msg-meta">
                      <ClockCircleOutlined /> {(m.elapsedMs / 1000).toFixed(1)}s
                    </span>
                  )}
                </div>
                <div className="msg-actions">
                  <Button
                    type="text"
                    size="small"
                    title="复制"
                    icon={copiedIndex === i ? <CheckOutlined /> : <CopyOutlined />}
                    onClick={() => void handleCopy(m.content, i)}
                  />
                  <Button
                    type="text"
                    size="small"
                    title="有帮助"
                    className={ratings[i] === 'like' ? 'rated' : undefined}
                    icon={ratings[i] === 'like' ? <LikeFilled /> : <LikeOutlined />}
                    onClick={() => handleRate(i, 'like')}
                  />
                  <Button
                    type="text"
                    size="small"
                    title="没帮助"
                    className={ratings[i] === 'dislike' ? 'rated' : undefined}
                    icon={ratings[i] === 'dislike' ? <DislikeFilled /> : <DislikeOutlined />}
                    onClick={() => handleRate(i, 'dislike')}
                  />
                  <Button
                    type="text"
                    size="small"
                    title="重新回答"
                    icon={<ReloadOutlined />}
                    disabled={busy}
                    onClick={() => void handleRegenerate(i)}
                  />
                </div>
              </div>
            )}
          </div>
        ))}
        {streaming !== undefined && (
          <div className="msg-group assistant">
            <div className="bubble assistant">
              {streaming ? (
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{streaming}</ReactMarkdown>
              ) : (
                <span className="msg-generating">
                  <LoadingOutlined spin /> 正在生成…
                </span>
              )}
            </div>
          </div>
        )}
        {(session?.messages.length ?? 0) === 0 && streaming === undefined && (
          <div className="empty-hint chat-empty">
            <ReadOutlined className="chat-empty-icon" />
            <div>拾取互联网中有价值的碎片</div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {error && <Alert type="error" showIcon title={error} closable style={{ marginBottom: 8 }} />}

      {picked && (
        <Alert
          type="info"
          showIcon
          icon={<AimOutlined />}
          title={`已选取页面内容（${picked.length} 字），将随下一条消息发送`}
          closable={{ onClose: () => setPicked(undefined) }}
          style={{ marginBottom: 8 }}
        />
      )}

      <div className="chat-input">
        <div className="chat-input-card">
          <Input.TextArea
            variant="borderless"
            autoSize={{ minRows: 3, maxRows: 8 }}
            placeholder="输入问题…"
            value={input}
            disabled={busy}
            onChange={(e) => setInput(e.target.value)}
            onPressEnter={(e) => {
              if (!e.shiftKey) {
                e.preventDefault();
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
              value={model}
              onChange={handleModelChange}
              options={modelOptions.map((m) => ({ value: m, label: m }))}
            />
            <div className="chat-input-actions">
              {busy ? (
                <Button size="small" danger icon={<StopOutlined />} onClick={handleStop} />
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
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
