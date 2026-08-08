import { useCallback, useEffect, useState } from 'react';
import { Button, Card, Input, Popconfirm, Space, Tooltip, Typography } from 'antd';
import { DeleteOutlined, HistoryOutlined, LinkOutlined } from '@ant-design/icons';
import { browser } from 'wxt/browser';
import type { ChatIndexEntry } from '@/types/chat';
import { getChatIndex, removeChat } from '@/services/chat-store';
import { onDataChanged } from '@/services/data-events';
import { EmptyState } from '@/components/EmptyState';

interface Props {
  /** 视图是否可见；变为可见时刷新列表 */
  active: boolean;
  /** 点击某条历史对话时打开该会话 */
  onOpen: (sessionId: string) => void;
}

export function ChatHistoryView({ active, onOpen }: Props) {
  const [sessions, setSessions] = useState<ChatIndexEntry[]>([]);
  const [keyword, setKeyword] = useState('');

  const refresh = useCallback(async () => {
    setSessions(await getChatIndex());
  }, []);

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
    await removeChat(id);
    await refresh();
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

      {filtered.length === 0 ? (
        <EmptyState
          icon={<HistoryOutlined />}
          title={kw ? '没有匹配的对话' : '还没有对话记录'}
          description={kw ? '换个关键词试试' : '点上方 + 发起新对话'}
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
