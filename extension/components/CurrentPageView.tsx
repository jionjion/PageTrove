import { useEffect, useState } from 'react';
import { browser } from 'wxt/browser';
import { Alert, Button, Card, Input, Space, Typography } from 'antd';
import {
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
      <Alert
        type="info"
        showIcon
        message="当前页面是浏览器内部页面，不支持采集"
        description="请切换到普通网页后再使用。"
      />
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

      <Card size="small" title="为什么收藏它？">
        <Input.TextArea
          rows={3}
          placeholder="写一句备注，也会作为 AI 整理的参考…"
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </Card>

      <Button
        type="primary"
        block
        icon={<RobotOutlined />}
        loading={busy === 'extract' || busy === 'analyze'}
        disabled={busy === 'save'}
        onClick={() => void handleAnalyze()}
      >
        {busy === 'extract'
          ? '正在读取网页…'
          : busy === 'analyze'
            ? 'AI 整理中…'
            : '读取并整理当前网页'}
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
        <AnalyzeResultEditor value={analysis} onChange={setAnalysis} />
      )}

      {duplicate && (
        <Alert
          type="warning"
          showIcon
          message="这个网站之前已经收藏过"
          description={duplicate.title}
          action={
            <Space direction="vertical" size={4}>
              <Button
                size="small"
                type="primary"
                loading={busy === 'save'}
                onClick={() => void handleUpdateExisting()}
              >
                更新原收藏
              </Button>
              <Button size="small" onClick={() => setDuplicate(undefined)}>
                取消
              </Button>
            </Space>
          }
        />
      )}

      {saved && <Alert type="success" showIcon message="已保存到藏宝库" />}

      <Button
        block
        type="primary"
        ghost
        icon={<SaveOutlined />}
        loading={busy === 'save'}
        disabled={busy === 'extract' || busy === 'analyze' || !tab.url || saved}
        onClick={() => void handleSave()}
      >
        保存到藏宝库
      </Button>
    </Space>
  );
}
