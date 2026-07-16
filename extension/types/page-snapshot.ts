export interface PageSnapshot {
  url: string;
  canonicalUrl?: string;

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
