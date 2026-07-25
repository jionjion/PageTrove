export interface AnalyzeResult {
  summary: string;
  tags: string[];
  /** AI 清洗后的正文；未开启"整理正文"或页面无文章主体时为空 */
  content?: string;
  confidence: number;
}
