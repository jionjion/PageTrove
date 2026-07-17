import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Empty,
  Input,
  Popconfirm,
  Select,
  Space,
  Tag,
  Typography,
} from 'antd';
import {
  DeleteOutlined,
  ExportOutlined,
  MessageOutlined,
  SaveOutlined,
} from '@ant-design/icons';
import type { ClipIndexEntry, WebClip } from '@/types/clip';
import {
  collectFacets,
  getClip,
  queryClips,
  removeClip,
  updateClip,
} from '@/services/clip-store';
import { toErrorMessage } from '@/utils/errors';

interface Props {
  /** 视图是否可见；变为可见时刷新列表 */
  active: boolean;
  /** 点击"对话"按钮时回调，切换到对话标签页 */
  onChat?: (clipId: string) => void;
}

export function ClipListView({ active, onChat }: Props) {
  const [entries, setEntries] = useState<ClipIndexEntry[]>([]);
  const [keyword, setKeyword] = useState('');
  const [tag, setTag] = useState<string>();
  const [facets, setFacets] = useState<{ tags: string[] }>({ tags: [] });

  const [expandedId, setExpandedId] = useState<string>();
  const [detail, setDetail] = useState<WebClip>();
  const [editNote, setEditNote] = useState('');
  const [editTags, setEditTags] = useState<string[]>([]);
  const [error, setError] = useState<string>();

  const refresh = useCallback(async () => {
    setEntries(await queryClips({ keyword: keyword || undefined, tag }));
    setFacets(await collectFacets());
  }, [keyword, tag]);

  useEffect(() => {
    if (active) void refresh();
  }, [active, refresh]);

  const openDetail = async (id: string) => {
    if (expandedId === id) {
      setExpandedId(undefined);
      setDetail(undefined);
      return;
    }
    const clip = await getClip(id);
    if (clip) {
      setExpandedId(id);
      setDetail(clip);
      setEditNote(clip.userNote ?? '');
      setEditTags(clip.tags);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await removeClip(id);
      if (expandedId === id) {
        setExpandedId(undefined);
        setDetail(undefined);
      }
      await refresh();
    } catch (e) {
      setError(toErrorMessage(e));
    }
  };

  const handleSaveEdit = async () => {
    if (!detail) return;
    try {
      const next = await updateClip(detail.id, {
        userNote: editNote.trim() || undefined,
        tags: editTags,
      });
      setDetail(next);
      await refresh();
    } catch (e) {
      setError(toErrorMessage(e));
    }
  };

  return (
    <Space direction="vertical" size={10} style={{ display: 'flex' }}>
      <Input.Search
        placeholder="搜索标题 / 域名 / 标签…"
        allowClear
        value={keyword}
        onChange={(e) => setKeyword(e.target.value)}
      />
      <Select
        style={{ width: '100%' }}
        placeholder="全部标签"
        allowClear
        value={tag}
        onChange={setTag}
        options={facets.tags.map((t) => ({ value: t, label: t }))}
      />

      {error && <Alert type="error" showIcon message={error} closable />}

      {entries.length === 0 ? (
        <Empty description="还没有收藏，点上方 ☆ 收藏当前网页吧" />
      ) : (
        entries.map((entry) => (
          <Card
            key={entry.id}
            size="small"
            hoverable
            styles={{ body: { padding: '8px 12px' } }}
            onClick={() => void openDetail(entry.id)}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="page-title-row">
                  {entry.faviconUrl && (
                    <img className="favicon" src={entry.faviconUrl} alt="" />
                  )}
                  <Typography.Text
                    strong
                    title={entry.title}
                    ellipsis={{ tooltip: entry.title }}
                  >
                    {entry.title}
                  </Typography.Text>
                </div>
                <div>
                  <Typography.Text type="secondary" style={{ fontSize: 11 }}>
                    {entry.domain} · {entry.createdAt.slice(0, 10)}
                  </Typography.Text>
                </div>
              </div>
              <Popconfirm
                title="删除这条收藏？"
                okText="删除"
                cancelText="取消"
                okButtonProps={{ danger: true }}
                onConfirm={() => void handleDelete(entry.id)}
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

            {entry.summary && (
              <Typography.Paragraph
                type="secondary"
                style={{ fontSize: 12, margin: '4px 0 0' }}
                ellipsis={expandedId === entry.id ? false : { rows: 2 }}
              >
                {entry.summary}
              </Typography.Paragraph>
            )}
            {entry.tags.length > 0 && (
              <div style={{ marginTop: 6 }}>
                {entry.tags.map((t) => (
                  <Tag key={t} color="blue">
                    {t}
                  </Tag>
                ))}
              </div>
            )}

            {expandedId === entry.id && detail && (
              <div
                style={{ marginTop: 10 }}
                onClick={(e) => e.stopPropagation()}
              >
                <Typography.Text strong style={{ display: 'block', margin: '8px 0 4px' }}>
                  备注
                </Typography.Text>
                <Input.TextArea
                  rows={2}
                  value={editNote}
                  onChange={(e) => setEditNote(e.target.value)}
                />

                <Typography.Text strong style={{ display: 'block', margin: '8px 0 4px' }}>
                  标签
                </Typography.Text>
                <Select
                  mode="tags"
                  style={{ width: '100%' }}
                  value={editTags}
                  onChange={(tags) => setEditTags(tags.slice(0, 5))}
                  open={false}
                  suffixIcon={null}
                  tokenSeparators={[',', '，']}
                />

                <Space style={{ marginTop: 10 }}>
                  <Button
                    size="small"
                    icon={<ExportOutlined />}
                    onClick={() => window.open(detail.url, '_blank')}
                  >
                    打开网页
                  </Button>
                  {onChat && (
                    <Button
                      size="small"
                      icon={<MessageOutlined />}
                      onClick={() => onChat(entry.id)}
                    >
                      对话
                    </Button>
                  )}
                  <Button
                    size="small"
                    type="primary"
                    ghost
                    icon={<SaveOutlined />}
                    onClick={() => void handleSaveEdit()}
                  >
                    保存修改
                  </Button>
                </Space>
              </div>
            )}
          </Card>
        ))
      )}
    </Space>
  );
}
