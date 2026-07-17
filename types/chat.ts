export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
  /** 输入/输出 token 统计（仅 assistant 消息，且服务端返回 usage 时才有） */
  usage?: {
    promptTokens: number;
    completionTokens: number;
  };
  /** 生成耗时（毫秒，仅 assistant 消息） */
  elapsedMs?: number;
}

/** 针对"当前网页"发起对话时固化的页面上下文 */
export interface ChatPageContext {
  title: string;
  url: string;
  content: string;
}

export interface ChatSession {
  id: string;
  /** 关联的收藏；与 page 二选一 */
  clipId?: string;
  /** 当前网页对话的页面快照；与 clipId 二选一 */
  page?: ChatPageContext;
  title: string;
  messages: ChatMessage[];
  createdAt: string;
  updatedAt: string;
}

export interface ChatIndexEntry {
  id: string;
  title: string;
  clipId?: string;
  messageCount: number;
  updatedAt: string;
}
