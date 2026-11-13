import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing';
import { browser, type Browser } from 'wxt/browser';
import type { PageSnapshot } from '@/types/page-snapshot';
import { DEFAULT_SETTINGS, type ExtensionSettings } from '@/types/settings';
import { closePageTroveDatabase } from '@/services/database';
import { createClip, getClip, queryClips } from '@/services/clip-store';
import { normalizeUrl } from '@/services/url-utils';
import { AppError } from '@/utils/errors';

const mocks = vi.hoisted(() => ({
  extractPage: vi.fn(),
  analyzePage: vi.fn(),
  showSaveToast: vi.fn(),
}));

vi.mock('@/services/page-extractor', () => ({
  extractPage: mocks.extractPage,
}));

vi.mock('@/services/ai/analyze-page', () => ({
  analyzePage: mocks.analyzePage,
}));

vi.mock('@/services/save-toast', () => ({
  showSaveToast: mocks.showSaveToast,
}));

import { runQuickSave } from '@/services/quick-save';

const TAB = {
  id: 7,
  url: 'https://example.com/post',
  title: '示例文章',
  favIconUrl: 'https://example.com/favicon.ico',
};

function snapshot(overrides: Partial<PageSnapshot> = {}): PageSnapshot {
  return {
    url: TAB.url,
    title: '示例文章',
    domain: 'example.com',
    mainText: '正文内容。'.repeat(60),
    collectedAt: new Date().toISOString(),
    ...overrides,
  };
}

async function primeSettings(patch: Partial<ExtensionSettings> = {}) {
  await browser.storage.local.set({
    settings: { ...DEFAULT_SETTINGS, apiKey: 'sk-test', ...patch },
  });
}

function mockTab(tab: Browser.tabs.Tab | null = TAB as Browser.tabs.Tab) {
  // fakeBrowser 的 tabs mock 类型为 void 返回,直接替换为显式 vi.fn
  (browser.tabs as Record<string, unknown>).get = vi.fn(async () => tab ?? undefined);
  (browser.tabs as Record<string, unknown>).query = vi.fn(async () => (tab ? [tab] : []));
}

beforeEach(async () => {
  fakeBrowser.reset();
  await closePageTroveDatabase();
  globalThis.indexedDB = new IDBFactory();
  mocks.extractPage.mockReset();
  mocks.analyzePage.mockReset();
  mocks.showSaveToast.mockReset();
  mocks.extractPage.mockResolvedValue(snapshot());
  mocks.analyzePage.mockResolvedValue({
    summary: '一句话摘要',
    tags: ['测试'],
    confidence: 0.9,
  });
  mockTab();
  await primeSettings();
});

afterEach(async () => {
  await closePageTroveDatabase();
  vi.restoreAllMocks();
});

describe('runQuickSave', () => {
  it('保存成功:立即落库、成功提示,并异步回填 AI 摘要与标签', async () => {
    const result = await runQuickSave(TAB.id);
    expect(result.status).toBe('saved');

    const clip = await getClip(result.clipId!);
    expect(clip).toMatchObject({
      url: TAB.url,
      title: '示例文章',
      domain: 'example.com',
      normalizedUrl: normalizeUrl(TAB.url),
    });
    expect(clip?.extractedText).toContain('正文内容');
    expect(mocks.showSaveToast).toHaveBeenCalledWith(
      TAB.id,
      expect.objectContaining({ state: 'success' }),
    );

    // 异步整理完成后回填摘要/标签
    await vi.waitFor(async () => {
      const updated = await getClip(result.clipId!);
      expect(updated?.summary).toBe('一句话摘要');
      expect(updated?.tags).toEqual(['测试']);
    });
  });

  it('未传 tabId 时回退到当前活动标签页', async () => {
    const result = await runQuickSave();
    expect(result.status).toBe('saved');
    expect(browser.tabs.query).toHaveBeenCalledWith({
      active: true,
      currentWindow: true,
    });
  });

  it('重复 URL 只提示不覆盖,原收藏保持不变', async () => {
    const now = new Date().toISOString();
    await createClip({
      id: 'existing',
      url: TAB.url,
      normalizedUrl: normalizeUrl(TAB.url),
      domain: 'example.com',
      title: '旧标题',
      tags: ['旧标签'],
      userNote: '旧笔记',
      createdAt: now,
      updatedAt: now,
    });

    const result = await runQuickSave(TAB.id);
    expect(result.status).toBe('duplicate');
    expect(result.clipId).toBe('existing');
    expect(await queryClips()).toHaveLength(1);

    const original = await getClip('existing');
    expect(original?.title).toBe('旧标题');
    expect(original?.userNote).toBe('旧笔记');
    expect(mocks.showSaveToast).toHaveBeenCalledWith(
      TAB.id,
      expect.objectContaining({ state: 'duplicate' }),
    );
    expect(mocks.analyzePage).not.toHaveBeenCalled();
  });

  it('浏览器内部页直接拒绝,不注入脚本', async () => {
    mockTab({ ...TAB, url: 'chrome://extensions' } as Browser.tabs.Tab);
    const result = await runQuickSave(TAB.id);
    expect(result.status).toBe('unsupported');
    expect(mocks.extractPage).not.toHaveBeenCalled();
    expect(mocks.showSaveToast).toHaveBeenCalledWith(
      TAB.id,
      expect.objectContaining({ state: 'error' }),
    );
  });

  it('连按只产生一条记录,忙时返回 busy', async () => {
    let resolveExtract!: (value: PageSnapshot) => void;
    mocks.extractPage.mockImplementation(
      () =>
        new Promise<PageSnapshot>((resolve) => {
          resolveExtract = resolve;
        }),
    );

    const first = runQuickSave(TAB.id);
    await vi.waitFor(() => expect(mocks.extractPage).toHaveBeenCalledTimes(1));
    const second = await runQuickSave(TAB.id);
    expect(second.status).toBe('busy');

    resolveExtract(snapshot());
    expect((await first).status).toBe('saved');
    expect(await queryClips()).toHaveLength(1);
    expect(mocks.extractPage).toHaveBeenCalledTimes(1);
  });

  it('未配置 API Key 照常保存,不调用 AI', async () => {
    await primeSettings({ apiKey: '' });
    const result = await runQuickSave(TAB.id);
    expect(result.status).toBe('saved');
    expect(mocks.analyzePage).not.toHaveBeenCalled();
    expect((await getClip(result.clipId!))?.summary).toBeUndefined();
  });

  it('关闭自动整理时不调用 AI', async () => {
    await primeSettings({ shortcutAutoAnalyze: false });
    const result = await runQuickSave(TAB.id);
    expect(result.status).toBe('saved');
    expect(mocks.analyzePage).not.toHaveBeenCalled();
  });

  it('AI 整理失败静默,收藏本体不受影响', async () => {
    mocks.analyzePage.mockRejectedValue(new AppError('AI_ANALYZE_FAILED'));
    const result = await runQuickSave(TAB.id);
    expect(result.status).toBe('saved');
    await vi.waitFor(() => expect(mocks.analyzePage).toHaveBeenCalledTimes(1));
    await new Promise((resolve) => setTimeout(resolve, 0));
    const clip = await getClip(result.clipId!);
    expect(clip?.summary).toBeUndefined();
    expect(clip?.extractedText).toContain('正文内容');
  });

  it('提取失败返回错误并提示', async () => {
    mocks.extractPage.mockRejectedValue(new AppError('PAGE_EXTRACT_FAILED'));
    const result = await runQuickSave(TAB.id);
    expect(result.status).toBe('error');
    expect(result.message).toBe('网页内容读取失败，请刷新页面后重试');
    expect(await queryClips()).toHaveLength(0);
    expect(mocks.showSaveToast).toHaveBeenCalledWith(
      TAB.id,
      expect.objectContaining({ state: 'error', title: '收录失败' }),
    );
  });

  it('找不到标签页时返回错误', async () => {
    mockTab(null);
    const result = await runQuickSave();
    expect(result.status).toBe('error');
    expect(mocks.extractPage).not.toHaveBeenCalled();
  });
});
