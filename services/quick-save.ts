import { browser, type Browser } from 'wxt/browser';
import type { WebClip } from '@/types/clip';
import type { PageSnapshot } from '@/types/page-snapshot';
import type { ExtensionSettings } from '@/types/settings';
import { getSettings } from '@/services/settings-store';
import { extractPage } from '@/services/page-extractor';
import { analyzePage } from '@/services/ai/analyze-page';
import { createClip, findByNormalizedUrl, updateClip } from '@/services/clip-store';
import { isUnsupportedUrl, normalizeUrl } from '@/services/url-utils';
import { showSaveToast } from '@/services/save-toast';
import { toErrorMessage } from '@/utils/errors';

/**
 * 快捷键一键收录:提取 → 查重(绝不覆盖)→ 立即落库 → 异步 AI 整理。
 * 保存不等 AI,反馈即时;整理失败静默,因为收藏本体已经保存成功。
 */

export type QuickSaveStatus = 'saved' | 'duplicate' | 'busy' | 'unsupported' | 'error';

export interface QuickSaveResult {
  status: QuickSaveStatus;
  clipId?: string;
  title?: string;
  message?: string;
}

/** 全局单飞锁:连按快捷键不产生第二条记录,忙时再按只刷新提示。 */
let inFlight = false;

async function resolveTab(tabId?: number): Promise<Browser.tabs.Tab | undefined> {
  if (typeof tabId === 'number') {
    try {
      return await browser.tabs.get(tabId);
    } catch {
      return undefined;
    }
  }
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  return tab;
}

function buildClip(snapshot: PageSnapshot, tab: Browser.tabs.Tab): WebClip {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    url: snapshot.url,
    canonicalUrl: snapshot.canonicalUrl,
    normalizedUrl: normalizeUrl(snapshot.url, snapshot.canonicalUrl),
    domain: snapshot.domain,
    title: snapshot.title || tab.title || snapshot.url,
    description: snapshot.description,
    faviconUrl: snapshot.favicon ?? tab.favIconUrl,
    tags: [],
    selectedText: snapshot.selectedText,
    extractedText: snapshot.mainText,
    createdAt: now,
    updatedAt: now,
  };
}

/** 异步整理:只回填摘要/标签/正文;收藏可能已被删除,失败一律静默。 */
function scheduleAnalyze(
  clipId: string,
  snapshot: PageSnapshot,
  settings: ExtensionSettings,
): void {
  void analyzePage(snapshot, '', settings, false)
    .then((result) =>
      updateClip(clipId, {
        summary: result.summary,
        tags: result.tags,
        ...(result.content ? { extractedText: result.content } : {}),
      }),
    )
    .catch(() => {});
}

export async function runQuickSave(tabId?: number): Promise<QuickSaveResult> {
  const tab = await resolveTab(tabId);
  const effectiveTabId = tab?.id ?? tabId;

  if (inFlight) {
    if (typeof effectiveTabId === 'number') {
      void showSaveToast(effectiveTabId, {
        state: 'saving',
        title: '正在收录…',
        sub: '请稍候，马上就好',
      });
    }
    return { status: 'busy' };
  }

  if (!tab || typeof tab.id !== 'number' || !tab.url) {
    return { status: 'error', message: '无法获取当前网页' };
  }
  if (isUnsupportedUrl(tab.url)) {
    void showSaveToast(tab.id, {
      state: 'error',
      title: '此页面无法收录',
      sub: '浏览器内部页面不支持采集',
    });
    return { status: 'unsupported' };
  }

  inFlight = true;
  void showSaveToast(tab.id, {
    state: 'saving',
    title: '正在收录…',
    sub: tab.title || tab.url,
  });

  try {
    const settings = await getSettings();
    const snapshot = await extractPage(
      {
        maxContentLength: settings.maxContentLength,
        includeSelectedText: settings.includeSelectedText,
      },
      tab.id,
    );
    const clip = buildClip(snapshot, tab);

    const existing = await findByNormalizedUrl(clip.normalizedUrl);
    if (existing) {
      void showSaveToast(tab.id, {
        state: 'duplicate',
        title: '已在收藏中',
        sub: existing.title,
      });
      return { status: 'duplicate', clipId: existing.id, title: existing.title };
    }

    await createClip(clip);
    const autoAnalyze = settings.shortcutAutoAnalyze && Boolean(settings.apiKey.trim());
    void showSaveToast(tab.id, {
      state: 'success',
      title: `已收录 · ${clip.title}`,
      sub: autoAnalyze ? 'AI 整理中…' : undefined,
    });
    if (autoAnalyze) scheduleAnalyze(clip.id, snapshot, settings);
    return { status: 'saved', clipId: clip.id, title: clip.title };
  } catch (error) {
    const message = toErrorMessage(error);
    void showSaveToast(tab.id, { state: 'error', title: '收录失败', sub: message });
    return { status: 'error', message };
  } finally {
    inFlight = false;
  }
}
