import { useEffect, useState } from 'react';
import { Alert, Button, Checkbox, Empty, Typography } from 'antd';
import { browser } from 'wxt/browser';
import type { ChatScope, ChatSourceRef } from '@/types/chat';
import { extractPage } from '@/services/page-extractor';
import { getSettings } from '@/services/settings-store';
import { isUnsupportedUrl } from '@/services/url-utils';
import { MAX_SCOPE_TOTAL_CHARS } from '@/services/content-excerpts';
import { toErrorMessage } from '@/utils/errors';

const MIN_TABS = 2;
const MAX_TABS = 5;

interface TabItem {
  tabId: number;
  title: string;
  url: string;
  favicon?: string;
  domain: string;
}

interface Props {
  /** 视图是否可见；变为可见时刷新标签页列表 */
  active: boolean;
  /** 采集成功后回调，切换到探究会话 */
  onStart: (scope: ChatScope) => void;
}

export function ResearchSetupView({ active, onStart }: Props) {
  const [tabs, setTabs] = useState<TabItem[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [collecting, setCollecting] = useState(false);
  const [error, setError] = useState<string>();
  const [failures, setFailures] = useState<string[]>([]);
  /** 部分失败但可继续时暂存的成功来源 */
  const [partialSources, setPartialSources] = useState<ChatSourceRef[]>();

  const loadTabs = async () => {
    setError(undefined);
    setFailures([]);
    setPartialSources(undefined);
    const all = await browser.tabs.query({ currentWindow: true });
    const items: TabItem[] = [];
    let activeTabId: number | undefined;
    for (const tab of all) {
      if (!tab.id || !tab.url) continue;
      if (!/^https?:/.test(tab.url) || isUnsupportedUrl(tab.url)) continue;
      let domain = '';
      try {
        domain = new URL(tab.url).hostname;
      } catch {
        continue;
      }
      if (tab.active) activeTabId = tab.id;
      items.push({
        tabId: tab.id,
        title: tab.title ?? tab.url,
        url: tab.url,
        favicon: tab.favIconUrl,
        domain,
      });
    }
    setTabs(items);
    setSelected(new Set(activeTabId !== undefined ? [activeTabId] : []));
  };

  useEffect(() => {
    if (active) void loadTabs();
  }, [active]);

  const toggle = (tabId: number) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(tabId)) {
        next.delete(tabId);
      } else if (next.size < MAX_TABS) {
        next.add(tabId);
      }
      return next;
    });
  };

  const handleStart = async () => {
    if (collecting) return;
    if (selected.size < MIN_TABS) {
      setError('至少选择 2 个网页开始探究');
      return;
    }
    setError(undefined);
    setFailures([]);
    setPartialSources(undefined);
    setCollecting(true);

    try {
      const settings = await getSettings();
      const chosen = tabs.filter((tab) => selected.has(tab.tabId));
      const perPage = Math.min(
        settings.maxContentLength,
        Math.floor(MAX_SCOPE_TOTAL_CHARS / chosen.length),
      );

      const results = await Promise.allSettled(
        chosen.map(async (item): Promise<ChatSourceRef> => {
          // 采集前再次核对 URL，页面已导航时不静默读取新页面。
          const tab = await browser.tabs.get(item.tabId);
          if (tab.url !== item.url) {
            throw new Error('页面已变化');
          }
          const snapshot = await extractPage(
            { maxContentLength: perPage, includeSelectedText: false },
            item.tabId,
          );
          return {
            id: crypto.randomUUID(),
            type: 'page',
            title: snapshot.title || item.title,
            url: snapshot.url,
            faviconUrl: item.favicon,
            content: [snapshot.description, snapshot.mainText]
              .filter(Boolean)
              .join('\n'),
            capturedAt: new Date().toISOString(),
          };
        }),
      );

      const sources: ChatSourceRef[] = [];
      const failed: string[] = [];
      results.forEach((result, index) => {
        if (result.status === 'fulfilled') sources.push(result.value);
        else failed.push(chosen[index].title);
      });

      if (sources.length < MIN_TABS) {
        setFailures(failed);
        setError('部分网页无法读取，请移除后重试');
        return;
      }
      if (failed.length > 0) {
        // 有失败但仍有 >=2 个成功来源：展示失败列表，等用户确认继续。
        setFailures(failed);
        setPartialSources(sources);
        return;
      }
      onStart({ mode: 'tabs', sources });
    } catch (caught) {
      setError(toErrorMessage(caught));
    } finally {
      setCollecting(false);
    }
  };

  return (
    <div className="research-setup">
      <Typography.Title level={5} style={{ margin: '0 0 4px' }}>
        探究多个网页
      </Typography.Title>
      <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
        选择当前窗口中的网页，只有确认后才会读取正文。
        只有你勾选并确认的网页会被读取；正文仅在你发送问题时交给当前模型。
      </Typography.Paragraph>

      {error && (
        <Alert
          type="error"
          showIcon
          title={error}
          closable={{ onClose: () => setError(undefined) }}
          style={{ marginBottom: 8 }}
        />
      )}
      {failures.length > 0 && (
        <Alert
          type="warning"
          showIcon
          title={`无法读取：${failures.join('、')}`}
          style={{ marginBottom: 8 }}
        />
      )}

      {tabs.length === 0 ? (
        <Empty description="当前窗口没有可读取的普通网页" />
      ) : (
        <div className="research-tab-list">
          {tabs.map((tab) => (
            <label className="research-tab-item" key={tab.tabId}>
              <Checkbox
                checked={selected.has(tab.tabId)}
                disabled={
                  !selected.has(tab.tabId) && selected.size >= MAX_TABS
                }
                onChange={() => toggle(tab.tabId)}
              />
              {tab.favicon && (
                <img className="favicon" src={tab.favicon} alt="" />
              )}
              <span className="research-tab-title" title={tab.url}>
                {tab.title}
              </span>
              <span className="research-tab-domain">{tab.domain}</span>
            </label>
          ))}
        </div>
      )}

      <div className="research-footer">
        <Typography.Text type="secondary">
          已选择 {selected.size} / {MAX_TABS}
        </Typography.Text>
        {partialSources ? (
          <Button
            type="primary"
            onClick={() => onStart({ mode: 'tabs', sources: partialSources })}
          >
            忽略失败页面，继续探究（{partialSources.length} 个）
          </Button>
        ) : (
          <Button
            type="primary"
            loading={collecting}
            disabled={selected.size < MIN_TABS}
            onClick={() => void handleStart()}
          >
            开始探究
          </Button>
        )}
      </div>
    </div>
  );
}
