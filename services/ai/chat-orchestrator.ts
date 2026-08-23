import type { ChatToolCall } from '@/types/chat';
import { getModelCapabilities, type ExtensionSettings } from '@/types/settings';
import type { ToolApprovalDecision, ToolApprovalRequest } from '@/types/mcp-tool';
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
import {
  assessToolRisk,
  buildToolArgumentsPreview,
  buildToolOperationKey,
  parseAndValidateToolArguments,
} from '@/services/mcp-tool-policy';

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

function throwIfAborted(signal: AbortSignal): void {
  if (!signal.aborted) return;
  throw signal.reason ?? new DOMException('请求已取消', 'AbortError');
}

function persistedToolSummary(status: ChatToolCall['status'], length = 0): string {
  switch (status) {
    case 'success':
      return `调用成功（结果 ${length} 个字符，完整结果未保存）`;
    case 'denied':
      return '用户拒绝了本次调用';
    case 'error':
      return '调用失败（详细错误未保存）';
    case 'unknown':
      return '已开始调用，但结果无法确认；重试前请先检查外部系统';
  }
}

async function waitForToolApproval(
  handler: NonNullable<ChatStreamOptions['requestToolApproval']>,
  request: ToolApprovalRequest,
  turnController: AbortController,
  pauseNetworkTimer: () => void,
  resumeNetworkTimer: () => void,
): Promise<ToolApprovalDecision> {
  // 人工阅读参数不消耗 120 秒网络预算；审批本身仍受用户取消信号控制。
  pauseNetworkTimer();
  try {
    return await handler(request, turnController.signal);
  } finally {
    if (!turnController.signal.aborted) resumeNetworkTimer();
  }
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
  let timer = setTimeout(
    () => controller.abort(new AppError('REQUEST_TIMEOUT')),
    120_000,
  );
  const pauseNetworkTimer = () => clearTimeout(timer);
  const restartNetworkTimer = () => {
    clearTimeout(timer);
    timer = setTimeout(() => controller.abort(new AppError('REQUEST_TIMEOUT')), 120_000);
  };
  const abortFromCaller = () =>
    controller.abort(signal?.reason ?? new DOMException('请求已取消', 'AbortError'));
  if (signal?.aborted) abortFromCaller();
  else signal?.addEventListener('abort', abortFromCaller, { once: true });

  const completedCalls: ChatToolCall[] = [];
  let tools: ModelMcpTool[] = [];
  const capabilities = getModelCapabilities(settings);

  try {
    throwIfAborted(controller.signal);
    if (options.imageDataUrl && !capabilities.vision) {
      throw new AppError(
        'AI_ANALYZE_FAILED',
        '当前模型未启用图片输入，请在设置中开启后重试',
      );
    }

    if (capabilities.tools && settings.mcpServers.some((server) => server.enabled)) {
      const collection = await collectEnabledMcpTools(settings.mcpServers, {
        signal: controller.signal,
      });
      tools = collection.tools;
      for (const warning of collection.warnings) {
        const call: ChatToolCall = {
          id: `mcp-warning-${crypto.randomUUID()}`,
          serverName: warning.serverName,
          toolName: '连接服务',
          status: 'error',
          summary: '连接失败（详细错误未保存）',
        };
        completedCalls.push(call);
        options.onToolActivity?.({
          ...call,
          summary: `连接失败：${warning.message}`.slice(0, 1_000),
        });
      }
    }

    const messages: OpenAIMessage[] = buildChatMessages(
      ctx,
      history,
      options.imageDataUrl,
    );
    const openAITools = toOpenAITools(tools);
    const toolMap = new Map(tools.map((tool) => [tool.modelName, tool]));
    const serverMap = new Map(settings.mcpServers.map((server) => [server.id, server]));
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
        throwIfAborted(controller.signal);
        const definition = toolMap.get(requested.function.name);
        const activityBase = {
          // 模型的 tool_call id 可能跨轮重复；审计 id 必须全局唯一。
          id: crypto.randomUUID(),
          serverName: definition?.serverName ?? '未知 MCP 服务',
          toolName: definition?.toolName ?? requested.function.name,
        };
        let toolResult: string;
        let completed: ChatToolCall;
        let executionStarted = false;
        let claimedExecution: ChatToolCall | undefined;
        try {
          if (!definition) throw new Error('模型请求了未启用的工具');
          const server = serverMap.get(definition.serverId);
          if (!server?.enabled) throw new Error('MCP 服务已停用');

          const parsed = parseAndValidateToolArguments(
            requested.function.arguments,
            definition.inputSchema,
          );
          if (!parsed.ok) {
            toolResult = parsed.message;
            completed = {
              ...activityBase,
              status: 'error',
              summary: '参数校验失败，工具未执行',
            };
            completedCalls.push(completed);
            options.onToolActivity?.(completed);
            messages.push({
              role: 'tool',
              tool_call_id: requested.id,
              content: toolResult,
            });
            continue;
          }

          const approvalRequest: ToolApprovalRequest = {
            requestId: crypto.randomUUID(),
            toolCallId: requested.id,
            serverId: definition.serverId,
            serverName: definition.serverName,
            toolName: definition.toolName,
            description: definition.description,
            argumentsPreview: buildToolArgumentsPreview(parsed.arguments),
            annotations: definition.annotations,
            risk: assessToolRisk(definition.annotations),
          };
          options.onToolActivity?.({
            ...activityBase,
            status: 'awaiting-approval',
            summary: '等待用户确认',
          });
          const decision: ToolApprovalDecision = options.requestToolApproval
            ? await waitForToolApproval(
                options.requestToolApproval,
                approvalRequest,
                controller,
                pauseNetworkTimer,
                restartNetworkTimer,
              )
            : { kind: 'deny' };
          throwIfAborted(controller.signal);

          if (decision.kind !== 'approve-once') {
            toolResult =
              decision.kind === 'continue-without-execution'
                ? '用户已核对先前的外部执行，并选择只继续生成回答；本次工具未再次执行。'
                : '用户拒绝了本次工具调用。请不要假设工具已经执行。';
            completed = {
              ...activityBase,
              status: 'denied',
              summary: persistedToolSummary('denied'),
            };
          } else {
            if (!options.onToolExecution || !options.toolTurnId) {
              throw new Error('工具执行审计不可用');
            }
            const operationKey = await buildToolOperationKey({
              turnId: options.toolTurnId,
              endpoint: server.url,
              serverId: definition.serverId,
              toolName: definition.toolName,
              arguments: parsed.arguments,
            });
            const startedExecution: ChatToolCall = {
              ...activityBase,
              status: 'unknown',
              phase: 'claimed',
              claimedAt: new Date().toISOString(),
              operationKey,
              turnId: options.toolTurnId,
              summary: '已获授权，等待执行',
            };
            // 先持久化 claimed 再调用远端：没有耐久 claim 就绝不发起副作用。
            claimedExecution = startedExecution;
            const claim = await options.onToolExecution(startedExecution);
            if (claim.kind !== 'recorded') {
              claimedExecution = undefined;
              throwIfAborted(controller.signal);
              completed = claim.execution;
              toolResult =
                claim.kind === 'already-success'
                  ? '相同操作在本次用户问题中先前已成功执行，本次未重复执行。'
                  : '相同操作的先前执行结果未知，本次已阻止重复执行。请用户先检查外部系统。';
              completedCalls.push(completed);
              options.onToolActivity?.(completed);
              messages.push({
                role: 'tool',
                tool_call_id: requested.id,
                content: toolResult,
              });
              continue;
            }
            claimedExecution = claim.execution;
            throwIfAborted(controller.signal);
            executionStarted = true;
            options.onToolActivity?.({
              ...activityBase,
              status: 'running',
              summary: '已获本次授权，正在执行',
            });
            const remoteResult = await callMcpTool(
              server,
              definition.toolName,
              parsed.arguments,
              { signal: controller.signal },
            );
            toolResult = remoteResult.isError
              ? '工具返回了业务错误；调用已发起，副作用结果无法确认。请不要自动重试。'
              : remoteResult.text;
            completed = {
              ...claimedExecution,
              status: remoteResult.isError ? 'unknown' : 'success',
              phase: remoteResult.isError ? 'in-doubt' : undefined,
              summary: persistedToolSummary(
                remoteResult.isError ? 'unknown' : 'success',
                remoteResult.text.length,
              ),
            };
          }
        } catch (error) {
          if (controller.signal.aborted) {
            // claim 已尝试落盘后的取消都按结果未知收敛。即使终态写入失败，
            // 已落盘的 claimed 仍会阻止短时间内重复执行，不覆盖原始 AbortError。
            if (claimedExecution) {
              const inDoubt: ChatToolCall = {
                ...claimedExecution,
                status: 'unknown',
                phase: 'in-doubt',
                summary: persistedToolSummary('unknown'),
              };
              try {
                const recorded = await options.onToolExecution!(inDoubt);
                options.onToolActivity?.(recorded.execution);
              } catch {
                // claim 写入本身失败，或结算与其他终态竞争；两者都不应吞掉取消原因。
              }
            }
            throw controller.signal.reason ?? error;
          }
          // 远端错误可能包含 URL、认证细节或其他不可信文本，不写入模型历史。
          toolResult = executionStarted
            ? '工具调用已开始，但结果无法确认。请不要自动重试，也不要假设调用失败。'
            : '工具调用失败：工具未执行，请不要假设调用成功。';
          completed = {
            ...(claimedExecution ?? activityBase),
            status: executionStarted ? 'unknown' : 'error',
            phase: executionStarted ? 'in-doubt' : undefined,
            summary: persistedToolSummary(executionStarted ? 'unknown' : 'error'),
          };
        }

        if (executionStarted) {
          const recorded = await options.onToolExecution!(completed);
          completed = recorded.execution;
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
