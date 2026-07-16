export interface WebClip {
  id: string;

  url: string;
  canonicalUrl?: string;
  normalizedUrl: string;
  domain: string;

  title: string;
  description?: string;
  faviconUrl?: string;

  summary?: string;
  tags: string[];

  userNote?: string;
  selectedText?: string;
  extractedText?: string;

  createdAt: string;
  updatedAt: string;
}

/** 轻量索引项，用于列表展示和过滤，避免每次读取全部正文 */
export interface ClipIndexEntry {
  id: string;
  title: string;
  url: string;
  normalizedUrl: string;
  domain: string;
  faviconUrl?: string;
  summary?: string;
  tags: string[];
  createdAt: string;
}

export interface ClipQuery {
  keyword?: string;
  tag?: string;
  domain?: string;
  sort?: 'createdAt_desc' | 'createdAt_asc';
}
