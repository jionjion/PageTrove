import { afterEach, describe, expect, it, vi } from 'vitest';
import { pickPageElement } from '@/services/element-picker';
import { assertPageSnapshotStillCurrent, extractPage } from '@/services/page-extractor';
import type { PageSnapshot } from '@/types/page-snapshot';
import {
  captureCurrentTabRegion,
  captureSelectedRegion,
  type CaptureTarget,
  type ViewportRegion,
} from '@/services/screenshot-capture';

const browserMocks = vi.hoisted(() => ({
  tabsQuery: vi.fn(),
  tabsGet: vi.fn(),
  executeScript: vi.fn(),
  captureVisibleTab: vi.fn(),
}));

vi.mock('wxt/browser', () => ({
  browser: {
    tabs: {
      query: browserMocks.tabsQuery,
      get: browserMocks.tabsGet,
      captureVisibleTab: browserMocks.captureVisibleTab,
    },
    scripting: {
      executeScript: browserMocks.executeScript,
    },
  },
}));

const PAGE_URL = 'https://example.com/article';
const CHANGED_URL = 'https://example.com/other';

function makeTab(
  url = PAGE_URL,
  overrides: Partial<Browser.tabs.Tab> = {},
): Browser.tabs.Tab {
  return {
    id: 7,
    index: 0,
    windowId: 3,
    highlighted: true,
    active: true,
    pinned: false,
    frozen: false,
    selected: false,
    discarded: false,
    autoDiscardable: true,
    groupId: -1,
    incognito: false,
    url,
    ...overrides,
  };
}

function pageResult(beforeUrl = PAGE_URL, afterUrl = PAGE_URL) {
  return {
    beforeUrl,
    afterUrl,
    snapshot: {
      url: beforeUrl,
      title: '测试文章',
      domain: 'example.com',
      mainText: '正文',
      collectedAt: '2026-08-12T00:00:00.000Z',
    },
  };
}

function snapshot(overrides: Partial<PageSnapshot> = {}): PageSnapshot {
  return {
    ...pageResult().snapshot,
    ...overrides,
  };
}

const region: ViewportRegion = {
  left: 10,
  top: 20,
  width: 100,
  height: 80,
  viewportWidth: 1280,
  viewportHeight: 720,
};

afterEach(() => {
  vi.resetAllMocks();
});

describe('extractPage TOCTOU', () => {
  it('把触发时 tab id/URL 传入页面函数，并在注入前后复核', async () => {
    const tab = makeTab();
    browserMocks.tabsQuery.mockResolvedValue([tab]);
    browserMocks.tabsGet.mockResolvedValue(tab);
    browserMocks.executeScript.mockResolvedValue([{ frameId: 0, result: pageResult() }]);

    const snapshot = await extractPage({
      maxContentLength: 1_000,
      includeSelectedText: true,
    });

    expect(snapshot.url).toBe(PAGE_URL);
    expect(browserMocks.tabsGet).toHaveBeenCalledTimes(2);
    expect(browserMocks.executeScript).toHaveBeenCalledTimes(1);
    expect(browserMocks.executeScript.mock.calls[0]?.[0]).toMatchObject({
      target: { tabId: 7 },
      args: [1_000, PAGE_URL],
    });
  });

  it('注入返回后 tab 已导航时丢弃采集结果', async () => {
    const stable = makeTab();
    const changed = makeTab(CHANGED_URL);
    browserMocks.tabsQuery.mockResolvedValue([stable]);
    browserMocks.tabsGet.mockResolvedValueOnce(stable).mockResolvedValueOnce(changed);
    browserMocks.executeScript.mockResolvedValue([{ frameId: 0, result: pageResult() }]);

    await expect(
      extractPage({ maxContentLength: 1_000, includeSelectedText: true }),
    ).rejects.toMatchObject({
      code: 'PAGE_EXTRACT_FAILED',
      message: '页面已发生变化，请重试',
    });
  });

  it('页面内读取前后 URL 不一致时 fail closed', async () => {
    const tab = makeTab();
    browserMocks.tabsQuery.mockResolvedValue([tab]);
    browserMocks.tabsGet.mockResolvedValue(tab);
    browserMocks.executeScript.mockResolvedValue([
      { frameId: 0, result: pageResult(PAGE_URL, CHANGED_URL) },
    ]);

    await expect(
      extractPage({ maxContentLength: 1_000, includeSelectedText: true }),
    ).rejects.toMatchObject({ message: '页面已发生变化，请重试' });
  });

  it('不向 UI 泄露原始脚本注入异常', async () => {
    const tab = makeTab();
    browserMocks.tabsQuery.mockResolvedValue([tab]);
    browserMocks.tabsGet.mockResolvedValue(tab);
    browserMocks.executeScript.mockRejectedValue(
      new Error('Cannot access contents of url: internal-extension-detail'),
    );

    await expect(
      extractPage({ maxContentLength: 1_000, includeSelectedText: true }),
    ).rejects.toMatchObject({
      code: 'PAGE_EXTRACT_FAILED',
      message: '网页内容读取失败，请刷新页面后重试',
    });
  });

  it('相同 URL 和标题下正文变化时拒绝保存旧分析', async () => {
    const tab = makeTab();
    browserMocks.tabsGet.mockResolvedValue(tab);
    browserMocks.executeScript.mockResolvedValue([
      {
        frameId: 0,
        result: {
          ...pageResult(),
          snapshot: snapshot({ mainText: '已更换的正文' }),
        },
      },
    ]);

    await expect(
      assertPageSnapshotStillCurrent(snapshot({ mainText: '原正文' }), 7),
    ).rejects.toMatchObject({
      code: 'PAGE_EXTRACT_FAILED',
      message: '页面内容已发生变化，请重新整理后保存',
    });
  });

  it('相同正文但页面已重新加载时拒绝保存', async () => {
    const tab = makeTab();
    browserMocks.tabsGet.mockResolvedValue(tab);
    browserMocks.executeScript.mockResolvedValue([
      {
        frameId: 0,
        result: {
          ...pageResult(),
          snapshot: snapshot({ documentId: 'new-document' }),
        },
      },
    ]);

    await expect(
      assertPageSnapshotStillCurrent(snapshot({ documentId: 'old-document' }), 7),
    ).rejects.toMatchObject({ message: '页面内容已发生变化，请重新整理后保存' });
  });
});

describe('pickPageElement TOCTOU', () => {
  it('使用固定 URL 选取元素，并在返回后复核 tab', async () => {
    const tab = makeTab();
    browserMocks.tabsQuery.mockResolvedValue([tab]);
    browserMocks.tabsGet.mockResolvedValue(tab);
    browserMocks.executeScript.mockResolvedValue([
      {
        frameId: 0,
        result: {
          beforeUrl: PAGE_URL,
          afterUrl: PAGE_URL,
          picked: { text: '选中文字', hasVisual: false, region },
        },
      },
    ]);

    await expect(pickPageElement(500, false)).resolves.toEqual({
      text: '选中文字',
      hasVisual: false,
      image: undefined,
    });
    expect(browserMocks.tabsGet).toHaveBeenCalledTimes(2);
    expect(browserMocks.executeScript.mock.calls[0]?.[0]).toMatchObject({
      target: { tabId: 7 },
      args: [500, PAGE_URL],
    });
  });

  it('元素选取期间导航时不返回旧页内容', async () => {
    const stable = makeTab();
    const changed = makeTab(CHANGED_URL);
    browserMocks.tabsQuery.mockResolvedValue([stable]);
    browserMocks.tabsGet.mockResolvedValueOnce(stable).mockResolvedValueOnce(changed);
    browserMocks.executeScript.mockResolvedValue([
      {
        frameId: 0,
        result: {
          beforeUrl: PAGE_URL,
          afterUrl: PAGE_URL,
          picked: { text: '旧页文字', hasVisual: false, region },
        },
      },
    ]);

    await expect(pickPageElement(500, false)).rejects.toMatchObject({
      message: '页面已发生变化，请重试',
    });
  });
});

describe('截图 TOCTOU', () => {
  const target: CaptureTarget = { tabId: 7, windowId: 3, url: PAGE_URL };

  it('区域截图前 tab/URL 不匹配时不调用 captureVisibleTab', async () => {
    const changed = makeTab(CHANGED_URL);
    browserMocks.tabsGet.mockResolvedValue(changed);
    browserMocks.tabsQuery.mockResolvedValue([changed]);
    browserMocks.captureVisibleTab.mockResolvedValue('data:image/png;base64,unused');

    await expect(captureCurrentTabRegion(region, target)).rejects.toMatchObject({
      message: '页面已发生变化，请重试',
    });
    expect(browserMocks.captureVisibleTab).not.toHaveBeenCalled();
  });

  it('框选返回后页面已导航时不截取新页面', async () => {
    const stable = makeTab();
    const changed = makeTab(CHANGED_URL);
    browserMocks.tabsQuery
      .mockResolvedValueOnce([stable])
      .mockResolvedValueOnce([stable])
      .mockResolvedValueOnce([changed]);
    browserMocks.tabsGet.mockResolvedValueOnce(stable).mockResolvedValueOnce(changed);
    browserMocks.executeScript.mockResolvedValue([
      {
        frameId: 0,
        result: { beforeUrl: PAGE_URL, afterUrl: PAGE_URL, region },
      },
    ]);
    browserMocks.captureVisibleTab.mockResolvedValue('data:image/png;base64,unused');

    await expect(captureSelectedRegion()).rejects.toMatchObject({
      message: '页面已发生变化，请重试',
    });
    expect(browserMocks.executeScript.mock.calls[0]?.[0]).toMatchObject({
      target: { tabId: 7 },
      args: [PAGE_URL],
    });
    expect(browserMocks.captureVisibleTab).not.toHaveBeenCalled();
  });

  it('框选完成前取消时不会继续截取页面', async () => {
    const stable = makeTab();
    const controller = new AbortController();
    let resolveSelection!: (value: { frameId: number; result: unknown }[]) => void;
    const selection = new Promise<{ frameId: number; result: unknown }[]>((resolve) => {
      resolveSelection = resolve;
    });
    browserMocks.tabsQuery.mockResolvedValue([stable]);
    browserMocks.tabsGet.mockResolvedValue(stable);
    browserMocks.executeScript
      .mockReturnValueOnce(selection)
      .mockResolvedValueOnce([{ frameId: 0, result: undefined }]);

    const capture = captureSelectedRegion(controller.signal);
    await vi.waitFor(() => expect(browserMocks.executeScript).toHaveBeenCalledTimes(1));
    controller.abort(new DOMException('会话已切换', 'AbortError'));
    resolveSelection([
      {
        frameId: 0,
        result: { beforeUrl: PAGE_URL, afterUrl: PAGE_URL, region },
      },
    ]);

    await expect(capture).rejects.toMatchObject({ name: 'AbortError' });
    expect(browserMocks.captureVisibleTab).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(browserMocks.executeScript).toHaveBeenCalledTimes(2));
  });
});
