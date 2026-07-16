import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Empty,
  Input,
  Popconfirm,
  Select,
  Space,
  Typography,
} from 'antd';
import {
  ArrowLeftOutlined,
  DeleteOutlined,
  PlusOutlined,
  SendOutlined,
  StopOutlined,
} from '@ant-design/icons';
import type { ChatIndexEntry, ChatSession } from '@/types/chat';
import type { ClipIndexEntry } from '@/types/clip';
import { getChat, getChatIndex, removeChat, saveChat } from '@/services/chat-store';
import { getClip, queryClips } from '@/services/clip-store';
import { streamChat, type ChatContext } from '@/services/deepseek-client';
import { extractCurrentPage } from '@/services/page-extractor';
import { getSettings } from '@/services/settings-store';
import { AppError, toErrorMessage } from '@/utils/errors';

const CURRENT_PAGE = '__current__';

interface Props {
  /** 从收藏详情点"对话"进入时的目标收藏；nonce 变化时强制开启新会话 */
  pendingClipId?: string;
  pendingNonce: number;
}

export function ChatView({ pendingClipId, pendingNonce }: Props) {
  const [view, setView] = useState<'list' | 'session'>('list');
  const [sessions, setSessions] = useState<ChatIndexEntry[]>([]);
  const [clips, setClips] = useState<ClipIndexEntry[]>([]);
  const [target, setTarget] = useState<string>(CURRENT_PAGE);

  const [session, setSession] = useState<ChatSession>();
  /** 新会话尚未发送第一条消息时的目标收藏 id（undefined 表示当前网页） */
  const [draftClipId, setDraftClipId] = useState<string>();

  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const abortRef = useRef<AbortController>();
  const bottomRef = useRef<HTMLDivElement>(null);

  const refreshList = useCallback(async () => {
    setSessions(await getChatIndex());
    setClips(await queryClips({}));
  }, []);

  useEffect(() => {
    void refreshList();
  }, [refreshList, view]);

  // 从收藏详情跳转进来：直接开启针对该收藏的新会话
  useEffect(() => {
    if (pendingNonce > 0 && pendingClipId) {
      startNewSession(pendingClipId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingNonce]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [session?.messages.length, streaming]);

  const startNewSession = (clipId?: string) => {
    abortRef.current?.abort();
    setSession(undefined);
    setDraftClipId(clipId);
    setError(undefined);
    setStreaming(undefined);
    setInput('');
    setView('session');
  };

  const openSession = async (id: string) => {
    const loaded = await getChat(id);
    if (!loaded) return;
    setSession(loaded);
    setDraftClipId(undefined);
    setError(undefined);
    setStreaming(undefined);
    setView('session');
  };

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

    setError(undefined);
    setBusy(true);
    setInput('');

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
          { role: 'user', content: question, createdAt: now },
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

  const handleDelete = async (id: string) => {
    await removeChat(id);
    await refreshList();
  };

  /* ---------------------------- 会话列表 ---------------------------- */

  if (view === 'list') {
    return (
      <Space direction="vertical" size={10} style={{ display: 'flex' }}>
        <Card size="small" title="发起新对话">
          <Space.Compact block>
            <Select
              style={{ flex: 1 }}
              showSearch
              optionFilterProp="label"
              value={target}
              onChange={setTarget}
              options={[
                { value: CURRENT_PAGE, label: '当前网页' },
                ...clips.map((c) => ({ value: c.id, label: c.title })),
              ]}
            />
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={() =>
                startNewSession(target === CURRENT_PAGE ? undefined : target)
              }
            >
              新对话
            </Button>
          </Space.Compact>
        </Card>

        {sessions.length === 0 ? (
          <Empty description="还没有对话记录" />
        ) : (
          sessions.map((s) => (
            <Card
              key={s.id}
              size="small"
              hoverable
              styles={{ body: { padding: '8px 12px' } }}
              onClick={() => void openSession(s.id)}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <Typography.Text strong ellipsis={{ tooltip: s.title }}>
                    {s.title}
                  </Typography.Text>
                  <div>
                    <Typography.Text type="secondary" style={{ fontSize: 11 }}>
                      {s.clipId ? '收藏对话' : '网页对话'} · {s.messageCount} 条 ·{' '}
                      {s.updatedAt.slice(0, 10)}
                    </Typography.Text>
                  </div>
                </div>
                <Popconfirm
                  title="删除这个对话？"
                  okText="删除"
                  cancelText="取消"
                  okButtonProps={{ danger: true }}
                  onConfirm={() => void handleDelete(s.id)}
                >
                  <Button
                    size="small"
                    type="text"
                    danger
                    icon={<DeleteOutlined />}
                    onClick={(e) => e.stopPropagation()}
                  />
                </Popconfirm>
              </div>
            </Card>
          ))
        )}
      </Space>
    );
  }

  /* ---------------------------- 会话详情 ---------------------------- */

  const contextLabel = session?.page
    ? session.page.title
    : (clips.find((c) => c.id === (session?.clipId ?? draftClipId))?.title ??
      '当前网页');

  return (
    <div className="chat-session">
      <div className="chat-session-header">
        <Button
          size="small"
          type="text"
          icon={<ArrowLeftOutlined />}
          onClick={() => {
            abortRef.current?.abort();
            setView('list');
          }}
        />
        <Typography.Text strong ellipsis={{ tooltip: contextLabel }}>
          {contextLabel}
        </Typography.Text>
      </div>

      <div className="chat-messages">
        {(session?.messages ?? []).map((m, i) => (
          <div key={i} className={`bubble ${m.role}`}>
            {m.content}
          </div>
        ))}
        {streaming !== undefined && (
          <div className="bubble assistant">{streaming || '…'}</div>
        )}
        {(session?.messages.length ?? 0) === 0 && streaming === undefined && (
          <Typography.Text type="secondary" style={{ textAlign: 'center', padding: 16 }}>
            围绕这个网页提问吧，例如"这个网站有什么值得借鉴的设计？"
          </Typography.Text>
        )}
        <div ref={bottomRef} />
      </div>

      {error && <Alert type="error" showIcon message={error} closable style={{ marginBottom: 8 }} />}

      <div className="chat-input">
        <Input.TextArea
          autoSize={{ minRows: 1, maxRows: 4 }}
          placeholder="输入问题，Enter 发送，Shift+Enter 换行"
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
        {busy ? (
          <Button danger icon={<StopOutlined />} onClick={handleStop} />
        ) : (
          <Button
            type="primary"
            icon={<SendOutlined />}
            disabled={!input.trim()}
            onClick={() => void handleSend()}
          />
        )}
      </div>
    </div>
  );
}
