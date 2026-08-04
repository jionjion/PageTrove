import type { AnalyzeResult } from '@/types/ai';
import type { PageSnapshot } from '@/types/page-snapshot';
import { getModelCapabilities, type ExtensionSettings } from '@/types/settings';
import { AppError } from '@/utils/errors';
import type { ChatToolCall } from '@/types/chat';
import {
  callMcpTool,
  collectEnabledMcpTools,
  type ModelMcpTool,
} from '@/services/mcp-client';

const SYSTEM_PROMPT = `你是一个"有趣网站收藏整理助手"。

你的任务是根据用户提供的网页快照，整理这个网站值得收藏的原因，并输出结构化 json 结果。

要求：

1. 只能依据输入内容，不得虚构网页功能。
2. 如果网页信息不足，应明确体现"信息不足"。
3. 摘要用于让用户快速了解这个收藏：说明网站是什么、有什么内容、为什么值得收藏，控制在100个汉字以内。
4. 标签输出3至5个。
5. 不要复述大段网页原文。
6. 不要输出Markdown。
7. 只输出符合下面结构的 json，不要输出其他内容：

{
  "summary": "摘要",
  "tags": ["标签1", "标签2", "标签3"],
  "confidence": 0.85
}

confidence 为0到1之间的小数。`;

const SYSTEM_PROMPT_WITH_CONTENT = `你是一个"有趣网站收藏整理助手"。

你的任务是根据用户提供的网页快照，整理这个网站值得收藏的原因，并输出结构化 json 结果。

要求：

1. 只能依据输入内容，不得虚构网页功能。
2. 如果网页信息不足，应明确体现"信息不足"。
3. 摘要用于让用户快速了解这个收藏：说明网站是什么、有什么内容、为什么值得收藏，控制在100个汉字以内。
4. 标签输出3至5个。
5. content 是必填字段，为清洗整理后的正文，绝对不能省略这个字段：
   - 删掉导航、菜单、广告、推荐位、相关文章、评论、页脚、订阅提示等噪音。
   - 正文的信息要完整保留：所有段落、章节、要点都要输出，不要概括压缩成摘要，也不要只输出开头。原文有多长，content 就应该差不多多长，长输出是预期内的。
   - 用 Markdown 还原文章结构：章节标题用 #/##/### ，列表用 - 或 1. ，表格用 Markdown 表格，代码用 \`\`\` 代码块，段落间空行分隔。
   - 表述尽量沿用原文，不要自己发挥。
   - 仅当正文本身很短或页面没有文章主体时，content 输出空字符串 ""。
6. summary 和 tags 不要输出 Markdown；content 使用 Markdown 格式。
7. 只输出符合下面结构的 json，不要输出其他内容：

{
  "summary": "摘要",
  "tags": ["标签1", "标签2", "标签3"],
  "content": "Markdown 格式的正文",
  "confidence": 0.85
}

confidence 为0到1之间的小数。`;

function buildUserPrompt(snapshot: PageSnapshot, note: string): string {
  return `请整理下面的网页快照，输出 json。

网页标题：
${snapshot.title || '（无）'}

网页地址：
${snapshot.url}

网页描述：
${snapshot.description || '（无）'}

用户选中的内容：
${snapshot.selectedText || '（无）'}

网页正文：
${snapshot.mainText || '（无）'}

用户备注：
${note || '（无）'}`;
}

const LIMITS = {
  summary: 200,
  tagMax: 5,
  tagLength: 20,
  content: 200_000,
};

function cleanStringArray(value: unknown, maxItems: number, maxLength: number): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim().slice(0, maxLength))
    .filter(Boolean)
    .slice(0, maxItems);
}

function validateAnalyzeResult(raw: unknown): AnalyzeResult {
  if (typeof raw !== 'object' || raw === null) {
    throw new AppError('INVALID_AI_RESPONSE');
  }
  const data = raw as Record<string, unknown>;

  const summary =
    typeof data.summary === 'string' ? data.summary.trim().slice(0, LIMITS.summary) : '';
  if (!summary) {
    throw new AppError('INVALID_AI_RESPONSE');
  }

  const tags = cleanStringArray(data.tags, LIMITS.tagMax, LIMITS.tagLength);
  if (tags.length === 0) {
    throw new AppError('INVALID_AI_RESPONSE');
  }

  const confidence =
    typeof data.confidence === 'number'
      ? Math.min(1, Math.max(0, data.confidence))
      : 0.5;

  const content =
    typeof data.content === 'string'
      ? data.content.trim().slice(0, LIMITS.content) || undefined
      : undefined;

  return {
    summary,
    tags,
    content,
    confidence,
  };
}

async function requestChatCompletion(
  settings: ExtensionSettings,
  snapshot: PageSnapshot,
  note: string,
  refineContent: boolean,
): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 180_000);

  let response: Response;
  try {
    response = await fetch(
      `${settings.baseUrl.replace(/\/$/, '')}/chat/completions`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${settings.apiKey}`,
        },
        body: JSON.stringify({
          model: settings.model,
          messages: [
            {
              role: 'system',
              content: refineContent
                ? SYSTEM_PROMPT_WITH_CONTENT
                : SYSTEM_PROMPT,
            },
            { role: 'user', content: buildUserPrompt(snapshot, note) },
          ],
          response_format: { type: 'json_object' },
          temperature: 0.3,
          // 整理任务不需要深度思考；两种字段兼容不同网关（DashScope 顶层 / vLLM chat_template_kwargs）
          enable_thinking: false,
          chat_template_kwargs: { enable_thinking: false },
          stream: false,
        }),
        signal: controller.signal,
      },
    );
  } catch {
    throw new AppError('NETWORK_ERROR');
  } finally {
    clearTimeout(timer);
  }

  if (response.status === 401 || response.status === 402 || response.status === 403) {
    throw new AppError('AI_UNAUTHORIZED');
  }
  if (!response.ok) {
    throw new AppError('AI_ANALYZE_FAILED', `AI 分析失败（HTTP ${response.status}）`);
  }

  const body = (await response.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const content = body.choices?.[0]?.message?.content;
  if (!content) {
    throw new AppError('INVALID_AI_RESPONSE');
  }
  return content;
}

export async function analyzePage(
  snapshot: PageSnapshot,
  note: string,
  settings: ExtensionSettings,
  refineContent: boolean,
): Promise<AnalyzeResult> {
  if (!settings.apiKey.trim()) {
    throw new AppError('MISSING_API_KEY');
  }

  if (!snapshot.mainText && !snapshot.selectedText && !snapshot.description) {
    throw new AppError('EMPTY_CONTENT');
  }

  // 输出解析失败时允许重试一次
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    const content = await requestChatCompletion(
      settings,
      snapshot,
      note,
      refineContent,
    );
    try {
      return validateAnalyzeResult(JSON.parse(content));
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof AppError
    ? lastError
    : new AppError('INVALID_AI_RESPONSE');
}

/* ------------------------- 网页对话（流式） ------------------------- */

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

const MULTI_SOURCE_PROMPT = `你是"拾页"的多来源研究助手。

1. 只根据提供的资料回答；资料不足时明确说明。
2. 每个来自资料的事实或结论，使用 [S1]、[S2] 标明来源。
3. 不得引用没有提供的来源，不得伪造引用。
4. 如果不同来源存在冲突，分别陈述并标明来源。
5. 可以做综合归纳，但要明确说明这是综合判断。
6. 回答使用中文，简洁清晰。
7. MCP 工具得到的新信息不能伪装成页面来源；如使用工具，应单独说明。`;

function buildChatSystemPrompt(ctx: ChatContext): string {
  if (ctx.sources && ctx.sources.length > 0) {
    const blocks = ctx.sources.map(
      (source) =>
        `[${source.citation}]\n标题：${source.title}\n地址：${source.url}\n内容：\n${source.content || '（内容为空）'}`,
    );
    const unavailable =
      ctx.unavailableSources && ctx.unavailableSources.length > 0
        ? `\n\n注意：以下来源已失效，本次未提供其内容。历史对话中的引用编号可能与本次不同；请仅使用上面资料的编号标注，不要沿用历史回答里的编号，也不要再引用失效来源：${ctx.unavailableSources.join('、')}`
        : '';
    return `${MULTI_SOURCE_PROMPT}\n\n以下是本次可用的资料：\n\n${blocks.join('\n\n')}${unavailable}`;
  }

  return `你是"拾页"的网页问答助手。请基于下面的网页内容回答用户的问题。

要求：

1. 优先依据网页内容回答；网页内容中没有的信息要如实说明，不得编造。
2. 回答使用中文，简洁明了。
3. 可以结合常识做适度延伸，但要区分"网页内容"和"你的补充"。
4. 如果提供了 MCP 工具，可以在确有必要时主动调用；不要为了展示工具而调用。

网页标题：${ctx.title}
网页地址：${ctx.url}

网页内容：
${ctx.content || '（内容为空）'}`;
}

/** 只发送最近的若干轮，避免上下文无限增长。 */
const MAX_HISTORY_MESSAGES = 12;
const MAX_TOOL_ROUNDS = 16;
const MAX_TOOL_CALLS = 40;

type TextPart = { type: 'text'; text: string };
type ImagePart = {
  type: 'image_url';
  image_url: { url: string; detail?: 'auto' | 'low' | 'high' };
};

type OpenAIToolCall = {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
};

type OpenAIMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string | (TextPart | ImagePart)[] }
  | { role: 'assistant'; content: string | null; tool_calls?: OpenAIToolCall[] }
  | { role: 'tool'; tool_call_id: string; content: string };

interface RoundResult {
  content: string;
  toolCalls: OpenAIToolCall[];
  usage?: ChatStreamResult['usage'];
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
  usage?: {
    promptTokens: number;
    completionTokens: number;
  };
  /** 从发起请求到最终回答完成的耗时（毫秒）。 */
  elapsedMs: number;
  toolCalls: ChatToolCall[];
}

function buildMessages(
  ctx: ChatContext,
  history: { role: 'user' | 'assistant'; content: string }[],
  imageDataUrl?: string,
): OpenAIMessage[] {
  const messages: OpenAIMessage[] = [
    { role: 'system', content: buildChatSystemPrompt(ctx) },
    ...history.slice(-MAX_HISTORY_MESSAGES).map(
      (message): OpenAIMessage => ({
        role: message.role,
        content: message.content,
      }),
    ),
  ];

  if (imageDataUrl) {
    for (let index = messages.length - 1; index >= 0; index--) {
      const message = messages[index];
      if (message.role !== 'user') continue;
      const text = typeof message.content === 'string' ? message.content : '';
      message.content = [
        { type: 'text', text },
        {
          type: 'image_url',
          image_url: { url: imageDataUrl, detail: 'high' },
        },
      ];
      break;
    }
  }

  return messages;
}

function toOpenAITools(tools: ModelMcpTool[]) {
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
  current: ChatStreamResult['usage'],
  next: ChatStreamResult['usage'],
): ChatStreamResult['usage'] {
  if (!current) return next;
  if (!next) return current;
  return {
    promptTokens: current.promptTokens + next.promptTokens,
    completionTokens: current.completionTokens + next.completionTokens,
  };
}

async function requestChatRound(
  settings: ExtensionSettings,
  messages: OpenAIMessage[],
  tools: ReturnType<typeof toOpenAITools>,
  onDelta: (fullText: string) => void,
  signal: AbortSignal,
): Promise<RoundResult> {
  let response: Response;
  try {
    response = await fetch(
      `${settings.baseUrl.replace(/\/$/, '')}/chat/completions`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${settings.apiKey}`,
        },
        body: JSON.stringify({
          model: settings.model,
          messages,
          ...(tools.length > 0 ? { tools, tool_choice: 'auto' } : {}),
          temperature: 1.0,
          stream: true,
          stream_options: { include_usage: true },
        }),
        signal,
      },
    );
  } catch (error) {
    if (signal.aborted) throw error;
    throw new AppError('NETWORK_ERROR');
  }

  if (response.status === 401 || response.status === 402 || response.status === 403) {
    throw new AppError('AI_UNAUTHORIZED');
  }
  if (!response.ok || !response.body) {
    throw new AppError(
      'AI_ANALYZE_FAILED',
      `AI 请求失败（HTTP ${response.status}）`,
    );
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let content = '';
  let usage: ChatStreamResult['usage'];
  const toolCalls: OpenAIToolCall[] = [];

  const processLine = (line: string) => {
    const trimmed = line.trim();
    if (!trimmed.startsWith('data:')) return;
    const payload = trimmed.slice(5).trim();
    if (!payload || payload === '[DONE]') return;

    try {
      const chunk = JSON.parse(payload) as {
        choices?: {
          delta?: {
            content?: string;
            tool_calls?: {
              index?: number;
              id?: string;
              type?: 'function';
              function?: { name?: string; arguments?: string };
            }[];
          };
        }[];
        usage?: { prompt_tokens?: number; completion_tokens?: number } | null;
      };
      const delta = chunk.choices?.[0]?.delta;
      if (delta?.content) {
        content += delta.content;
        onDelta(content);
      }
      for (const callDelta of delta?.tool_calls ?? []) {
        const index = callDelta.index ?? 0;
        const call =
          toolCalls[index] ??
          (toolCalls[index] = {
            id: '',
            type: 'function',
            function: { name: '', arguments: '' },
          });
        if (callDelta.id) call.id += callDelta.id;
        if (callDelta.function?.name) {
          call.function.name += callDelta.function.name;
        }
        if (callDelta.function?.arguments) {
          call.function.arguments += callDelta.function.arguments;
        }
      }
      if (chunk.usage) {
        usage = {
          promptTokens: chunk.usage.prompt_tokens ?? 0,
          completionTokens: chunk.usage.completion_tokens ?? 0,
        };
      }
    } catch {
      // 跳过无法解析的兼容接口 SSE 行。
    }
  };

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      lines.forEach(processLine);
    }
    buffer += decoder.decode();
    if (buffer.trim()) processLine(buffer);
  } finally {
    reader.releaseLock();
  }

  const normalizedCalls = toolCalls
    .filter((call) => call?.function.name)
    .map((call, index) => ({
      ...call,
      id: call.id || `tool-call-${Date.now()}-${index}`,
    }));
  if (!content.trim() && normalizedCalls.length === 0) {
    throw new AppError('INVALID_AI_RESPONSE');
  }
  return { content, toolCalls: normalizedCalls, usage };
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

    const messages = buildMessages(ctx, history, options.imageDataUrl);
    const openAITools = toOpenAITools(tools);
    const toolMap = new Map(tools.map((tool) => [tool.modelName, tool]));
    const serverMap = new Map(
      settings.mcpServers.map((server) => [server.id, server]),
    );
    const previousToolResults = new Map<string, string>();
    let totalUsage: ChatStreamResult['usage'];
    let totalToolCalls = 0;

    for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
      const result = await requestChatRound(
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