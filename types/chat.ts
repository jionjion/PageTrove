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
  /** 本次回答调用过的 MCP 工具摘要。 */
  toolCalls?: ChatToolCall[];
}

export interface ChatToolCall {
  id: string;
  serverName: string;
  toolName: string;
  status: 'success' | 'error';
  summary?: string;
}

/** 针对"当前网页"发起对话时固化的页面上下文 */
export interface ChatPageContext {
  title: string;
  url: string;
  content: string;
}

/** 多来源会话中的单个来源引用。page 固化正文；clip 只存 id 与展示元数据。 */
export type ChatSourceRef =
  | {
      id: string;
      type: 'page';
      title: string;
      url: string;
      /** 页面图标，仅展示用；可能加载失败，UI 需回退占位图标 */
      faviconUrl?: string;
      content: string;
      capturedAt: string;
    }
  | {
      id: string;
      type: 'clip';
      clipId: string;
      title: string;
      url: string;
      /** 页面图标，仅展示用；可能加载失败，UI 需回退占位图标 */
      faviconUrl?: string;
    };

/** 多来源探究会话的范围；与 page、clipId 三选一。 */
export interface ChatScope {
  mode: 'tabs' | 'clips';
  sources: ChatSourceRef[];
}

export interface ChatSession {
  id: string;
  /** 关联的收藏；与 page、scope 三选一 */
  clipId?: string;
  /** 当前网页对话的页面快照；与 clipId、scope 三选一 */
  page?: ChatPageContext;
  /** 多来源探究会话；与 page、clipId 三选一 */
  scope?: ChatScope;
  title: string;
  messages: ChatMessage[];
  createdAt: string;
  updatedAt: string;
}

export interface ChatIndexEntry {
  id: string;
  title: string;
  clipId?: string;
  /** 网页对话的原始页面地址，用于历史列表中重新打开原网页 */
  url?: string;
  messageCount: number;
  updatedAt: string;
}
