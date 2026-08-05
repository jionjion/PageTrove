import type { ChatToolCall } from '@/types/chat';

/* ---------- 领域侧共享类型(UI/编排/提示词共用) ---------- */

export interface ResolvedChatSource {
  id: string;
  /** 引用编号：S1、S2…… */
  citation: string;
  title: string;
  url: string;
  content: string;
}

export interface ChatContext {
  title: string;
  url: string;
  content: string;
  /** 多来源探究会话解析后的来源列表；存在时使用多来源 Prompt。 */
  sources?: ResolvedChatSource[];
  /** 本次被跳过的失效来源（如收藏已删除），用于提示模型不要沿用历史引用。 */
  unavailableSources?: string[];
}

export interface ChatToolActivity extends Omit<ChatToolCall, 'status'> {
  status: 'running' | 'success' | 'error';
}

export interface ChatStreamOptions {
  imageDataUrl?: string;
  onToolActivity?: (activity: ChatToolActivity) => void;
}

export interface ChatStreamResult {
  content: string;
  /** 服务端返回的 token 统计；部分兼容网关可能不返回。 */
  usage?: TokenUsage;
  /** 从发起请求到最终回答完成的耗时（毫秒）。 */
  elapsedMs: number;
  toolCalls: ChatToolCall[];
}

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
}

/* ---------- OpenAI 兼容协议侧类型(provider/orchestrator 共用) ---------- */

export type TextPart = { type: 'text'; text: string };
export type ImagePart = {
  type: 'image_url';
  image_url: { url: string; detail?: 'auto' | 'low' | 'high' };
};

export type OpenAIToolCall = {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
};

export type OpenAIMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string | (TextPart | ImagePart)[] }
  | { role: 'assistant'; content: string | null; tool_calls?: OpenAIToolCall[] }
  | { role: 'tool'; tool_call_id: string; content: string };

export type OpenAITool = {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
};

/** 单轮流式请求的结果。 */
export interface RoundResult {
  content: string;
  toolCalls: OpenAIToolCall[];
  usage?: TokenUsage;
}
