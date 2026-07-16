export type ErrorCode =
  | 'UNSUPPORTED_PAGE'
  | 'PAGE_EXTRACT_FAILED'
  | 'EMPTY_CONTENT'
  | 'MISSING_API_KEY'
  | 'NETWORK_ERROR'
  | 'AI_UNAUTHORIZED'
  | 'AI_ANALYZE_FAILED'
  | 'INVALID_AI_RESPONSE'
  | 'DUPLICATE_CLIP'
  | 'STORAGE_FULL'
  | 'SAVE_FAILED';

const MESSAGES: Record<ErrorCode, string> = {
  UNSUPPORTED_PAGE: '浏览器内部页面不支持采集，请在普通网页中使用',
  PAGE_EXTRACT_FAILED: '网页内容读取失败，请刷新页面后重试',
  EMPTY_CONTENT: '未能提取到页面内容，请刷新页面后重试',
  MISSING_API_KEY: '尚未配置 API Key，请先前往设置页选择供应商并填写',
  NETWORK_ERROR: '网络请求失败，请检查网络后重试',
  AI_UNAUTHORIZED: 'API Key 无效或额度不足，请检查设置',
  AI_ANALYZE_FAILED: 'AI 分析失败，请稍后重试',
  INVALID_AI_RESPONSE: 'AI 返回格式异常，请重试',
  DUPLICATE_CLIP: '这个网站之前已经收藏过',
  STORAGE_FULL: '本地存储空间不足，请清理部分收藏',
  SAVE_FAILED: '保存失败，请重试',
};

export class AppError extends Error {
  readonly code: ErrorCode;

  constructor(code: ErrorCode, message?: string) {
    super(message ?? MESSAGES[code]);
    this.name = 'AppError';
    this.code = code;
  }
}

export function toErrorMessage(error: unknown): string {
  if (error instanceof AppError) {
    return error.message;
  }
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return '发生未知错误，请重试';
}
