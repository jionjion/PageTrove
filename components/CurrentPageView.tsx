import { useEffect, useRef, useState } from 'react';
import { browser } from 'wxt/browser';
import { Alert, Button, Card, Checkbox, Input, Space, Tooltip, Typography } from 'antd';
import { SettingOutlined, StopOutlined } from '@ant-design/icons';
import type { AnalyzeResult } from '@/types/ai';
import type { ClipIndexEntry, WebClip } from '@/types/clip';
import type { PageSnapshot } from '@/types/page-snapshot';
import { type CurrentTabInfo, useCurrentTab } from '@/hooks/useCurrentTab';
import { assertPageSnapshotStillCurrent, extractPage } from '@/services/page-extractor';
import { analyzePage } from '@/services/ai/analyze-page';
import { getSettings } from '@/services/settings-store';
import { createClip, findByNormalizedUrl, updateClip } from '@/services/clip-store';
import { normalizeUrl } from '@/services/url-utils';
import { AppError, toErrorMessage } from '@/utils/errors';
import { AnalyzeResultEditor } from '@/components/AnalyzeResultEditor';
import { EmptyState } from '@/components/EmptyState';

type BusyState = 'extract' | 'analyze' | 'save';

function aborted(): DOMException {
  return new DOMException('操作已被新页面替代', 'AbortError');
}

export function CurrentPageView() {
  const tab = useCurrentTab();

  if (tab.unsupported) {
    return (
      <EmptyState
        icon={<StopOutlined />}
        title="浏览器内部页面，无法收藏"
        description="切换到普通网页再来吧"
      />
    );
  }

  return <CurrentPageContent key={`${tab.tabId ?? 'none'}:${tab.url}`} tab={tab} />;
}

function CurrentPageContent({ tab }: { tab: CurrentTabInfo }) {
  const operationRef = useRef<{ id: string; controller: AbortController }>();

  const [note, setNote] = useState('');
  const [refineContent, setRefineContent] = useState(false);
  const [snapshot, setSnapshot] = useState<PageSnapshot>();
  const [analysis, setAnalysis] = useState<AnalyzeResult>();
  const [busy, setBusy] = useState<BusyState>();
  const [error, setError] = useState<string>();
  const [missingKey, setMissingKey] = useState(false);
  const [duplicate, setDuplicate] = useState<ClipIndexEntry>();
  const [saved, setSaved] = useState(false);

  const beginOperation = () => {
    operationRef.current?.controller.abort(aborted());
    const operation = {
      id: crypto.randomUUID(),
      controller: new AbortController(),
    };
    operationRef.current = operation;
    return operation;
  };

  const isCurrentOperation = (id: string) => operationRef.current?.id === id;

  useEffect(
    () => () => {
      operationRef.current?.controller.abort(aborted());
      operationRef.current = undefined;
    },
    [],
  );

  const handleAnalyze = async () => {
    if (busy || typeof tab.tabId !== 'number') return;
    const operation = beginOperation();
    const tabId = tab.tabId;
    const tabUrl = tab.url;
    const currentNote = note;
    const shouldRefine = refineContent;
    setError(undefined);
    setMissingKey(false);
    setSaved(false);
    setDuplicate(undefined);
    setBusy('extract');

    try {
      const settings = await getSettings();
      operation.controller.signal.throwIfAborted();
      const snap = await extractPage(
        {
          maxContentLength: settings.maxContentLength,
          includeSelectedText: settings.includeSelectedText,
        },
        tabId,
      );
      operation.controller.signal.throwIfAborted();
      if (!isCurrentOperation(operation.id) || snap.url !== tabUrl) throw aborted();
      setBusy('analyze');

      const result = await analyzePage(
        snap,
        currentNote,
        settings,
        shouldRefine,
        operation.controller.signal,
      );
      operation.controller.signal.throwIfAborted();
      if (!isCurrentOperation(operation.id)) throw aborted();
      setSnapshot(snap);
      setAnalysis(result);
    } catch (caught) {
      if (!isCurrentOperation(operation.id)) return;
      if (caught instanceof AppError && caught.code === 'MISSING_API_KEY') {
        setMissingKey(true);
      }
      if (!(caught instanceof DOMException && caught.name === 'AbortError')) {
        setError(toErrorMessage(caught));
      }
    } finally {
      if (isCurrentOperation(operation.id)) {
        operationRef.current = undefined;
        setBusy(undefined);
      }
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
      extractedText: analysis?.content || snapshot?.mainText,
      createdAt: now,
      updatedAt: now,
    };
  };

  const handleSave = async () => {
    if (busy) return;
    const operation = beginOperation();
    const expectedUrl = tab.url;
    setError(undefined);
    setSaved(false);
    setBusy('save');
    try {
      const clip = buildClip();
      if (clip.url !== expectedUrl) throw new AppError('PAGE_EXTRACT_FAILED');
      if (snapshot && typeof tab.tabId === 'number') {
        await assertPageSnapshotStillCurrent(
          snapshot,
          tab.tabId,
          operation.controller.signal,
        );
      }
      const existing = await findByNormalizedUrl(clip.normalizedUrl);
      operation.controller.signal.throwIfAborted();
      if (!isCurrentOperation(operation.id)) throw aborted();
      if (existing) {
        setDuplicate(existing);
        return;
      }
      await createClip(clip, operation.controller.signal);
      operation.controller.signal.throwIfAborted();
      if (isCurrentOperation(operation.id)) setSaved(true);
    } catch (caught) {
      if (
        isCurrentOperation(operation.id) &&
        !(caught instanceof DOMException && caught.name === 'AbortError')
      ) {
        setError(toErrorMessage(caught));
      }
    } finally {
      if (isCurrentOperation(operation.id)) {
        operationRef.current = undefined;
        setBusy(undefined);
      }
    }
  };

  const handleUpdateExisting = async () => {
    if (!duplicate || busy) return;
    const operation = beginOperation();
    const target = duplicate;
    setBusy('save');
    try {
      if (snapshot && typeof tab.tabId === 'number') {
        await assertPageSnapshotStillCurrent(
          snapshot,
          tab.tabId,
          operation.controller.signal,
        );
      }
      await updateClip(
        target.id,
        {
          ...(note.trim() ? { userNote: note.trim() } : {}),
          ...(analysis
            ? {
                summary: analysis.summary,
                tags: analysis.tags,
                ...(analysis.content ? { extractedText: analysis.content } : {}),
              }
            : {}),
        },
        operation.controller.signal,
      );
      operation.controller.signal.throwIfAborted();
      if (isCurrentOperation(operation.id)) {
        setDuplicate(undefined);
        setSaved(true);
      }
    } catch (caught) {
      if (
        isCurrentOperation(operation.id) &&
        !(caught instanceof DOMException && caught.name === 'AbortError')
      ) {
        setError(toErrorMessage(caught));
      }
    } finally {
      if (isCurrentOperation(operation.id)) {
        operationRef.current = undefined;
        setBusy(undefined);
      }
    }
  };

  return (
    <Space direction="vertical" size={10} style={{ display: 'flex' }}>
      <Card size="small">
        <div className="page-title-row">
          {tab.favIconUrl && <img className="favicon" src={tab.favIconUrl} alt="" />}
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
          disabled={busy !== undefined}
          onChange={(event) => setNote(event.target.value)}
        />
      </Card>

      {!analysis && (
        <Tooltip title="整理时额外让 AI 提取正文主体、去掉广告导航等噪音，更耗 token">
          <Checkbox
            checked={refineContent}
            disabled={busy !== undefined}
            onChange={(event) => setRefineContent(event.target.checked)}
          >
            整理时清洗正文
          </Checkbox>
        </Tooltip>
      )}

      <Button
        type="primary"
        block
        loading={busy !== undefined}
        disabled={!tab.url || saved || busy !== undefined}
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
          title={error}
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
          disabled={busy !== undefined}
        />
      )}

      {duplicate && (
        <Card size="small">
          <Typography.Text strong style={{ display: 'block' }}>
            该网页已收藏
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
              disabled={busy !== undefined}
              onClick={() => void handleUpdateExisting()}
            >
              更新原收藏
            </Button>
            <Button
              size="small"
              disabled={busy !== undefined}
              onClick={() => setDuplicate(undefined)}
            >
              取消
            </Button>
          </Space>
        </Card>
      )}
    </Space>
  );
}
