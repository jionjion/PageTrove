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
  extractFromUrl: vi.fn(),
  analyzePage: vi.fn(),
  showSaveToast: vi.fn(),
}));

vi.mock('@/services/page-extractor', () => ({
  extractPage: mocks.extractPage,
  extractFromUrl: mocks.extractFromUrl,
}));

vi.mock('@/services/ai/analyze-page', () => ({
  analyzePage: mocks.analyzePage,
}));

vi.mock('@/services/save-toast', () => ({
  showSaveToast: mocks.showSaveToast,
}));

import { runLinkSave, runQuickSave } from '@/services/quick-save';

const TAB = {
  id: 7,
  url: 'https://source.example/page',
  title: '来源页',
  favIconUrl: 'https://source.example/favicon.ico',
};

const LINK = 'https://target.example/post';

function snapshot(overrides: Partial<PageSnapshot> = {}): PageSnapshot {
  return {
    url: LINK,
    title: '目标文章',
    domain: 'target.example',
    mainText: '目标正文。'.repeat(60),
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
  (browser.tabs as Record<string, unknown>).get = vi.fn(async () => tab ?? undefined);
  (browser.tabs as Record<string, unknown>).query = vi.fn(async () => (tab ? [tab] : []));
}

async function seedClip(url: string, id = 'existing') {
  const now = new Date().toISOString();
  await createClip({
    id,
    url,
    normalizedUrl: normalizeUrl(url),
    domain: new URL(url).hostname,
    title: '旧标题',
    tags: ['旧标签'],
    createdAt: now,
    updatedAt: now,
  });
}

beforeEach(async () => {
  fakeBrowser.reset();
  await closePageTroveDatabase();
  globalThis.indexedDB = new IDBFactory();
  mocks.extractPage.mockReset();
  mocks.extractFromUrl.mockReset();
  mocks.analyzePage.mockReset();
  mocks.showSaveToast.mockReset();
  mocks.extractPage.mockResolvedValue(snapshot());
  mocks.extractFromUrl.mockResolvedValue(snapshot());
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

describe('runLinkSave', () => {
  it('保存成功:离线抓取落库、成功提示,并异步回填 AI 摘要与标签', async () => {
    const result = await runLinkSave(LINK, TAB.id);
    expect(result.status).toBe('saved');
    expect(result.degraded).toBe(false);
    expect(mocks.extractFromUrl).toHaveBeenCalledWith(
      LINK,
      expect.objectContaining({ includeSelectedText: false }),
    );

    const clip = await getClip(result.clipId!);
    expect(clip).toMatchObject({
      url: LINK,
      title: '目标文章',
      domain: 'target.example',
      normalizedUrl: normalizeUrl(LINK),
    });
    expect(clip?.extractedText).toContain('目标正文');
    expect(mocks.showSaveToast).toHaveBeenCalledWith(
      TAB.id,
      expect.objectContaining({ state: 'success' }),
    );

    await vi.waitFor(async () => {
      const updated = await getClip(result.clipId!);
      expect(updated?.summary).toBe('一句话摘要');
      expect(updated?.tags).toEqual(['测试']);
    });
  });

  it('已收藏过的链接抓取前就拦截,不发请求', async () => {
    await seedClip(LINK);
    const result = await runLinkSave(LINK, TAB.id);
    expect(result.status).toBe('duplicate');
    expect(result.clipId).toBe('existing');
    expect(mocks.extractFromUrl).not.toHaveBeenCalled();
    expect(await queryClips()).toHaveLength(1);
    expect(mocks.showSaveToast).toHaveBeenCalledWith(
      TAB.id,
      expect.objectContaining({ state: 'duplicate' }),
    );
  });

  it('重定向/canonical 命中已有收藏时同样不覆盖', async () => {
    const canonical = 'https://target.example/canonical-post';
    await seedClip(canonical);
    mocks.extractFromUrl.mockResolvedValue(snapshot({ canonicalUrl: canonical }));

    const result = await runLinkSave(LINK, TAB.id);
    expect(result.status).toBe('duplicate');
    expect(result.clipId).toBe('existing');
    expect(await queryClips()).toHaveLength(1);
    expect((await getClip('existing'))?.title).toBe('旧标题');
  });

  it('抓取失败降级:只保存链接,标题用域名,不调用 AI', async () => {
    mocks.extractFromUrl.mockRejectedValue(new AppError('LINK_FETCH_FAILED'));
    const result = await runLinkSave(LINK, TAB.id);
    expect(result.status).toBe('saved');
    expect(result.degraded).toBe(true);

    const clip = await getClip(result.clipId!);
    expect(clip).toMatchObject({
      url: LINK,
      title: 'target.example',
      domain: 'target.example',
    });
    expect(clip?.extractedText).toBeUndefined();
    expect(mocks.analyzePage).not.toHaveBeenCalled();
    expect(mocks.showSaveToast).toHaveBeenCalledWith(
      TAB.id,
      expect.objectContaining({
        state: 'success',
        sub: '正文抓取失败，仅保存链接',
      }),
    );
  });

  it('非 http/https 链接直接拒绝', async () => {
    for (const url of ['mailto:a@b.com', 'javascript:void(0)', 'ftp://x.example/f']) {
      const result = await runLinkSave(url, TAB.id);
      expect(result.status).toBe('unsupported');
    }
    expect(mocks.extractFromUrl).not.toHaveBeenCalled();
    expect(mocks.showSaveToast).toHaveBeenCalledWith(
      TAB.id,
      expect.objectContaining({ state: 'error', title: '此链接无法收录' }),
    );
  });

  it('无效链接格式直接拒绝', async () => {
    const result = await runLinkSave('not a url', TAB.id);
    expect(result.status).toBe('unsupported');
    expect(mocks.extractFromUrl).not.toHaveBeenCalled();
  });

  it('与一键收录共享单飞锁:忙时返回 busy', async () => {
    let resolveExtract!: (value: PageSnapshot) => void;
    mocks.extractPage.mockImplementation(
      () =>
        new Promise<PageSnapshot>((resolve) => {
          resolveExtract = resolve;
        }),
    );

    const first = runQuickSave(TAB.id);
    await vi.waitFor(() => expect(mocks.extractPage).toHaveBeenCalledTimes(1));
    const second = await runLinkSave(LINK, TAB.id);
    expect(second.status).toBe('busy');
    expect(mocks.extractFromUrl).not.toHaveBeenCalled();

    resolveExtract(snapshot({ url: TAB.url, domain: 'source.example' }));
    expect((await first).status).toBe('saved');
    expect(await queryClips()).toHaveLength(1);
  });

  it('未配置 API Key 照常保存,不调用 AI', async () => {
    await primeSettings({ apiKey: '' });
    const result = await runLinkSave(LINK, TAB.id);
    expect(result.status).toBe('saved');
    expect(mocks.analyzePage).not.toHaveBeenCalled();
  });

  it('非抓取类错误不降级,返回错误且不落库', async () => {
    mocks.extractFromUrl.mockRejectedValue(new AppError('PAGE_EXTRACT_FAILED'));
    const result = await runLinkSave(LINK, TAB.id);
    expect(result.status).toBe('error');
    expect(await queryClips()).toHaveLength(0);
    expect(mocks.showSaveToast).toHaveBeenCalledWith(
      TAB.id,
      expect.objectContaining({ state: 'error', title: '收录失败' }),
    );
  });

  it('重定向后按最终 URL 落库', async () => {
    const finalUrl = 'https://final.example/redirected';
    mocks.extractFromUrl.mockResolvedValue(
      snapshot({ url: finalUrl, domain: 'final.example' }),
    );
    const result = await runLinkSave(LINK, TAB.id);
    expect(result.status).toBe('saved');
    expect((await getClip(result.clipId!))?.url).toBe(finalUrl);
  });
});
