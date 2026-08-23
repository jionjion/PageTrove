export interface ChatMessage {
  /** 新消息的稳定标识；旧数据可能没有。 */
  id?: string;
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
  /**
   * 生成当时的引用映射（仅多来源 assistant 消息）。
   * 渲染 [S1] 时只读自身映射，不依赖当前 scope 下标，
   * 避免来源删除/失效重编号后历史回答错指来源。
   */
  citationRefs?: CitationRef[];
}

/** 单条 assistant 消息的引用条目：编号→来源快照。 */
export interface CitationRef {
  /** 引用编号，如 'S1' */
  citation: string;
  /** 对应 ResolvedChatSource.id */
  sourceId: string;
  title: string;
  url: string;
}

export interface ChatToolCall {
  id: string;
  serverName: string;
  toolName: string;
  /**
   * unknown 表示已获授权并开始调用，但因取消、超时或断线无法确认外部副作用是否完成。
   */
  status: 'success' | 'error' | 'denied' | 'unknown';
  /** claimed 表示调用前租约；in-doubt 表示已发起但结果无法确认。 */
  phase?: 'claimed' | 'in-doubt';
  /** claimed 租约的起始时间；终态保留该值供审计。 */
  claimedAt?: string;
  /** 仅保存按 user turn 隔离的单向操作指纹，不保存原始参数。 */
  operationKey?: string;
  /** 对应的稳定 user message id，用于重试去重。 */
  turnId?: string;
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
  /**
   * 每次成功写入都会更换的乐观并发令牌。
   * 旧数据可能没有该字段；首次更新后会自动补齐。
   */
  revision?: string;
  /** 关联的收藏；与 page、scope 三选一 */
  clipId?: string;
  /** 当前网页对话的页面快照；与 clipId、scope 三选一 */
  page?: ChatPageContext;
  /** 多来源探究会话；与 page、clipId 三选一 */
  scope?: ChatScope;
  title: string;
  messages: ChatMessage[];
  /**
   * 独立于最终 assistant 消息的 MCP 执行审计日志。
   * 工具一旦开始即写入 unknown，即使后续模型轮次失败也不会丢失。
   */
  toolExecutions?: ChatToolCall[];
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
