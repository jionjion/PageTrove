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

const PAGE_CHANGED_MESSAGE = '页面已发生变化，请重试';
const SNAPSHOT_CHANGED_MESSAGE = '页面内容已发生变化，请重新整理后保存';
const MAX_SNAPSHOT_GUARD_LENGTH = 200_000;

interface ExpectedTab {
  id: number;
  url: string;
}

type RawPageSnapshot = Omit<PageSnapshot, 'favicon'> & { pageHtml?: string };

interface PageCollectionResult {
  beforeUrl: string;
  afterUrl: string;
  snapshot?: RawPageSnapshot;
}

function pageChangedError(): AppError {
  return new AppError('PAGE_EXTRACT_FAILED', PAGE_CHANGED_MESSAGE);
}

function toExpectedTab(tab: Browser.tabs.Tab | undefined): ExpectedTab {
  if (typeof tab?.id !== 'number' || !tab.url) {
    throw new AppError('PAGE_EXTRACT_FAILED', '无法获取当前网页');
  }
  if (isUnsupportedUrl(tab.url)) {
    throw new AppError('UNSUPPORTED_PAGE');
  }
  if (tab.pendingUrl) {
    throw pageChangedError();
  }
  return { id: tab.id, url: tab.url };
}

async function assertExpectedTab(expected: ExpectedTab): Promise<Browser.tabs.Tab> {
  let tab: Browser.tabs.Tab;
  try {
    tab = await browser.tabs.get(expected.id);
  } catch {
    throw pageChangedError();
  }

  if (
    tab.id !== expected.id ||
    tab.url !== expected.url ||
    tab.pendingUrl ||
    !tab.url ||
    isUnsupportedUrl(tab.url)
  ) {
    throw pageChangedError();
  }
  return tab;
}

function readPageCollectionResult(value: unknown, expectedUrl: string): RawPageSnapshot {
  if (typeof value !== 'object' || value === null) {
    throw new AppError('PAGE_EXTRACT_FAILED');
  }
  const result = value as Partial<PageCollectionResult>;
  if (result.beforeUrl !== expectedUrl || result.afterUrl !== expectedUrl) {
    throw pageChangedError();
  }
  if (!result.snapshot || result.snapshot.url !== expectedUrl) {
    throw new AppError('PAGE_EXTRACT_FAILED');
  }
  return result.snapshot;
}

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
function extractReadableText(html: string, maxLength: number): string | undefined {
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

export async function extractCurrentPage(options: ExtractOptions): Promise<PageSnapshot> {
  return extractPage(options);
}

function snapshotGuardValue(snapshot: PageSnapshot): string {
  return JSON.stringify([
    snapshot.url,
    snapshot.canonicalUrl ?? '',
    snapshot.documentId ?? '',
    snapshot.title,
    snapshot.description ?? '',
    snapshot.domain,
    snapshot.mainText ?? '',
    snapshot.author ?? '',
    snapshot.publishedAt ?? '',
    snapshot.language ?? '',
  ]);
}

/**
 * 保存 AI 整理结果前重新采集相同标签页，确认导航实例和正文仍与分析时一致。
 * 不比较 selectedText/collectedAt/favicon：它们可以在同一文档中正常变化。
 */
export async function assertPageSnapshotStillCurrent(
  expected: PageSnapshot,
  tabId: number,
  signal?: AbortSignal,
): Promise<void> {
  signal?.throwIfAborted();
  const maxContentLength = Math.min(
    Math.max(expected.mainText?.length ?? 0, 4_096),
    MAX_SNAPSHOT_GUARD_LENGTH,
  );
  const current = await extractPage(
    { maxContentLength, includeSelectedText: false },
    tabId,
  );
  signal?.throwIfAborted();
  if (snapshotGuardValue(current) !== snapshotGuardValue(expected)) {
    throw new AppError('PAGE_EXTRACT_FAILED', SNAPSHOT_CHANGED_MESSAGE);
  }
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
    try {
      [tab] = await browser.tabs.query({
        active: true,
        currentWindow: true,
      });
    } catch {
      throw new AppError('PAGE_EXTRACT_FAILED', '无法获取当前网页');
    }
  }

  const expected = toExpectedTab(tab);
  await assertExpectedTab(expected);

  let results: { result?: unknown }[];
  try {
    results = await browser.scripting.executeScript({
      target: { tabId: expected.id },
      func: collectPageData,
      args: [options.maxContentLength, expected.url],
    });
  } catch {
    throw new AppError('PAGE_EXTRACT_FAILED');
  }

  const finalTab = await assertExpectedTab(expected);
  const snapshot = readPageCollectionResult(results[0]?.result, expected.url);

  const { pageHtml, ...rest } = snapshot;
  const readableText = pageHtml
    ? extractReadableText(pageHtml, options.maxContentLength)
    : undefined;

  return {
    ...rest,
    mainText: readableText ?? rest.mainText,
    selectedText: options.includeSelectedText ? rest.selectedText : undefined,
    favicon: finalTab.favIconUrl,
  };
}

/**
 * 在页面上下文中执行的采集函数。
 * 只读取公开的页面文本，不读取 input、密码框、Cookie 和本地存储。
 */
function collectPageData(maxLength: number, expectedUrl: string): PageCollectionResult {
  const beforeUrl = location.href;
  if (beforeUrl !== expectedUrl) {
    return { beforeUrl, afterUrl: location.href };
  }

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
  const pageHtml = outerHtml.length <= 3_000_000 ? outerHtml : undefined;

  const snapshot: RawPageSnapshot = {
    url: beforeUrl,
    canonicalUrl: getMeta('link[rel="canonical"]'),
    documentId: String(performance.timeOrigin),

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

    publishedAt: getMeta('meta[property="article:published_time"]', 'time[datetime]'),

    language: document.documentElement.lang || undefined,

    collectedAt: new Date().toISOString(),
  };

  const afterUrl = location.href;
  return {
    beforeUrl,
    afterUrl,
    snapshot: afterUrl === expectedUrl ? snapshot : undefined,
  };
}
