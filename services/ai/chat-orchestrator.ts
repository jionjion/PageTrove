import type { ChatToolCall } from '@/types/chat';
import { getModelCapabilities, type ExtensionSettings } from '@/types/settings';
import { AppError } from '@/utils/errors';
import {
  callMcpTool,
  collectEnabledMcpTools,
  type ModelMcpTool,
} from '@/services/mcp-client';
import type {
  ChatContext,
  ChatStreamOptions,
  ChatStreamResult,
  OpenAIMessage,
  OpenAITool,
  TokenUsage,
} from '@/services/ai/provider';
import { buildChatMessages } from '@/services/ai/prompt-builder';
import { requestStreamingRound } from '@/services/ai/openai-compatible-provider';

/**
 * 对话编排:历史截断、MCP 工具循环、usage 汇总。
 * provider 只处理请求/流协议;本模块不读取 React 状态或 IndexedDB。
 */

const MAX_TOOL_ROUNDS = 16;
const MAX_TOOL_CALLS = 40;

function toOpenAITools(tools: ModelMcpTool[]): OpenAITool[] {
  return tools.map((tool) => ({
    type: 'function' as const,
    function: {
      name: tool.modelName,
      description: `[${tool.serverName}] ${tool.description || tool.toolName}`,
      parameters: tool.inputSchema,
    },
  }));
}

function mergeUsage(
  current: TokenUsage | undefined,
  next: TokenUsage | undefined,
): TokenUsage | undefined {
  if (!current) return next;
  if (!next) return current;
  return {
    promptTokens: current.promptTokens + next.promptTokens,
    completionTokens: current.completionTokens + next.completionTokens,
  };
}

function parseToolArguments(value: string): Record<string, unknown> {
  if (!value.trim()) return {};
  try {
    const parsed = JSON.parse(value);
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function normalizeToolArgs(args: Record<string, unknown>): string {
  return JSON.stringify(
    Object.keys(args)
      .sort()
      .reduce<Record<string, unknown>>((result, key) => {
        result[key] = args[key];
        return result;
      }, {}),
  );
}

/**
 * 流式对话，支持当前请求的一张区域截图和 MCP 工具调用循环。
 * 截图仅存在于本次请求参数，不会写入聊天记录。
 */
export async function streamChat(
  ctx: ChatContext,
  history: { role: 'user' | 'assistant'; content: string }[],
  settings: ExtensionSettings,
  onDelta: (fullText: string) => void,
  signal?: AbortSignal,
  options: ChatStreamOptions = {},
): Promise<ChatStreamResult> {
  if (!settings.apiKey.trim()) {
    throw new AppError('MISSING_API_KEY');
  }

  const startedAt = performance.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 120_000);
  const abortFromCaller = () => controller.abort();
  signal?.addEventListener('abort', abortFromCaller, { once: true });

  const completedCalls: ChatToolCall[] = [];
  let tools: ModelMcpTool[] = [];
  const capabilities = getModelCapabilities(settings);

  try {
    if (options.imageDataUrl && !capabilities.vision) {
      throw new AppError(
        'AI_ANALYZE_FAILED',
        '当前模型未启用图片输入，请在设置中开启后重试',
      );
    }

    if (capabilities.tools && settings.mcpServers.some((server) => server.enabled)) {
      const collection = await collectEnabledMcpTools(settings.mcpServers);
      tools = collection.tools;
      for (const warning of collection.warnings) {
        const call: ChatToolCall = {
          id: `mcp-warning-${crypto.randomUUID()}`,
          serverName: warning.serverName,
          toolName: '连接服务',
          status: 'error',
          summary: warning.message,
        };
        completedCalls.push(call);
        options.onToolActivity?.(call);
      }
    }

    const messages: OpenAIMessage[] = buildChatMessages(
      ctx,
      history,
      options.imageDataUrl,
    );
    const openAITools = toOpenAITools(tools);
    const toolMap = new Map(tools.map((tool) => [tool.modelName, tool]));
    const serverMap = new Map(
      settings.mcpServers.map((server) => [server.id, server]),
    );
    const previousToolResults = new Map<string, string>();
    let totalUsage: TokenUsage | undefined;
    let totalToolCalls = 0;

    for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
      const result = await requestStreamingRound(
        settings,
        messages,
        openAITools,
        onDelta,
        controller.signal,
      );
      totalUsage = mergeUsage(totalUsage, result.usage);

      if (result.toolCalls.length === 0) {
        return {
          content: result.content,
          usage: totalUsage,
          elapsedMs: Math.round(performance.now() - startedAt),
          toolCalls: completedCalls,
        };
      }
      if (round === MAX_TOOL_ROUNDS) {
        throw new AppError('AI_ANALYZE_FAILED', '工具调用轮次过多，已停止');
      }

      totalToolCalls += result.toolCalls.length;
      if (totalToolCalls > MAX_TOOL_CALLS) {
        throw new AppError('AI_ANALYZE_FAILED', '单次请求调用工具过多，已停止');
      }

      messages.push({
        role: 'assistant',
        content: result.content || null,
        tool_calls: result.toolCalls,
      });
      onDelta('');

      for (const requested of result.toolCalls) {
        const definition = toolMap.get(requested.function.name);
        const activityBase = {
          id: requested.id,
          serverName: definition?.serverName ?? '未知 MCP 服务',
          toolName: definition?.toolName ?? requested.function.name,
        };
        options.onToolActivity?.({ ...activityBase, status: 'running' });

        let toolResult: string;
        let completed: ChatToolCall;
        try {
          if (!definition) throw new Error('模型请求了未启用的工具');
          const server = serverMap.get(definition.serverId);
          if (!server?.enabled) throw new Error('MCP 服务已停用');

          const parsedArgs = parseToolArguments(requested.function.arguments);
          const toolCallKey = `${definition.serverId}:${definition.toolName}:${normalizeToolArgs(parsedArgs)}`;
          const previousResult = previousToolResults.get(toolCallKey);

          if (previousResult) {
            toolResult = [
              '该工具刚刚已用相同参数执行过一次，以下是上次结果。',
              '如需继续，请基于该结果直接回答，除非用户明确要求再次执行。',
              '',
              previousResult,
            ].join('\n');
          } else {
            toolResult = await callMcpTool(server, definition.toolName, parsedArgs);
            previousToolResults.set(toolCallKey, toolResult);
          }

          completed = {
            ...activityBase,
            status: 'success',
            summary: toolResult,
          };
        } catch (error) {
          toolResult = `工具调用失败：${
            error instanceof Error ? error.message : String(error)
          }`;
          completed = {
            ...activityBase,
            status: 'error',
            summary: toolResult,
          };
        }

        completedCalls.push(completed);
        options.onToolActivity?.(completed);
        messages.push({
          role: 'tool',
          tool_call_id: requested.id,
          content: toolResult.slice(0, 50_000),
        });
      }
    }

    throw new AppError('INVALID_AI_RESPONSE');
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abortFromCaller);
  }
}
