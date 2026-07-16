import { useEffect, useState } from 'react';
import { browser } from 'wxt/browser';
import type { AnalyzeResult } from '@/types/ai';
import type { ClipIndexEntry, WebClip } from '@/types/clip';
import type { PageSnapshot } from '@/types/page-snapshot';
import { useCurrentTab } from '@/hooks/useCurrentTab';
import { extractCurrentPage } from '@/services/page-extractor';
import { analyzePage } from '@/services/deepseek-client';
import { getSettings } from '@/services/settings-store';
import {
  createClip,
  findByNormalizedUrl,
  updateClip,
} from '@/services/clip-store';
import { normalizeUrl } from '@/services/url-utils';
import { AppError, toErrorMessage } from '@/utils/errors';
import { AnalyzeResultEditor } from '@/components/AnalyzeResultEditor';

export function CurrentPageView() {
  const tab = useCurrentTab();

  const [note, setNote] = useState('');
  const [snapshot, setSnapshot] = useState<PageSnapshot>();
  const [analysis, setAnalysis] = useState<AnalyzeResult>();

  const [busy, setBusy] = useState<'extract' | 'analyze' | 'save'>();
  const [error, setError] = useState<string>();
  const [missingKey, setMissingKey] = useState(false);
  const [duplicate, setDuplicate] = useState<ClipIndexEntry>();
  const [saved, setSaved] = useState(false);

  // 切换网页时重置状态
  useEffect(() => {
    setNote('');
    setSnapshot(undefined);
    setAnalysis(undefined);
    setError(undefined);
    setMissingKey(false);
    setDuplicate(undefined);
    setSaved(false);
  }, [tab.url]);

  const handleAnalyze = async () => {
    setError(undefined);
    setMissingKey(false);
    setSaved(false);
    setDuplicate(undefined);

    const settings = await getSettings();

    setBusy('extract');
    let snap: PageSnapshot;
    try {
      snap = await extractCurrentPage({
        maxContentLength: settings.maxContentLength,
        includeSelectedText: settings.includeSelectedText,
      });
      setSnapshot(snap);
    } catch (e) {
      setError(toErrorMessage(e));
      setBusy(undefined);
      return;
    }

    setBusy('analyze');
    try {
      const result = await analyzePage(snap, note, settings);
      setAnalysis(result);
    } catch (e) {
      if (e instanceof AppError && e.code === 'MISSING_API_KEY') {
        setMissingKey(true);
      }
      setError(toErrorMessage(e));
    } finally {
      setBusy(undefined);
    }
  };

  const buildClip = (): WebClip => {
    const url = snapshot?.url ?? tab.url;
    const now = new Date().toISOString();
    return {
      id: crypto.randomUUID(),
      url,
      canonicalUrl: snapshot?.canonicalUrl,
      normalizedUrl: normalizeUrl(url, snapshot?.canonicalUrl),
      domain: snapshot?.domain ?? tab.domain,

      title: snapshot?.title || tab.title || url,
      description: snapshot?.description,
      faviconUrl: snapshot?.favicon ?? tab.favIconUrl,

      summary: analysis?.summary,
      interestingPoints: analysis?.interestingPoints ?? [],
      inspiration: analysis?.inspiration ?? [],
      tags: analysis?.tags ?? [],
      category: analysis?.category,

      userNote: note.trim() || undefined,
      selectedText: snapshot?.selectedText,
      extractedText: snapshot?.mainText,

      createdAt: now,
      updatedAt: now,
    };
  };

  const handleSave = async () => {
    setError(undefined);
    setSaved(false);
    setBusy('save');
    try {
      const clip = buildClip();
      const existing = await findByNormalizedUrl(clip.normalizedUrl);
      if (existing) {
        setDuplicate(existing);
        return;
      }
      await createClip(clip);
      setSaved(true);
    } catch (e) {
      setError(toErrorMessage(e));
    } finally {
      setBusy(undefined);
    }
  };

  const handleUpdateExisting = async () => {
    if (!duplicate) return;
    setBusy('save');
    try {
      await updateClip(duplicate.id, {
        userNote: note.trim() || undefined,
        ...(analysis
          ? {
              summary: analysis.summary,
              interestingPoints: analysis.interestingPoints,
              inspiration: analysis.inspiration,
              tags: analysis.tags,
              category: analysis.category,
            }
          : {}),
      });
      setDuplicate(undefined);
      setSaved(true);
    } catch (e) {
      setError(toErrorMessage(e));
    } finally {
      setBusy(undefined);
    }
  };

  if (tab.unsupported) {
    return (
      <div className="empty-state">
        <p>当前页面是浏览器内部页面，不支持采集。</p>
        <p>请切换到普通网页后再使用。</p>
      </div>
    );
  }

  return (
    <div className="current-page">
      <section className="card page-card">
        <div className="page-title-row">
          {tab.favIconUrl && (
            <img className="favicon" src={tab.favIconUrl} alt="" />
          )}
          <span className="page-title" title={tab.title}>
            {tab.title || '（无标题）'}
          </span>
        </div>
        <div className="page-domain">{tab.domain}</div>
        <div className="page-url" title={tab.url}>
          {tab.url}
        </div>
      </section>

      <section className="card">
        <label className="field-label" htmlFor="note">
          为什么收藏它？
        </label>
        <textarea
          id="note"
          rows={3}
          placeholder="写一句备注，也会作为 AI 整理的参考…"
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </section>

      <button
        className="btn primary"
        disabled={busy !== undefined}
        onClick={() => void handleAnalyze()}
      >
        {busy === 'extract'
          ? '正在读取网页…'
          : busy === 'analyze'
            ? 'AI 整理中…'
            : '读取并整理当前网页'}
      </button>

      {error && (
        <div className="message error">
          {error}
          {missingKey && (
            <button
              className="btn link"
              onClick={() => void browser.runtime.openOptionsPage()}
            >
              前往设置
            </button>
          )}
        </div>
      )}

      {analysis && (
        <AnalyzeResultEditor value={analysis} onChange={setAnalysis} />
      )}

      {duplicate && (
        <div className="message warning">
          <p>这个网站之前已经收藏过：{duplicate.title}</p>
          <div className="btn-row">
            <button
              className="btn"
              disabled={busy !== undefined}
              onClick={() => void handleUpdateExisting()}
            >
              更新原收藏
            </button>
            <button className="btn" onClick={() => setDuplicate(undefined)}>
              取消
            </button>
          </div>
        </div>
      )}

      {saved && <div className="message success">已保存到藏宝库 ✓</div>}

      <button
        className="btn primary save-btn"
        disabled={busy !== undefined || !tab.url || saved}
        onClick={() => void handleSave()}
      >
        {busy === 'save' ? '保存中…' : '保存到藏宝库'}
      </button>
    </div>
  );
}
