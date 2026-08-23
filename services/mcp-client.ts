import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { CfWorkerJsonSchemaValidator } from '@modelcontextprotocol/sdk/validation/cfworker';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { McpServerSettings, McpTransport } from '@/types/settings';
import type { McpToolAnnotations } from '@/types/mcp-tool';

// SDK 默认的 Ajv 校验器用 new Function 生成校验函数，会触发扩展页的
// script-src 'self' CSP；这里改用不生成代码的 cfworker 校验器。
const schemaValidator = new CfWorkerJsonSchemaValidator();

export interface McpToolSummary {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown> | boolean;
  annotations?: McpToolAnnotations;
}

export interface McpConnectionTestResult {
  transport: McpTransport;
  tools: McpToolSummary[];
}

export interface ModelMcpTool extends McpToolSummary {
  modelName: string;
  serverId: string;
  serverName: string;
  toolName: string;
}

export interface McpToolCollection {
  tools: ModelMcpTool[];
  warnings: { serverName: string; message: string }[];
}

interface ConnectedClient {
  client: Client;
  transport: Transport;
  transportKind: McpTransport;
}

const CONNECTION_TIMEOUT_MS = 15_000;
const CLOSE_TIMEOUT_MS = 1_000;
const TOOL_CACHE_MS = 5 * 60_000;
const MAX_TOOLS_PER_SERVER = 100;
const MAX_TOTAL_TOOLS = 128;
const MAX_MCP_JSON_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_MCP_STREAM_RESPONSE_BYTES = 8 * 1024 * 1024;
const MAX_RESULT_TEXT_CHARS = 100_000;
const MAX_RESULT_BLOCKS = 100;
const MAX_TEXT_BLOCK_CHARS = 50_000;
const MAX_STRUCTURED_CONTENT_CHARS = 50_000;
const MAX_RESOURCE_BLOCK_CHARS = 10_000;
const MAX_JSON_DEPTH = 8;
const MAX_JSON_NODES = 1_000;
const MAX_JSON_MEMBERS = 100;
const MAX_JSON_STRING_CHARS = 20_000;
const TRUNCATION_MARKER = '…[内容已截断]';
const toolCache = new Map<
  string,
  {
    signature: string;
    expiresAt: number;
    result: McpConnectionTestResult;
  }
>();

export interface McpOperationOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
}

export interface ListMcpToolsOptions extends McpOperationOptions {
  useCache?: boolean;
}

class BoundedTextBuilder {
  private readonly chunks: string[] = [];
  private currentLength = 0;

  constructor(private readonly maxLength: number) {}

  get length(): number {
    return this.currentLength;
  }

  get remaining(): number {
    return this.maxLength - this.currentLength;
  }

  append(value: string): void {
    if (this.remaining <= 0 || !value) return;
    const chunk = value.length <= this.remaining ? value : value.slice(0, this.remaining);
    this.chunks.push(chunk);
    this.currentLength += chunk.length;
  }

  appendTruncated(value: string, maxChars: number): void {
    const limit = Math.min(maxChars, this.remaining);
    if (limit <= 0) return;
    if (value.length <= limit) {
      this.append(value);
      return;
    }
    if (limit <= TRUNCATION_MARKER.length) {
      this.append(TRUNCATION_MARKER.slice(0, limit));
      return;
    }
    this.append(value.slice(0, limit - TRUNCATION_MARKER.length));
    this.append(TRUNCATION_MARKER);
  }

  toString(): string {
    return this.chunks.join('');
  }
}

function responseTooLarge(maxBytes: number): Error {
  return new Error(`MCP 响应体超过 ${maxBytes} 字节限制`);
}

function responseByteLimit(response: Response): number {
  const contentType = response.headers.get('content-type')?.toLowerCase();
  return contentType?.includes('text/event-stream')
    ? MAX_MCP_STREAM_RESPONSE_BYTES
    : MAX_MCP_JSON_RESPONSE_BYTES;
}

/** 为 SDK 保留流式读取语义，同时在解析 JSON/SSE 前限制实际读取的响应字节数。 */
export function limitMcpResponseBody(
  response: Response,
  maxBytes = responseByteLimit(response),
): Response {
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
    throw new TypeError('MCP 响应体限制必须是正整数');
  }

  const rawLength = response.headers.get('content-length');
  if (rawLength) {
    const contentLength = Number(rawLength);
    if (Number.isFinite(contentLength) && contentLength > maxBytes) {
      void response.body?.cancel().catch(() => undefined);
      throw responseTooLarge(maxBytes);
    }
  }
  if (!response.body) return response;

  const reader = response.body.getReader();
  let released = false;
  const releaseReader = () => {
    if (released) return;
    released = true;
    reader.releaseLock();
  };
  let receivedBytes = 0;
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (done) {
          releaseReader();
          controller.close();
          return;
        }
        receivedBytes += value.byteLength;
        if (receivedBytes > maxBytes) {
          const error = responseTooLarge(maxBytes);
          await reader.cancel(error).catch(() => undefined);
          releaseReader();
          controller.error(error);
          return;
        }
        controller.enqueue(value);
      } catch (error) {
        releaseReader();
        controller.error(error);
      }
    },
    async cancel(reason) {
      await reader.cancel(reason).catch(() => undefined);
      releaseReader();
    },
  });
  const limited = new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
  // EventSource 会用这些 Fetch Response 元数据处理重定向；Response 构造器不会复制它们。
  Object.defineProperties(limited, {
    redirected: { configurable: true, value: response.redirected },
    type: { configurable: true, value: response.type },
    url: { configurable: true, value: response.url },
  });
  return limited;
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : String(error);
}

export function parseMcpHeaders(headersJson?: string): Record<string, string> {
  if (!headersJson?.trim()) return {};
  if (headersJson.length > 20_000) {
    throw new Error('自定义请求头内容过长');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(headersJson);
  } catch {
    throw new Error('自定义请求头必须是有效的 JSON 对象');
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('自定义请求头必须是 JSON 对象');
  }

  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(parsed)) {
    if (typeof value !== 'string') {
      throw new Error(`请求头 ${name} 的值必须是字符串`);
    }
    if (!name.trim()) continue;
    headers[name.trim()] = value;
  }
  return headers;
}

export function validateMcpServer(server: McpServerSettings): void {
  if (!server.name.trim()) throw new Error('MCP 服务名称不能为空');

  let url: URL;
  try {
    url = new URL(server.url.trim());
  } catch {
    throw new Error(`${server.name || 'MCP 服务'}的 URL 无效`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`${server.name}仅支持 HTTP 或 HTTPS 地址`);
  }
  parseMcpHeaders(server.headersJson);
}

function createFetch(server: McpServerSettings): typeof fetch {
  const configuredHeaders = parseMcpHeaders(server.headersJson);
  return async (input, init) => {
    const headers = new Headers(init?.headers);
    if (server.bearerToken?.trim()) {
      headers.set('Authorization', `Bearer ${server.bearerToken.trim()}`);
    }
    for (const [name, value] of Object.entries(configuredHeaders)) {
      headers.set(name, value);
    }
    const response = await fetch(input, { ...init, headers });
    return limitMcpResponseBody(response);
  };
}

function requestOptions(options: McpOperationOptions = {}) {
  const timeout = options.timeoutMs ?? CONNECTION_TIMEOUT_MS;
  return {
    signal: options.signal,
    timeout,
    maxTotalTimeout: timeout,
  };
}

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  throw signal.reason ?? new DOMException('操作已取消', 'AbortError');
}

async function settleClose(close: Promise<unknown>): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([
    close.catch(() => undefined),
    new Promise<void>((resolve) => {
      timer = setTimeout(resolve, CLOSE_TIMEOUT_MS);
    }),
  ]);
  if (timer !== undefined) clearTimeout(timer);
}

async function closeClient(connection: ConnectedClient): Promise<void> {
  // close 仅做有界的 best-effort 清理，不允许失联服务阻塞取消或覆盖原结果。
  await settleClose(connection.client.close());
}

async function connectWithTransport(
  server: McpServerSettings,
  kind: McpTransport,
  options: McpOperationOptions = {},
): Promise<ConnectedClient> {
  validateMcpServer(server);
  throwIfAborted(options.signal);
  const client = new Client(
    { name: 'pagetrove', version: '1.0' },
    { jsonSchemaValidator: schemaValidator },
  );
  const url = new URL(server.url.trim());
  const customFetch = createFetch(server);
  const transport: Transport =
    kind === 'streamable-http'
      ? new StreamableHTTPClientTransport(url, { fetch: customFetch })
      : new SSEClientTransport(url, { fetch: customFetch });

  try {
    await client.connect(transport, requestOptions(options));
    return { client, transport, transportKind: kind };
  } catch (error) {
    await settleClose(Promise.resolve().then(() => transport.close()));
    throw error;
  }
}

async function connectMcp(
  server: McpServerSettings,
  options: McpOperationOptions = {},
): Promise<ConnectedClient> {
  return connectWithTransport(server, server.transport, options);
}

function normalizeAnnotations(value: unknown): McpToolAnnotations | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return undefined;
  }
  const raw = value as Record<string, unknown>;
  const annotations: McpToolAnnotations = {};
  if (typeof raw.title === 'string' && raw.title.trim()) {
    annotations.title = raw.title.trim().slice(0, 200);
  }
  for (const key of [
    'readOnlyHint',
    'destructiveHint',
    'idempotentHint',
    'openWorldHint',
  ] as const) {
    if (typeof raw[key] === 'boolean') annotations[key] = raw[key];
  }
  return Object.keys(annotations).length > 0 ? annotations : undefined;
}

/** 规范化服务端返回的工具定义（导出仅为可测性）。 */
export function normalizeTool(tool: unknown): McpToolSummary | undefined {
  if (typeof tool !== 'object' || tool === null) return undefined;
  const value = tool as Record<string, unknown>;
  if (typeof value.name !== 'string' || !value.name.trim()) return undefined;
  const schema: Record<string, unknown> | boolean | undefined =
    typeof value.inputSchema === 'boolean'
      ? value.inputSchema
      : typeof value.inputSchema === 'object' &&
          value.inputSchema !== null &&
          !Array.isArray(value.inputSchema)
        ? (value.inputSchema as Record<string, unknown>)
        : undefined;
  if (schema === undefined) return undefined;
  let schemaLength: number;
  try {
    schemaLength = JSON.stringify(schema).length;
  } catch {
    return undefined;
  }
  if (schemaLength > 50_000) return undefined;
  return {
    name: value.name.slice(0, 200),
    description:
      typeof value.description === 'string'
        ? value.description.slice(0, 1_000)
        : undefined,
    inputSchema: schema,
    annotations: normalizeAnnotations(value.annotations),
  };
}

function serverSignature(server: McpServerSettings): string {
  return JSON.stringify([
    server.url,
    server.transport,
    server.bearerToken,
    server.headersJson,
  ]);
}

export async function listMcpTools(
  server: McpServerSettings,
  options: ListMcpToolsOptions | boolean = {},
): Promise<McpConnectionTestResult> {
  const normalizedOptions: ListMcpToolsOptions =
    typeof options === 'boolean' ? { useCache: options } : options;
  const signature = serverSignature(server);
  const cached = toolCache.get(server.id);
  if (
    normalizedOptions.useCache &&
    cached &&
    cached.signature === signature &&
    cached.expiresAt > Date.now()
  ) {
    return cached.result;
  }

  throwIfAborted(normalizedOptions.signal);
  const connection = await connectMcp(server, normalizedOptions);
  try {
    const tools: unknown[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 20; page++) {
      throwIfAborted(normalizedOptions.signal);
      const result = await connection.client.listTools(
        cursor ? { cursor } : undefined,
        requestOptions(normalizedOptions),
      );
      tools.push(...result.tools);
      cursor = result.nextCursor;
      if (!cursor || tools.length >= MAX_TOOLS_PER_SERVER) break;
    }
    const normalized: McpConnectionTestResult = {
      transport: connection.transportKind,
      tools: tools
        .slice(0, MAX_TOOLS_PER_SERVER)
        .map((tool) => normalizeTool(tool))
        .filter((tool): tool is McpToolSummary => Boolean(tool)),
    };
    toolCache.set(server.id, {
      signature,
      expiresAt: Date.now() + TOOL_CACHE_MS,
      result: normalized,
    });
    return normalized;
  } finally {
    await closeClient(connection);
  }
}

/** 生成提供给模型的工具名（导出仅为可测性）。 */
export function modelToolName(
  serverIndex: number,
  toolIndex: number,
  name: string,
): string {
  const safeName = name.replace(/[^a-zA-Z0-9_-]/g, '_');
  return `mcp_${serverIndex}_${toolIndex}_${safeName}`.slice(0, 64);
}

export async function collectEnabledMcpTools(
  servers: McpServerSettings[],
  options: McpOperationOptions = {},
): Promise<McpToolCollection> {
  const enabledServers = servers.filter((server) => server.enabled);
  const results = await Promise.all(
    enabledServers.map(async (server, serverIndex) => {
      try {
        const result = await listMcpTools(server, {
          ...options,
          useCache: true,
        });
        const disabled = new Set(server.disabledTools);
        return {
          tools: result.tools
            .filter((tool) => !disabled.has(tool.name))
            .map((tool, toolIndex): ModelMcpTool => ({
              ...tool,
              modelName: modelToolName(serverIndex, toolIndex, tool.name),
              serverId: server.id,
              serverName: server.name,
              toolName: tool.name,
            })),
        };
      } catch (error) {
        if (options.signal?.aborted) throw error;
        return {
          tools: [],
          warning: {
            serverName: server.name,
            message: errorMessage(error),
          },
        };
      }
    }),
  );

  return {
    tools: results.flatMap((result) => result.tools).slice(0, MAX_TOTAL_TOOLS),
    warnings: results.flatMap((result) =>
      'warning' in result && result.warning ? [result.warning] : [],
    ),
  };
}

interface JsonSerializationBudget {
  nodesLeft: number;
}

function appendJsonString(builder: BoundedTextBuilder, value: string): void {
  if (value.length <= MAX_JSON_STRING_CHARS) {
    builder.appendTruncated(JSON.stringify(value), builder.remaining);
    return;
  }
  const markerLength = TRUNCATION_MARKER.length;
  const prefixLength = Math.max(0, MAX_JSON_STRING_CHARS - markerLength);
  builder.appendTruncated(
    JSON.stringify(`${value.slice(0, prefixLength)}${TRUNCATION_MARKER}`),
    builder.remaining,
  );
}

function appendBoundedJsonValue(
  builder: BoundedTextBuilder,
  value: unknown,
  budget: JsonSerializationBudget,
  depth = 0,
  ancestors = new Set<object>(),
): void {
  if (builder.remaining <= 0) return;
  if (budget.nodesLeft-- <= 0) {
    builder.appendTruncated(JSON.stringify(TRUNCATION_MARKER), builder.remaining);
    return;
  }
  if (value === null) {
    builder.append('null');
    return;
  }
  if (typeof value === 'string') {
    appendJsonString(builder, value);
    return;
  }
  if (typeof value === 'number') {
    builder.append(Number.isFinite(value) ? String(value) : 'null');
    return;
  }
  if (typeof value === 'boolean') {
    builder.append(value ? 'true' : 'false');
    return;
  }
  if (typeof value === 'bigint') {
    appendJsonString(builder, value.toString());
    return;
  }
  if (typeof value !== 'object') {
    builder.append('null');
    return;
  }
  if (depth >= MAX_JSON_DEPTH || ancestors.has(value)) {
    builder.appendTruncated(JSON.stringify(TRUNCATION_MARKER), builder.remaining);
    return;
  }

  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      builder.append('[');
      const length = Math.min(value.length, MAX_JSON_MEMBERS);
      for (let index = 0; index < length && builder.remaining > 1; index++) {
        if (index > 0) builder.append(',');
        appendBoundedJsonValue(builder, value[index], budget, depth + 1, ancestors);
      }
      if (value.length > length && builder.remaining > 1) {
        if (length > 0) builder.append(',');
        builder.appendTruncated(JSON.stringify(TRUNCATION_MARKER), builder.remaining - 1);
      }
      builder.append(']');
      return;
    }

    builder.append('{');
    let appended = 0;
    let omitted = false;
    for (const key in value) {
      if (!Object.prototype.hasOwnProperty.call(value, key)) continue;
      if (appended >= MAX_JSON_MEMBERS) {
        omitted = true;
        break;
      }
      if (builder.remaining <= 2) break;
      if (appended > 0) builder.append(',');
      appendJsonString(builder, key);
      builder.append(':');
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      appendBoundedJsonValue(
        builder,
        descriptor && 'value' in descriptor ? descriptor.value : '[访问器已省略]',
        budget,
        depth + 1,
        ancestors,
      );
      appended += 1;
    }
    if (omitted && builder.remaining > 2) {
      if (appended > 0) builder.append(',');
      appendJsonString(builder, TRUNCATION_MARKER);
      builder.append(':true');
    }
    builder.append('}');
  } catch {
    builder.appendTruncated(JSON.stringify('[无法序列化]'), builder.remaining);
  } finally {
    ancestors.delete(value);
  }
}

function boundedJson(value: unknown, maxChars: number): string {
  const builder = new BoundedTextBuilder(maxChars);
  appendBoundedJsonValue(builder, value, { nodesLeft: MAX_JSON_NODES });
  return builder.toString();
}

function appendResultPart(
  builder: BoundedTextBuilder,
  text: string,
  maxChars: number,
): void {
  if (builder.length > 0) builder.append('\n');
  builder.appendTruncated(text, maxChars);
}

/** 将工具结果按固定预算增量压平，不对不可信的大对象做无界 stringify/join。 */
export function resultToText(result: unknown): string {
  if (typeof result !== 'object' || result === null) {
    return String(result).slice(0, MAX_RESULT_TEXT_CHARS);
  }
  const value = result as Record<string, unknown>;
  const output = new BoundedTextBuilder(MAX_RESULT_TEXT_CHARS);

  if (value.structuredContent !== undefined) {
    appendResultPart(
      output,
      boundedJson(value.structuredContent, MAX_STRUCTURED_CONTENT_CHARS),
      MAX_STRUCTURED_CONTENT_CHARS,
    );
  }
  if (Array.isArray(value.content)) {
    const blockCount = Math.min(value.content.length, MAX_RESULT_BLOCKS);
    for (let index = 0; index < blockCount && output.remaining > 0; index++) {
      const block = value.content[index];
      if (typeof block !== 'object' || block === null) continue;
      const item = block as Record<string, unknown>;
      if (item.type === 'text' && typeof item.text === 'string') {
        appendResultPart(output, item.text, MAX_TEXT_BLOCK_CHARS);
      } else if (item.type === 'image') {
        const mimeType =
          typeof item.mimeType === 'string' ? item.mimeType.slice(0, 200) : '未知格式';
        appendResultPart(output, `[MCP 返回图片：${mimeType}]`, 256);
      } else if (item.type === 'resource' || item.type === 'resource_link') {
        appendResultPart(
          output,
          boundedJson(item, MAX_RESOURCE_BLOCK_CHARS),
          MAX_RESOURCE_BLOCK_CHARS,
        );
      }
    }
    if (value.content.length > blockCount && output.remaining > 0) {
      appendResultPart(
        output,
        `[其余 ${value.content.length - blockCount} 个内容块已省略]`,
        100,
      );
    }
  }

  return output.length > 0
    ? output.toString()
    : boundedJson(result, MAX_RESULT_TEXT_CHARS);
}

export async function callMcpTool(
  server: McpServerSettings,
  toolName: string,
  args: Record<string, unknown>,
  options: McpOperationOptions = {},
): Promise<{ text: string; isError: boolean }> {
  throwIfAborted(options.signal);
  const connection = await connectMcp(server, options);
  try {
    const result = await connection.client.callTool(
      { name: toolName, arguments: args },
      undefined,
      requestOptions(options),
    );
    return {
      text: resultToText(result),
      isError:
        typeof result === 'object' &&
        result !== null &&
        Reflect.get(result, 'isError') === true,
    };
  } finally {
    await closeClient(connection);
  }
}
