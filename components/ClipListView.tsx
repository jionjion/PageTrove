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
  Tag,
  Tooltip,
  Typography,
} from 'antd';
import {
  DeleteOutlined,
  DownloadOutlined,
  ExperimentOutlined,
  ExportOutlined,
  MessageOutlined,
  SaveOutlined,
} from '@ant-design/icons';
import type { ClipIndexEntry, WebClip } from '@/types/clip';
import type { ChatScope } from '@/types/chat';
import {
  collectFacets,
  getClip,
  getClipsByIds,
  queryClips,
  removeClip,
  updateClip,
} from '@/services/clip-store';
import {
  searchClipContents,
  parseQueryTerms,
} from '@/services/content-search';
import { onDataChanged } from '@/services/data-events';
import {
  downloadClipMarkdown,
  downloadClipsArchive,
} from '@/services/obsidian-export';
import { toErrorMessage } from '@/utils/errors';

const MIN_RESEARCH = 2;
const MAX_RESEARCH = 5;
const SEARCH_DEBOUNCE_MS = 250;

interface Props {
  /** 视图是否可见；变为可见时刷新列表 */
  active: boolean;
  /** 点击"对话"按钮时回调，切换到对话标签页 */
  onChat?: (clipId: string) => void;
  /** 选择模式下点击"探究"时回调，携带收藏来源范围 */
  onResearch?: (scope: ChatScope) => void;
}

export function ClipListView({ active, onChat, onResearch }: Props) {
  const [entries, setEntries] = useState<ClipIndexEntry[]>([]);
  const [keyword, setKeyword] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [facets, setFacets] = useState<{ tags: string[] }>({ tags: [] });
  /** 全文搜索命中片段：clipId -> 片段 */
  const [excerpts, setExcerpts] = useState<Record<string, string>>({});

  const [expandedId, setExpandedId] = useState<string>();
  const [detail, setDetail] = useState<WebClip>();
  const [editNote, setEditNote] = useState('');
  const [editTags, setEditTags] = useState<string[]>([]);
  const [error, setError] = useState<string>();

  /** 选择模式 */
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  /** 全文搜索缓存与请求序号 */
  const detailCacheRef = useRef<Map<string, WebClip>>(new Map());
  const requestIdRef = useRef(0);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  const runSearch = useCallback(async (query: string, tagFilter: string[]) => {
    const requestId = ++requestIdRef.current;
    const index = await queryClips({ tags: tagFilter });

    const terms = parseQueryTerms(query);
    if (terms.length === 0) {
      if (requestId !== requestIdRef.current) return;
      setEntries(index);
      setExcerpts({});
      return;
    }

    // 先用索引字段过滤：索引已命中的无需读详情即可显示，
    // 未命中的读取详情做正文级搜索。
    const cache = detailCacheRef.current;
    const missingIds = index
      .filter((entry) => !cache.has(entry.id))
      .map((entry) => entry.id);
    if (missingIds.length > 0) {
      const loaded = await getClipsByIds(missingIds);
      for (const clip of loaded) cache.set(clip.id, clip);
    }
    if (requestId !== requestIdRef.current) return;

    const clips = index
      .map((entry) => cache.get(entry.id))
      .filter((clip): clip is WebClip => Boolean(clip));
    const hits = searchClipContents(clips, query);
    if (requestId !== requestIdRef.current) return;

    const order = new Map(hits.map((hit, position) => [hit.id, position]));
    const nextExcerpts: Record<string, string> = {};
    for (const hit of hits) {
      if (hit.excerpt) nextExcerpts[hit.id] = hit.excerpt;
    }
    setEntries(
      index
        .filter((entry) => order.has(entry.id))
        .sort((a, b) => order.get(a.id)! - order.get(b.id)!),
    );
    setExcerpts(nextExcerpts);
  }, []);

  const refresh = useCallback(async () => {
    setFacets(await collectFacets());
    await runSearch(keyword, tags);
  }, [keyword, tags, runSearch]);

  // 收藏数据变化时使详情缓存失效；视图可见时刷新列表
  useEffect(() => {
    return onDataChanged('clips', () => {
      detailCacheRef.current.clear();
      if (active) void refresh();
    });
  }, [active, refresh]);

  useEffect(() => {
    if (!active) return;
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => void refresh(), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(debounceRef.current);
  }, [active, refresh]);

  const openDetail = async (id: string) => {
    if (selecting) {
      toggleSelect(id);
      return;
    }
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
      // 删除后同步移除选中状态
      setSelected((current) => {
        if (!current.has(id)) return current;
        const next = new Set(current);
        next.delete(id);
        return next;
      });
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

  const toggleSelect = (id: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const exitSelecting = () => {
    setSelecting(false);
    setSelected(new Set());
  };

  const handleExportSingle = async (clip: WebClip) => {
    try {
      downloadClipMarkdown(clip);
    } catch (e) {
      setError(toErrorMessage(e) || '生成 Obsidian 文件失败');
    }
  };

  const handleExportSelected = async () => {
    try {
      const ids = [...selected];
      if (ids.length === 0) {
        setError('没有可导出的收藏');
        return;
      }
      const clips = await getClipsByIds(ids);
      if (clips.length === 0) {
        setError('选中的收藏已被删除');
        return;
      }
      if (clips.length === 1) {
        downloadClipMarkdown(clips[0]);
      } else {
        downloadClipsArchive(clips);
      }
    } catch (e) {
      setError(toErrorMessage(e) || '生成 Obsidian 文件失败');
    }
  };

  const handleResearchSelected = async () => {
    const ids = [...selected];
    if (ids.length < MIN_RESEARCH) {
      setError('至少选择 2 条收藏开始探究');
      return;
    }
    if (ids.length > MAX_RESEARCH) {
      setError('最多只能选择 5 个来源');
      return;
    }
    const clips = await getClipsByIds(ids);
    if (clips.length < MIN_RESEARCH) {
      setError('选中的收藏已被删除');
      return;
    }
    const scope: ChatScope = {
      mode: 'clips',
      sources: clips.map((clip) => ({
        id: crypto.randomUUID(),
        type: 'clip',
        clipId: clip.id,
        title: clip.title,
        url: clip.url,
        faviconUrl: clip.faviconUrl,
      })),
    };
    exitSelecting();
    onResearch?.(scope);
  };

  return (
    <Space direction="vertical" size={10} style={{ display: 'flex' }}>
      <Input.Search
        placeholder="搜索标题 / 标签 / 备注 / 正文…"
        allowClear
        value={keyword}
        onChange={(e) => setKeyword(e.target.value)}
      />
      <div style={{ display: 'flex', gap: 8 }}>
        <Select
          mode="multiple"
          style={{ flex: 1, minWidth: 0 }}
          placeholder="全部标签"
          allowClear
          maxTagCount="responsive"
          value={tags}
          onChange={setTags}
          options={facets.tags.map((t) => ({ value: t, label: t }))}
        />
        <Button
          size="middle"
          type={selecting ? 'primary' : 'default'}
          onClick={() => (selecting ? exitSelecting() : setSelecting(true))}
        >
          {selecting ? '取消' : '选择'}
        </Button>
      </div>

      {selecting && (
        <div className="clip-select-toolbar">
          <Typography.Text>已选 {selected.size} 条</Typography.Text>
          <Space size={6}>
            <Button size="small" onClick={() => setSelected(new Set())}>
              清空
            </Button>
            {onResearch && (
              <Button
                size="small"
                icon={<ExperimentOutlined />}
                disabled={
                  selected.size < MIN_RESEARCH || selected.size > MAX_RESEARCH
                }
                onClick={() => void handleResearchSelected()}
              >
                探究
              </Button>
            )}
            <Tooltip title="导出文件可能包含你保存的网页内容和备注">
              <Button
                size="small"
                icon={<DownloadOutlined />}
                disabled={selected.size === 0}
                onClick={() => void handleExportSelected()}
              >
                导出
              </Button>
            </Tooltip>
          </Space>
        </div>
      )}

      {error && (
        <Alert
          type="error"
          showIcon
          title={error}
          closable={{ onClose: () => setError(undefined) }}
        />
      )}

      {entries.length === 0 ? (
        <Empty description="还没有收藏，点上方 ☆ 收藏当前网页吧" />
      ) : (
        entries.map((entry) => (
          <Card
            key={entry.id}
            size="small"
            hoverable
            className={
              selecting && selected.has(entry.id)
                ? 'clip-card-selected'
                : undefined
            }
            styles={{ body: { padding: '8px 12px' } }}
            onClick={() => void openDetail(entry.id)}
          >
            {selecting && selected.has(entry.id) && (
              <span className="clip-select-corner" />
            )}
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
              {!selecting && (
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
              )}
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
            {excerpts[entry.id] && (
              <div className="clip-hit-excerpt">{excerpts[entry.id]}</div>
            )}
            {entry.tags.length > 0 && (
              <div className="clip-tag-row">
                {entry.tags.map((t) => (
                  <Tag key={t} color="blue" style={{ margin: 0 }}>
                    {t}
                  </Tag>
                ))}
              </div>
            )}

            {expandedId === entry.id && detail && !selecting && (
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

                <Space style={{ marginTop: 10 }} wrap>
                  <Button
                    size="small"
                    icon={<ExportOutlined />}
                    onClick={() => {
                      if (detail) window.open(detail.url, '_blank');
                    }}
                  >
                    打开网页
                  </Button>
                  {onChat && (
                    <Button
                      size="small"
                      icon={<MessageOutlined />}
                      onClick={() => onChat?.(entry.id)}
                    >
                      对话
                    </Button>
                  )}
                  <Tooltip title="导出文件可能包含你保存的网页内容和备注">
                    <Button
                      size="small"
                      icon={<DownloadOutlined />}
                      onClick={() => void handleExportSingle(detail)}
                    >
                      导出 Markdown
                    </Button>
                  </Tooltip>
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
