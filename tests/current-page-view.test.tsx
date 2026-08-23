// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { CurrentPageView } from '@/components/CurrentPageView';
import type { AnalyzeResult } from '@/types/ai';
import type { PageSnapshot } from '@/types/page-snapshot';
import { DEFAULT_SETTINGS } from '@/types/settings';
import { AppError } from '@/utils/errors';

const mocks = vi.hoisted(() => ({
  useCurrentTab: vi.fn(),
  extractPage: vi.fn(),
  assertPageSnapshotStillCurrent: vi.fn(),
  analyzePage: vi.fn(),
  getSettings: vi.fn(),
  createClip: vi.fn(),
  findByNormalizedUrl: vi.fn(),
  updateClip: vi.fn(),
  openOptionsPage: vi.fn(),
}));

vi.mock('wxt/browser', () => ({
  browser: { runtime: { openOptionsPage: mocks.openOptionsPage } },
}));
vi.mock('@/hooks/useCurrentTab', () => ({ useCurrentTab: mocks.useCurrentTab }));
vi.mock('@/services/page-extractor', () => ({
  extractPage: mocks.extractPage,
  assertPageSnapshotStillCurrent: mocks.assertPageSnapshotStillCurrent,
}));
vi.mock('@/services/ai/analyze-page', () => ({ analyzePage: mocks.analyzePage }));
vi.mock('@/services/settings-store', () => ({ getSettings: mocks.getSettings }));
vi.mock('@/services/clip-store', () => ({
  createClip: mocks.createClip,
  findByNormalizedUrl: mocks.findByNormalizedUrl,
  updateClip: mocks.updateClip,
}));

const snapshotA: PageSnapshot = {
  url: 'https://example.com/article',
  documentId: 'doc-a',
  title: '文章',
  domain: 'example.com',
  mainText: 'A'.repeat(300),
  collectedAt: '2026-08-12T00:00:00.000Z',
};

const snapshotB: PageSnapshot = {
  ...snapshotA,
  documentId: 'doc-b',
  mainText: 'B'.repeat(300),
  collectedAt: '2026-08-12T00:01:00.000Z',
};

const analysisA: AnalyzeResult = {
  summary: '旧文档的摘要',
  tags: ['旧文档'],
  confidence: 0.9,
};

beforeAll(() => {
  Object.defineProperty(globalThis, 'ResizeObserver', {
    writable: true,
    value: class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  });
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.useCurrentTab.mockReturnValue({
    tabId: 7,
    url: snapshotA.url,
    title: snapshotA.title,
    domain: snapshotA.domain,
    unsupported: false,
  });
  mocks.getSettings.mockResolvedValue(DEFAULT_SETTINGS);
  mocks.extractPage.mockResolvedValue(snapshotA);
  mocks.analyzePage.mockResolvedValue(analysisA);
  mocks.assertPageSnapshotStillCurrent.mockResolvedValue(undefined);
  mocks.findByNormalizedUrl.mockResolvedValue(undefined);
  mocks.createClip.mockResolvedValue(undefined);
  mocks.updateClip.mockResolvedValue(undefined);
});

afterEach(cleanup);

async function analyzeOnce() {
  fireEvent.click(screen.getByRole('button', { name: /整\s*理/ }));
  await screen.findByDisplayValue(analysisA.summary);
}

describe('CurrentPageView snapshot ownership', () => {
  it('重试失败时不会把旧分析绑定到新快照并保存', async () => {
    render(<CurrentPageView />);
    await analyzeOnce();

    mocks.extractPage.mockResolvedValueOnce(snapshotB);
    mocks.analyzePage.mockRejectedValueOnce(new Error('模型失败'));
    fireEvent.click(screen.getByRole('button', { name: /重新整理/ }));
    await screen.findByText('模型失败');

    mocks.assertPageSnapshotStillCurrent.mockRejectedValueOnce(
      new AppError('PAGE_EXTRACT_FAILED', '页面内容已发生变化，请重新整理后保存'),
    );
    fireEvent.click(screen.getByRole('button', { name: /收\s*藏/ }));
    await screen.findByText('页面内容已发生变化，请重新整理后保存');

    expect(mocks.assertPageSnapshotStillCurrent).toHaveBeenCalledWith(
      snapshotA,
      7,
      expect.any(AbortSignal),
    );
    expect(mocks.createClip).not.toHaveBeenCalled();
  });

  it('空白当前备注更新重复收藏时保留原备注', async () => {
    mocks.findByNormalizedUrl.mockResolvedValueOnce({
      id: 'clip-existing',
      title: '已有收藏',
      url: snapshotA.url,
      normalizedUrl: snapshotA.url,
      domain: snapshotA.domain,
      tags: [],
      createdAt: '2026-08-12T00:00:00.000Z',
      updatedAt: '2026-08-12T00:00:00.000Z',
    });
    render(<CurrentPageView />);
    await analyzeOnce();

    fireEvent.click(screen.getByRole('button', { name: /收\s*藏/ }));
    await screen.findByText('该网页已收藏');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /更新原收藏/ }));
    });

    await waitFor(() => expect(mocks.updateClip).toHaveBeenCalledTimes(1));
    expect(mocks.updateClip.mock.calls[0][1]).not.toHaveProperty('userNote');
  });
});
