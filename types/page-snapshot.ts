export interface PageSnapshot {
  url: string;
  canonicalUrl?: string;

  /**
   * 页面文档实例标识。同一 URL 重新加载会产生新值，用于阻止把旧分析保存到新文档。
   * 旧数据可能没有该字段，因此保存前还会同时核对正文快照。
   */
  documentId?: string;

  title: string;
  description?: string;
  domain: string;
  favicon?: string;

  selectedText?: string;
  mainText?: string;

  author?: string;
  publishedAt?: string;
  language?: string;

  collectedAt: string;
}
