// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { extractFromUrl } from '@/services/page-extractor';

const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  fetchMock.mockReset();
});

function htmlResponse(
  html: string,
  opts: { url?: string; status?: number; contentType?: string } = {},
): Response {
  const response = new Response(html, {
    status: opts.status ?? 200,
    headers: { 'content-type': opts.contentType ?? 'text/html; charset=utf-8' },
  });
  // Response.url 只读,用实例属性覆盖以模拟重定向后的最终地址
  Object.defineProperty(response, 'url', { value: opts.url ?? '' });
  return response;
}

const LONG_TEXT = '这是一段用于测试的文章正文内容。'.repeat(24);

function pageHtml(body: string, head = ''): string {
  return `<html lang="zh-CN"><head>${head}</head><body>${body}</body></html>`;
}

const OPTIONS = { maxContentLength: 12_000, includeSelectedText: false };

describe('extractFromUrl', () => {
  it('离线解析元数据与正文,canonical 相对地址按最终 URL 解析', async () => {
    const head = `
      <title>原始标题</title>
      <meta property="og:title" content="文章标题" />
      <meta name="description" content="文章描述" />
      <link rel="canonical" href="/post/canonical" />
      <meta name="author" content="作者" />`;
    fetchMock.mockResolvedValue(
      htmlResponse(pageHtml(`<article><p>${LONG_TEXT}</p></article>`, head), {
        url: 'https://target.example/post/final',
      }),
    );

    const snap = await extractFromUrl('https://target.example/post', OPTIONS);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://target.example/post',
      expect.objectContaining({ redirect: 'follow', credentials: 'omit' }),
    );
    expect(snap).toMatchObject({
      url: 'https://target.example/post/final',
      title: '文章标题',
      description: '文章描述',
      canonicalUrl: 'https://target.example/post/canonical',
      domain: 'target.example',
      author: '作者',
      language: 'zh-CN',
    });
    expect(snap.mainText).toContain('测试的文章正文');
    expect(snap.collectedAt).toBeTruthy();
  });

  it('没有 og:title 时退回 document.title', async () => {
    fetchMock.mockResolvedValue(
      htmlResponse(
        pageHtml(`<article><p>${LONG_TEXT}</p></article>`, '<title>页面标题</title>'),
      ),
    );
    const snap = await extractFromUrl('https://target.example/post', OPTIONS);
    expect(snap.title).toBe('页面标题');
    expect(snap.canonicalUrl).toBeUndefined();
  });

  it('Readability 提取过短时退回正文文本', async () => {
    fetchMock.mockResolvedValue(htmlResponse(pageHtml('<article>短文内容</article>')));
    const snap = await extractFromUrl('https://target.example/post', OPTIONS);
    expect(snap.mainText).toBe('短文内容');
  });

  it('正文长度受 maxContentLength 限制', async () => {
    fetchMock.mockResolvedValue(
      htmlResponse(pageHtml(`<article><p>${LONG_TEXT}</p></article>`)),
    );
    const snap = await extractFromUrl('https://target.example/post', {
      ...OPTIONS,
      maxContentLength: 50,
    });
    expect(snap.mainText!.length).toBeLessThanOrEqual(50);
  });

  it('非网页内容类型抛 LINK_FETCH_FAILED', async () => {
    fetchMock.mockResolvedValue(
      htmlResponse('%PDF-1.4', { contentType: 'application/pdf' }),
    );
    await expect(
      extractFromUrl('https://target.example/f.pdf', OPTIONS),
    ).rejects.toMatchObject({
      code: 'LINK_FETCH_FAILED',
    });
  });

  it('HTTP 错误状态抛 LINK_FETCH_FAILED', async () => {
    fetchMock.mockResolvedValue(htmlResponse('not found', { status: 404 }));
    await expect(
      extractFromUrl('https://target.example/f', OPTIONS),
    ).rejects.toMatchObject({
      code: 'LINK_FETCH_FAILED',
      message: expect.stringContaining('404'),
    });
  });

  it('网络失败抛 LINK_FETCH_FAILED', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(
      extractFromUrl('https://target.example/f', OPTIONS),
    ).rejects.toMatchObject({
      code: 'LINK_FETCH_FAILED',
      message: '无法抓取目标页面',
    });
  });
});
