import { useCallback, useEffect, useState } from 'react';
import { Alert, Button, Card, Input, Popconfirm, Space, Tooltip, Typography } from 'antd';
import {
  ClearOutlined,
  DeleteOutlined,
  LinkOutlined,
  PlusOutlined,
} from '@ant-design/icons';
import { browser } from 'wxt/browser';
import type { ChatIndexEntry } from '@/types/chat';
import { getChatIndex, removeChat } from '@/services/chat-store';
import { onDataChanged } from '@/services/data-events';
import { EmptyState } from '@/components/EmptyState';
import { toErrorMessage } from '@/utils/errors';

interface Props {
  /** 视图是否可见；变为可见时刷新列表 */
  active: boolean;
  /** 点击某条历史对话时打开该会话 */
  onOpen: (sessionId: string) => void;
  /** 空状态下发起新对话 */
  onNew: () => void;
}

export function ChatHistoryView({ active, onOpen, onNew }: Props) {
  const [sessions, setSessions] = useState<ChatIndexEntry[]>([]);
  const [keyword, setKeyword] = useState('');
  const [error, setError] = useState<string>();

  const refresh = useCallback(() => getChatIndex().then(setSessions), []);

  useEffect(() => {
    if (active) void refresh();
  }, [active, refresh]);

  // 聊天数据变化时，视图可见则刷新列表
  useEffect(() => {
    return onDataChanged('chats', () => {
      if (active) void refresh();
    });
  }, [active, refresh]);

  const handleDelete = async (id: string) => {
    setError(undefined);
    try {
      await removeChat(id);
      await refresh();
    } catch (caught) {
      setError(toErrorMessage(caught));
    }
  };

  const kw = keyword.trim().toLowerCase();
  const filtered = kw
    ? sessions.filter((s) => s.title.toLowerCase().includes(kw))
    : sessions;

  return (
    <Space direction="vertical" size={10} style={{ display: 'flex' }}>
      <Input.Search
        placeholder="搜索对话标题…"
        allowClear
        value={keyword}
        onChange={(e) => setKeyword(e.target.value)}
      />

      {error && (
        <Alert
          type="error"
          showIcon
          title={error}
          closable={{ onClose: () => setError(undefined) }}
        />
      )}

      {filtered.length === 0 ? (
        <EmptyState
          art={kw ? 'search' : 'history'}
          title={kw ? '没有匹配的对话' : '还没有对话记录'}
          description={kw ? '换个关键词试试，或清除搜索' : '围绕网页发起第一场对话吧'}
          action={
            kw
              ? {
                  label: '清除搜索',
                  icon: <ClearOutlined />,
                  onClick: () => setKeyword(''),
                }
              : { label: '发起新对话', icon: <PlusOutlined />, onClick: onNew }
          }
        />
      ) : (
        filtered.map((s) => (
          <Card
            key={s.id}
            size="small"
            hoverable
            styles={{ body: { padding: '8px 12px' } }}
            onClick={() => onOpen(s.id)}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <Typography.Text strong title={s.title} ellipsis={{ tooltip: s.title }}>
                  {s.title}
                </Typography.Text>
                <div>
                  <Typography.Text type="secondary" style={{ fontSize: 11 }}>
                    {s.clipId ? '收藏对话' : '网页对话'} · {s.messageCount} 条 ·{' '}
                    {s.updatedAt.slice(0, 10)}
                  </Typography.Text>
                </div>
              </div>
              {s.url && (
                <Tooltip title="打开原网页">
                  <Button
                    size="small"
                    type="text"
                    icon={<LinkOutlined />}
                    onClick={(e) => {
                      e.stopPropagation();
                      void browser.tabs.create({ url: s.url });
                    }}
                  />
                </Tooltip>
              )}
              <Popconfirm
                title="删除这个对话？"
                okText="删除"
                cancelText="取消"
                okButtonProps={{ danger: true }}
                onConfirm={(e) => {
                  e?.stopPropagation();
                  void handleDelete(s.id);
                }}
                onCancel={(e) => e?.stopPropagation()}
                onPopupClick={(e) => e.stopPropagation()}
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
