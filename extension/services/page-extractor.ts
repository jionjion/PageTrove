import { browser } from 'wxt/browser';
import type { PageSnapshot } from '@/types/page-snapshot';
import { AppError } from '@/utils/errors';
import { isUnsupportedUrl } from '@/services/url-utils';

export interface ExtractOptions {
  maxContentLength: number;
  includeSelectedText: boolean;
}

export async function extractCurrentPage(
  options: ExtractOptions,
): Promise<PageSnapshot> {
  const [tab] = await browser.tabs.query({
    active: true,
    currentWindow: true,
  });

  if (!tab?.id || !tab.url) {
    throw new AppError('PAGE_EXTRACT_FAILED', '无法获取当前网页');
  }

  if (isUnsupportedUrl(tab.url)) {
    throw new AppError('UNSUPPORTED_PAGE');
  }

  let results: { result?: unknown }[];
  try {
    results = await browser.scripting.executeScript({
      target: { tabId: tab.id },
      func: collectPageData,
      args: [options.maxContentLength],
    });
  } catch {
    throw new AppError('PAGE_EXTRACT_FAILED', '页面脚本注入失败，请刷新页面后重试');
  }

  const snapshot = results[0]?.result as
    | Omit<PageSnapshot, 'favicon'>
    | undefined;

  if (!snapshot) {
    throw new AppError('PAGE_EXTRACT_FAILED');
  }

  return {
    ...snapshot,
    selectedText: options.includeSelectedText ? snapshot.selectedText : undefined,
    favicon: tab.favIconUrl,
  };
}

/**
 * 在页面上下文中执行的采集函数。
 * 只读取公开的页面文本，不读取 input、密码框、Cookie 和本地存储。
 */
function collectPageData(maxLength: number) {
  const getMeta = (...selectors: string[]): string | undefined => {
    for (const selector of selectors) {
      const element = document.querySelector(selector);
      const value =
        element?.getAttribute('content') ??
        element?.getAttribute('href') ??
        element?.getAttribute('datetime') ??
        element?.textContent ??
        undefined;
      if (value?.trim()) {
        return value.trim();
      }
    }
    return undefined;
  };

  const selectedText = window.getSelection()?.toString().trim() || undefined;

  const mainElement =
    document.querySelector('article') ??
    document.querySelector('main') ??
    document.querySelector('[role="main"]') ??
    document.body;

  const mainText =
    (mainElement as HTMLElement).innerText
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, maxLength) || undefined;

  return {
    url: location.href,
    canonicalUrl: getMeta('link[rel="canonical"]'),

    title:
      getMeta('meta[property="og:title"]', 'meta[name="twitter:title"]') ??
      document.title,

    description: getMeta(
      'meta[name="description"]',
      'meta[property="og:description"]',
      'meta[name="twitter:description"]',
    ),

    domain: location.hostname,

    selectedText,
    mainText,

    author: getMeta('meta[name="author"]', 'meta[property="article:author"]'),

    publishedAt: getMeta(
      'meta[property="article:published_time"]',
      'time[datetime]',
    ),

    language: document.documentElement.lang || undefined,

    collectedAt: new Date().toISOString(),
  };
}
