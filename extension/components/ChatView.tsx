import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Input, Typography } from 'antd';
import {
  AimOutlined,
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
import { getSettings } from '@/services/settings-store';
import { AppError, toErrorMessage } from '@/utils/errors';

/** App 头部图标下发的指令：开启新会话 / 打开历史会话 */
export type ChatCommand =
  | { kind: 'new'; clipId?: string }
  | { kind: 'open'; sessionId: string };

interface Props {
  command?: ChatCommand;
  /** nonce 变化时执行 command */
  nonce: number;
}

export function ChatView({ command, nonce }: Props) {
  const [session, setSession] = useState<ChatSession>();
  /** 新会话尚未发送第一条消息时的目标收藏 id（undefined 表示当前网页） */
  const [draftClipId, setDraftClipId] = useState<string>();
  const [contextTitle, setContextTitle] = useState('当前网页');

  const [input, setInput] = useState('');
  /** 通过"选取元素"从页面拾取的文本，随下一条消息一起发送 */
  const [picked, setPicked] = useState<string>();
  const [picking, setPicking] = useState(false);
  const [streaming, setStreaming] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const abortRef = useRef<AbortController>();
  const bottomRef = useRef<HTMLDivElement>(null);

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
  };

  const startNewSession = async (clipId?: string) => {
    resetState();
    setDraftClipId(clipId);
    if (clipId) {
      const clip = await getClip(clipId);
      setContextTitle(clip?.title ?? '关联收藏');
    } else {
      setContextTitle('当前网页');
    }
  };

  const openSession = async (id: string) => {
    const loaded = await getChat(id);
    if (!loaded) return;
    resetState();
    setSession(loaded);
    if (loaded.page) {
      setContextTitle(loaded.page.title);
    } else if (loaded.clipId) {
      const clip = await getClip(loaded.clipId);
      setContextTitle(clip?.title ?? '关联收藏（已删除）');
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
          setContextTitle(snapshot.title);
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
          { role: 'assistant', content: reply, createdAt: new Date().toISOString() },
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
      <div className="chat-session-header">
        <Typography.Text
          strong
          title={contextTitle}
          ellipsis={{ tooltip: contextTitle }}
        >
          {contextTitle}
        </Typography.Text>
      </div>

      <div className="chat-messages">
        {(session?.messages ?? []).map((m, i) => (
          <div key={i} className={`bubble ${m.role}`}>
            {m.role === 'assistant' ? (
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{m.content}</ReactMarkdown>
            ) : (
              m.content
            )}
          </div>
        ))}
        {streaming !== undefined && (
          <div className="bubble assistant">
            {streaming ? (
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{streaming}</ReactMarkdown>
            ) : (
              '…'
            )}
          </div>
        )}
        {(session?.messages.length ?? 0) === 0 && streaming === undefined && (
          <div className="chat-empty-hint">
            <div>围绕这个网页提问吧</div>
            <div>例如："这个网站有什么值得借鉴的设计？"</div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {error && <Alert type="error" showIcon message={error} closable style={{ marginBottom: 8 }} />}

      {picked && (
        <Alert
          type="info"
          showIcon
          icon={<AimOutlined />}
          message={`已选取页面内容（${picked.length} 字），将随下一条消息发送`}
          closable
          onClose={() => setPicked(undefined)}
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
  );
}
