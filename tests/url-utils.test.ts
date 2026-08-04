import { describe, expect, it } from 'vitest';
import { isUnsupportedUrl, normalizeUrl } from '@/services/url-utils';

describe('normalizeUrl', () => {
  it('去掉跟踪参数', () => {
    expect(
      normalizeUrl('https://example.com/post?utm_source=x&utm_medium=y&id=1'),
    ).toBe('https://example.com/post?id=1');
  });

  it('去掉 fragment', () => {
    expect(normalizeUrl('https://example.com/post#section-2')).toBe(
      'https://example.com/post',
    );
  });

  it('去掉尾部斜杠但保留根路径', () => {
    expect(normalizeUrl('https://example.com/post/')).toBe(
      'https://example.com/post',
    );
    expect(normalizeUrl('https://example.com/')).toBe('https://example.com');
  });

  it('hostname 小写', () => {
    expect(normalizeUrl('https://Example.COM/Post')).toBe(
      'https://example.com/Post',
    );
  });

  it('查询参数排序保证稳定', () => {
    expect(normalizeUrl('https://example.com/p?b=2&a=1')).toBe(
      normalizeUrl('https://example.com/p?a=1&b=2'),
    );
  });

  it('优先使用 canonical URL', () => {
    expect(
      normalizeUrl('https://example.com/p?page=2', 'https://example.com/p'),
    ).toBe('https://example.com/p');
  });

  it('canonical 为空白时回退原 URL', () => {
    expect(normalizeUrl('https://example.com/p', '  ')).toBe(
      'https://example.com/p',
    );
  });

  it('无法解析时原样返回', () => {
    expect(normalizeUrl('not a url')).toBe('not a url');
  });
});

describe('isUnsupportedUrl', () => {
  it('拒绝浏览器内部页面', () => {
    expect(isUnsupportedUrl('chrome://extensions')).toBe(true);
    expect(isUnsupportedUrl('edge://settings')).toBe(true);
    expect(isUnsupportedUrl('about:blank')).toBe(true);
    expect(isUnsupportedUrl('chrome-extension://abc/index.html')).toBe(true);
    expect(isUnsupportedUrl('devtools://devtools')).toBe(true);
    expect(isUnsupportedUrl('view-source:https://example.com')).toBe(true);
  });

  it('允许普通网页', () => {
    expect(isUnsupportedUrl('https://example.com')).toBe(false);
    expect(isUnsupportedUrl('http://localhost:3000')).toBe(false);
  });
});
