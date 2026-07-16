import { useEffect, useState } from 'react';
import { browser } from 'wxt/browser';
import { Alert, Button, Card, Input, Space, Typography } from 'antd';
import {
  CheckOutlined,
  RobotOutlined,
  SaveOutlined,
  SettingOutlined,
} from '@ant-design/icons';
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
      tags: analysis?.tags ?? [],

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
              tags: analysis.tags,
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
      <div className="empty-hint">
        <div>这是浏览器内部页面，无法收藏</div>
        <div>切换到普通网页再来吧</div>
      </div>
    );
  }

  return (
    <Space direction="vertical" size={10} style={{ display: 'flex' }}>
      <Card size="small">
        <div className="page-title-row">
          {tab.favIconUrl && (
            <img className="favicon" src={tab.favIconUrl} alt="" />
          )}
          <Typography.Text strong ellipsis={{ tooltip: tab.title }}>
            {tab.title || '（无标题）'}
          </Typography.Text>
        </div>
        <Typography.Text type="secondary">{tab.domain}</Typography.Text>
        <Typography.Paragraph
          type="secondary"
          style={{ fontSize: 11, margin: 0 }}
          ellipsis={{ tooltip: tab.url }}
        >
          {tab.url}
        </Typography.Paragraph>
      </Card>

      <Card size="small" title="想法">
        <Input.TextArea
          rows={3}
          placeholder="随便写点，AI 整理时会参考…"
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </Card>

      <Button
        type="primary"
        block
        icon={saved ? <CheckOutlined /> : analysis ? <SaveOutlined /> : <RobotOutlined />}
        loading={busy !== undefined}
        disabled={!tab.url || saved}
        onClick={() => void (analysis ? handleSave() : handleAnalyze())}
      >
        {busy === 'extract'
          ? '正在读取网页…'
          : busy === 'analyze'
            ? '整理中…'
            : saved
              ? '已收藏'
              : analysis
                ? '收藏'
                : '整理'}
      </Button>

      {error && (
        <Alert
          type="error"
          showIcon
          message={error}
          action={
            missingKey && (
              <Button
                size="small"
                icon={<SettingOutlined />}
                onClick={() => void browser.runtime.openOptionsPage()}
              >
                前往设置
              </Button>
            )
          }
        />
      )}

      {analysis && (
        <AnalyzeResultEditor
          value={analysis}
          onChange={setAnalysis}
          onRetry={() => void handleAnalyze()}
        />
      )}

      {duplicate && (
        <Card size="small">
          <Typography.Text strong style={{ display: 'block' }}>
            这个网页已经收藏过
          </Typography.Text>
          <Typography.Text
            type="secondary"
            style={{ fontSize: 12, display: 'block', marginTop: 2 }}
            ellipsis={{ tooltip: duplicate.title }}
          >
            {duplicate.title}
          </Typography.Text>
          <Space style={{ marginTop: 10 }}>
            <Button
              size="small"
              type="primary"
              ghost
              loading={busy === 'save'}
              onClick={() => void handleUpdateExisting()}
            >
              更新原收藏
            </Button>
            <Button size="small" onClick={() => setDuplicate(undefined)}>
              取消
            </Button>
          </Space>
        </Card>
      )}
    </Space>
  );
}
