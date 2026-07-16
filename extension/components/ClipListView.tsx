import { useCallback, useEffect, useState } from 'react';
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
  const [tag, setTag] = useState('');
  const [category, setCategory] = useState('');
  const [facets, setFacets] = useState<{ tags: string[]; categories: string[] }>({
    tags: [],
    categories: [],
  });

  const [expandedId, setExpandedId] = useState<string>();
  const [detail, setDetail] = useState<WebClip>();
  const [editNote, setEditNote] = useState('');
  const [editTags, setEditTags] = useState('');
  const [error, setError] = useState<string>();

  const refresh = useCallback(async () => {
    setEntries(
      await queryClips({
        keyword: keyword || undefined,
        tag: tag || undefined,
        category: category || undefined,
      }),
    );
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
      setEditTags(clip.tags.join(', '));
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm('确定删除这条收藏吗？')) return;
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
        tags: editTags
          .split(/[,，]/)
          .map((t) => t.trim())
          .filter(Boolean),
      });
      setDetail(next);
      await refresh();
    } catch (e) {
      setError(toErrorMessage(e));
    }
  };

  return (
    <div className="clip-list">
      <div className="filters">
        <input
          type="search"
          placeholder="搜索标题 / 域名 / 标签…"
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
        />
        <div className="filter-row">
          <select value={tag} onChange={(e) => setTag(e.target.value)}>
            <option value="">全部标签</option>
            {facets.tags.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          <select value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="">全部分类</option>
            {facets.categories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
      </div>

      {error && <div className="message error">{error}</div>}

      {entries.length === 0 ? (
        <div className="empty-state">
          <p>还没有收藏。</p>
          <p>去「当前网页」标签页收藏第一个网站吧。</p>
        </div>
      ) : (
        <ul className="clips">
          {entries.map((entry) => (
            <li key={entry.id} className="clip-item">
              <div
                className="clip-head"
                onClick={() => void openDetail(entry.id)}
              >
                {entry.faviconUrl && (
                  <img className="favicon" src={entry.faviconUrl} alt="" />
                )}
                <div className="clip-head-text">
                  <div className="clip-title">{entry.title}</div>
                  <div className="clip-meta">
                    {entry.domain}
                    {entry.category ? ` · ${entry.category}` : ''}
                    {' · '}
                    {entry.createdAt.slice(0, 10)}
                  </div>
                  {entry.summary && (
                    <div className="clip-summary">{entry.summary}</div>
                  )}
                  {entry.tags.length > 0 && (
                    <div className="clip-tags">
                      {entry.tags.map((t) => (
                        <span key={t} className="tag">
                          {t}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {expandedId === entry.id && detail && (
                <div className="clip-detail">
                  {detail.interestingPoints.length > 0 && (
                    <>
                      <div className="field-label">好玩的地方</div>
                      <ul className="point-list">
                        {detail.interestingPoints.map((p, i) => (
                          <li key={i}>{p}</li>
                        ))}
                      </ul>
                    </>
                  )}
                  {detail.inspiration.length > 0 && (
                    <>
                      <div className="field-label">值得借鉴</div>
                      <ul className="point-list">
                        {detail.inspiration.map((p, i) => (
                          <li key={i}>{p}</li>
                        ))}
                      </ul>
                    </>
                  )}

                  <div className="field-label">备注</div>
                  <textarea
                    rows={2}
                    value={editNote}
                    onChange={(e) => setEditNote(e.target.value)}
                  />

                  <div className="field-label">标签（逗号分隔）</div>
                  <input
                    type="text"
                    value={editTags}
                    onChange={(e) => setEditTags(e.target.value)}
                  />

                  <div className="btn-row">
                    <button
                      className="btn"
                      onClick={() => window.open(detail.url, '_blank')}
                    >
                      打开网页
                    </button>
                    <button className="btn" onClick={() => void handleSaveEdit()}>
                      保存修改
                    </button>
                    <button
                      className="btn danger"
                      onClick={() => void handleDelete(entry.id)}
                    >
                      删除
                    </button>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
