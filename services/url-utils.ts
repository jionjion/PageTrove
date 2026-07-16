const TRACKING_PARAMS = [
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
  'fbclid',
  'gclid',
];

/**
 * 生成标准化 URL，用于重复收藏检测。
 * 优先使用 canonical URL，去掉跟踪参数、fragment 和尾部斜杠。
 */
export function normalizeUrl(url: string, canonicalUrl?: string): string {
  const source = canonicalUrl?.trim() || url;

  let parsed: URL;
  try {
    parsed = new URL(source);
  } catch {
    return source;
  }

  parsed.hostname = parsed.hostname.toLowerCase();
  parsed.hash = '';

  for (const param of TRACKING_PARAMS) {
    parsed.searchParams.delete(param);
  }
  parsed.searchParams.sort();

  let result = parsed.toString();

  // 去掉尾部斜杠（保留根路径的斜杠）
  if (result.endsWith('/') && parsed.pathname !== '/') {
    result = result.slice(0, -1);
  }
  if (parsed.pathname === '/' && !parsed.search && result.endsWith('/')) {
    result = result.slice(0, -1);
  }

  return result;
}

export function isUnsupportedUrl(url: string): boolean {
  return (
    url.startsWith('chrome://') ||
    url.startsWith('edge://') ||
    url.startsWith('about:') ||
    url.startsWith('chrome-extension://') ||
    url.startsWith('devtools://') ||
    url.startsWith('view-source:')
  );
}
