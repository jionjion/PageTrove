import { browser } from 'wxt/browser';
import { Readability } from '@mozilla/readability';
import TurndownService from 'turndown';
import { gfm } from 'turndown-plugin-gfm';
import type { PageSnapshot } from '@/types/page-snapshot';
import { AppError } from '@/utils/errors';
import { isUnsupportedUrl } from '@/services/url-utils';

export interface ExtractOptions {
  maxContentLength: number;
  includeSelectedText: boolean;
}

/** Readability 结果短于该长度时视为提取失败（可能只抓到片段） */
const MIN_READABLE_LENGTH = 200;

/** 把 Readability 提取出的文章 HTML 转成 Markdown（保留标题、列表、表格、代码块） */
const turndown = new TurndownService({
  headingStyle: 'atx',
  codeBlockStyle: 'fenced',
  bulletListMarker: '-',
});
turndown.use(gfm);
// 图片只保留占位，避免长 base64/跟踪链接污染正文
turndown.addRule('image', {
  filter: 'img',
  replacement: (_content, node) => {
    const alt = (node as HTMLElement).getAttribute('alt')?.trim();
    return alt ? `[图: ${alt}]` : '';
  },
});

/**
 * 用 Readability 从页面 HTML 中提取文章主体，转为 Markdown，
 * 去掉导航、广告、推荐位等噪音。失败时返回 undefined。
 */
function extractReadableText(
  html: string,
  maxLength: number,
): string | undefined {
  if (typeof DOMParser === 'undefined') return undefined;
  try {
    // DOMParser 不会执行脚本或加载资源，仅做离线解析。
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const article = new Readability(doc).parse();
    if (!article?.content) return undefined;
    const markdown = turndown
      .turndown(article.content)
      .replace(/\n{3,}/g, '\n\n')
      .trim();
    if (markdown.length >= MIN_READABLE_LENGTH) {
      return markdown.slice(0, maxLength);
    }
  } catch {
    // 解析失败时退回 innerText 提取结果。
  }
  return undefined;
}

export async function extractCurrentPage(
  options: ExtractOptions,
): Promise<PageSnapshot> {
  return extractPage(options);
}

/**
 * 采集指定标签页（未传 tabId 时为当前活动标签页）的页面快照。
 */
export async function extractPage(
  options: ExtractOptions,
  tabId?: number,
): Promise<PageSnapshot> {
  let tab: Browser.tabs.Tab | undefined;
  if (tabId !== undefined) {
    try {
      tab = await browser.tabs.get(tabId);
    } catch {
      throw new AppError('PAGE_EXTRACT_FAILED', '目标标签页已关闭');
    }
  } else {
    [tab] = await browser.tabs.query({
      active: true,
      currentWindow: true,
    });
  }

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
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    throw new AppError(
      'PAGE_EXTRACT_FAILED',
      `页面脚本注入失败，请刷新页面后重试（${detail}）`,
    );
  }

  const snapshot = results[0]?.result as
    | (Omit<PageSnapshot, 'favicon'> & { pageHtml?: string })
    | undefined;

  if (!snapshot) {
    throw new AppError('PAGE_EXTRACT_FAILED');
  }

  const { pageHtml, ...rest } = snapshot;
  const readableText = pageHtml
    ? extractReadableText(pageHtml, options.maxContentLength)
    : undefined;

  return {
    ...rest,
    mainText: readableText ?? rest.mainText,
    selectedText: options.includeSelectedText ? rest.selectedText : undefined,
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

  const selectedText = (window.getSelection()?.toString() ?? '').trim() || undefined;

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

  // 返回整页 HTML，供扩展侧用 Readability 提取文章主体（超大页面跳过）。
  const outerHtml = document.documentElement.outerHTML;
  const pageHtml =
    outerHtml.length <= 3_000_000 ? outerHtml : undefined;

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
    pageHtml,

    author: getMeta('meta[name="author"]', 'meta[property="article:author"]'),

    publishedAt: getMeta(
      'meta[property="article:published_time"]',
      'time[datetime]',
    ),

    language: document.documentElement.lang || undefined,

    collectedAt: new Date().toISOString(),
  };
}
