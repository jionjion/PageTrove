import { browser, type Browser } from 'wxt/browser';
import type { WebClip } from '@/types/clip';
import type { PageSnapshot } from '@/types/page-snapshot';
import type { ExtensionSettings } from '@/types/settings';
import { getSettings } from '@/services/settings-store';
import { extractFromUrl, extractPage } from '@/services/page-extractor';
import { analyzePage } from '@/services/ai/analyze-page';
import { createClip, findByNormalizedUrl, updateClip } from '@/services/clip-store';
import { isUnsupportedUrl, normalizeUrl } from '@/services/url-utils';
import { showSaveToast, type SaveToastPayload } from '@/services/save-toast';
import { AppError, toErrorMessage } from '@/utils/errors';

/**
 * 一键收录(快捷键 / 右键菜单):提取 → 查重(绝不覆盖)→ 立即落库 → 异步 AI 整理。
 * 保存不等 AI,反馈即时;整理失败静默,因为收藏本体已经保存成功。
 * 链接收录离线抓取目标页,抓取失败降级为只保存链接。
 */

export type QuickSaveStatus = 'saved' | 'duplicate' | 'busy' | 'unsupported' | 'error';

export interface QuickSaveResult {
  status: QuickSaveStatus;
  clipId?: string;
  title?: string;
  message?: string;
  /** 链接收录:目标页抓取失败,仅保存了链接 */
  degraded?: boolean;
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

function buildClip(
  snapshot: PageSnapshot,
  fallback?: { title?: string; faviconUrl?: string },
): WebClip {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    url: snapshot.url,
    canonicalUrl: snapshot.canonicalUrl,
    normalizedUrl: normalizeUrl(snapshot.url, snapshot.canonicalUrl),
    domain: snapshot.domain,
    title: snapshot.title || fallback?.title || snapshot.url,
    description: snapshot.description,
    faviconUrl: snapshot.favicon ?? fallback?.faviconUrl,
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
    const clip = buildClip(snapshot, { title: tab.title, faviconUrl: tab.favIconUrl });

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

/**
 * 右键「收藏链接」:不打开目标页,离线抓取后走同一条收录管线。
 * 抓取失败降级为只保存链接(标题用域名),并如实提示;与一键收录共享单飞锁。
 */
export async function runLinkSave(
  linkUrl: string,
  tabId?: number,
): Promise<QuickSaveResult> {
  const tab = await resolveTab(tabId);
  const toastTabId = tab?.id ?? tabId;
  const toast = (payload: SaveToastPayload): void => {
    if (typeof toastTabId === 'number') void showSaveToast(toastTabId, payload);
  };

  let parsed: URL;
  try {
    parsed = new URL(linkUrl);
  } catch {
    toast({ state: 'error', title: '此链接无法收录', sub: '链接格式无效' });
    return { status: 'unsupported' };
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    toast({ state: 'error', title: '此链接无法收录', sub: '仅支持 http/https 网页链接' });
    return { status: 'unsupported' };
  }

  if (inFlight) {
    toast({ state: 'saving', title: '正在收录…', sub: '请稍候，马上就好' });
    return { status: 'busy' };
  }

  // 抓取前先查重:已收藏过的链接不再发请求
  const existing = await findByNormalizedUrl(normalizeUrl(linkUrl));
  if (existing) {
    toast({ state: 'duplicate', title: '已在收藏中', sub: existing.title });
    return { status: 'duplicate', clipId: existing.id, title: existing.title };
  }

  inFlight = true;
  toast({ state: 'saving', title: '正在收录链接…', sub: parsed.hostname });

  try {
    const settings = await getSettings();
    let snapshot: PageSnapshot;
    let degraded = false;
    try {
      snapshot = await extractFromUrl(linkUrl, {
        maxContentLength: settings.maxContentLength,
        includeSelectedText: false,
      });
    } catch (error) {
      if (!(error instanceof AppError) || error.code !== 'LINK_FETCH_FAILED') throw error;
      degraded = true;
      snapshot = {
        url: linkUrl,
        title: parsed.hostname,
        domain: parsed.hostname,
        collectedAt: new Date().toISOString(),
      };
    }

    const clip = buildClip(snapshot);
    // 重定向 / canonical 后的标准化 URL 可能与原链接不同,再查一次重
    const duplicate = await findByNormalizedUrl(clip.normalizedUrl);
    if (duplicate) {
      toast({ state: 'duplicate', title: '已在收藏中', sub: duplicate.title });
      return { status: 'duplicate', clipId: duplicate.id, title: duplicate.title };
    }

    await createClip(clip);
    const autoAnalyze =
      !degraded &&
      Boolean(snapshot.mainText) &&
      settings.shortcutAutoAnalyze &&
      Boolean(settings.apiKey.trim());
    toast({
      state: 'success',
      title: degraded ? `已收录链接 · ${clip.title}` : `已收录 · ${clip.title}`,
      sub: degraded ? '正文抓取失败，仅保存链接' : autoAnalyze ? 'AI 整理中…' : undefined,
    });
    if (autoAnalyze) scheduleAnalyze(clip.id, snapshot, settings);
    return { status: 'saved', clipId: clip.id, title: clip.title, degraded };
  } catch (error) {
    const message = toErrorMessage(error);
    toast({ state: 'error', title: '收录失败', sub: message });
    return { status: 'error', message };
  } finally {
    inFlight = false;
  }
}
