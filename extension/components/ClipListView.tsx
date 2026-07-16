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

export function ClipListView() {
  const [entries, setEntries] = useState<ClipIndexEntry[]>([]);
  const [keyword, setKeyword] = useState('');
  const [tag, setTag] = useState<string>();
  const [category, setCategory] = useState<string>();
  const [facets, setFacets] = useState<{ tags: string[]; categories: string[] }>({
    tags: [],
    categories: [],
  });

  const [expandedId, setExpandedId] = useState<string>();
  const [detail, setDetail] = useState<WebClip>();
  const [editNote, setEditNote] = useState('');
  const [editTags, setEditTags] = useState<string[]>([]);
  const [error, setError] = useState<string>();

  const refresh = useCallback(async () => {
    setEntries(await queryClips({ keyword: keyword || undefined, tag, category }));
    setFacets(await collectFacets());
  }, [keyword, tag, category]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

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
      <Space.Compact block>
        <Select
          style={{ flex: 1 }}
          placeholder="全部标签"
          allowClear
          value={tag}
          onChange={setTag}
          options={facets.tags.map((t) => ({ value: t, label: t }))}
        />
        <Select
          style={{ flex: 1 }}
          placeholder="全部分类"
          allowClear
          value={category}
          onChange={setCategory}
          options={facets.categories.map((c) => ({ value: c, label: c }))}
        />
      </Space.Compact>

      {error && <Alert type="error" showIcon message={error} closable />}

      {entries.length === 0 ? (
        <Empty description="还没有收藏，去「当前网页」收藏第一个网站吧" />
      ) : (
        entries.map((entry) => (
          <Card
            key={entry.id}
            size="small"
            hoverable
            styles={{ body: { padding: '10px 12px' } }}
            onClick={() => void openDetail(entry.id)}
          >
            <div className="page-title-row">
              {entry.faviconUrl && (
                <img className="favicon" src={entry.faviconUrl} alt="" />
              )}
              <Typography.Text strong ellipsis={{ tooltip: entry.title }}>
                {entry.title}
              </Typography.Text>
            </div>
            <Typography.Text type="secondary" style={{ fontSize: 11 }}>
              {entry.domain}
              {entry.category ? ` · ${entry.category}` : ''}
              {' · '}
              {entry.createdAt.slice(0, 10)}
            </Typography.Text>
            {entry.summary && (
              <Typography.Paragraph style={{ margin: '4px 0 0' }}>
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
                {detail.interestingPoints.length > 0 && (
                  <>
                    <Typography.Text strong>好玩的地方</Typography.Text>
                    <ul className="point-list">
                      {detail.interestingPoints.map((p, i) => (
                        <li key={i}>{p}</li>
                      ))}
                    </ul>
                  </>
                )}
                {detail.inspiration.length > 0 && (
                  <>
                    <Typography.Text strong>值得借鉴</Typography.Text>
                    <ul className="point-list">
                      {detail.inspiration.map((p, i) => (
                        <li key={i}>{p}</li>
                      ))}
                    </ul>
                  </>
                )}

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
                  onChange={(tags) => setEditTags(tags.slice(0, 6))}
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
                  <Button
                    size="small"
                    icon={<SaveOutlined />}
                    onClick={() => void handleSaveEdit()}
                  >
                    保存修改
                  </Button>
                  <Popconfirm
                    title="确定删除这条收藏吗？"
                    okText="删除"
                    cancelText="取消"
                    okButtonProps={{ danger: true }}
                    onConfirm={() => void handleDelete(entry.id)}
                  >
                    <Button size="small" danger icon={<DeleteOutlined />}>
                      删除
                    </Button>
                  </Popconfirm>
                </Space>
              </div>
            )}
          </Card>
        ))
      )}
    </Space>
  );
}
