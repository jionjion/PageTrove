export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
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
