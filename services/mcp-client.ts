import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { McpServerSettings, McpTransport } from '@/types/settings';

export interface McpToolSummary {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
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
const TOOL_CACHE_MS = 5 * 60_000;
const MAX_TOOLS_PER_SERVER = 100;
const MAX_TOTAL_TOOLS = 128;
const toolCache = new Map<
  string,
  {
    signature: string;
    expiresAt: number;
    result: McpConnectionTestResult;
  }
>();

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
    return fetch(input, { ...init, headers });
  };
}

async function withTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`${label}超时，请检查地址和网络`)),
          CONNECTION_TIMEOUT_MS,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function connectWithTransport(
  server: McpServerSettings,
  kind: McpTransport,
): Promise<ConnectedClient> {
  validateMcpServer(server);
  const client = new Client({ name: 'pagetrove', version: '1.0' });
  const url = new URL(server.url.trim());
  const customFetch = createFetch(server);
  const transport: Transport =
    kind === 'streamable-http'
      ? new StreamableHTTPClientTransport(url, { fetch: customFetch })
      : new SSEClientTransport(url, { fetch: customFetch });

  try {
    await withTimeout(client.connect(transport), `连接 ${server.name}`);
    return { client, transport, transportKind: kind };
  } catch (error) {
    try {
      await transport.close();
    } catch {
      // 连接失败时忽略二次清理错误。
    }
    throw error;
  }
}

async function connectMcp(server: McpServerSettings): Promise<ConnectedClient> {
  return connectWithTransport(server, server.transport);
}

function normalizeTool(tool: unknown): McpToolSummary | undefined {
  if (typeof tool !== 'object' || tool === null) return undefined;
  const value = tool as Record<string, unknown>;
  if (typeof value.name !== 'string' || !value.name.trim()) return undefined;
  const schema =
    typeof value.inputSchema === 'object' &&
    value.inputSchema !== null &&
    !Array.isArray(value.inputSchema)
      ? (value.inputSchema as Record<string, unknown>)
      : { type: 'object', properties: {} };
  if (JSON.stringify(schema).length > 50_000) return undefined;
  return {
    name: value.name.slice(0, 200),
    description:
      typeof value.description === 'string'
        ? value.description.slice(0, 1_000)
        : undefined,
    inputSchema: schema,
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
  useCache = false,
): Promise<McpConnectionTestResult> {
  const signature = serverSignature(server);
  const cached = toolCache.get(server.id);
  if (
    useCache &&
    cached &&
    cached.signature === signature &&
    cached.expiresAt > Date.now()
  ) {
    return cached.result;
  }

  const connection = await connectMcp(server);
  try {
    const tools: unknown[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 20; page++) {
      const result = await withTimeout(
        connection.client.listTools(cursor ? { cursor } : undefined),
        `读取 ${server.name} 工具列表`,
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
    await connection.client.close().catch(() => undefined);
  }
}

function modelToolName(serverIndex: number, toolIndex: number, name: string): string {
  const safeName = name.replace(/[^a-zA-Z0-9_-]/g, '_');
  return `mcp_${serverIndex}_${toolIndex}_${safeName}`.slice(0, 64);
}

export async function collectEnabledMcpTools(
  servers: McpServerSettings[],
): Promise<McpToolCollection> {
  const enabledServers = servers.filter((server) => server.enabled);
  const results = await Promise.all(
    enabledServers.map(async (server, serverIndex) => {
      try {
        const result = await listMcpTools(server, true);
        const disabled = new Set(server.disabledTools);
        return {
          tools: result.tools
            .filter((tool) => !disabled.has(tool.name))
            .map(
              (tool, toolIndex): ModelMcpTool => ({
                ...tool,
                modelName: modelToolName(serverIndex, toolIndex, tool.name),
                serverId: server.id,
                serverName: server.name,
                toolName: tool.name,
              }),
            ),
        };
      } catch (error) {
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

function resultToText(result: unknown): string {
  if (typeof result !== 'object' || result === null) return String(result);
  const value = result as Record<string, unknown>;
  const parts: string[] = [];

  if (value.structuredContent !== undefined) {
    parts.push(JSON.stringify(value.structuredContent));
  }
  if (Array.isArray(value.content)) {
    for (const block of value.content) {
      if (typeof block !== 'object' || block === null) continue;
      const item = block as Record<string, unknown>;
      if (item.type === 'text' && typeof item.text === 'string') {
        parts.push(item.text);
      } else if (item.type === 'image') {
        parts.push(`[MCP 返回图片：${String(item.mimeType ?? '未知格式')}]`);
      } else if (item.type === 'resource' || item.type === 'resource_link') {
        parts.push(JSON.stringify(item));
      }
    }
  }

  return (parts.join('\n') || JSON.stringify(result)).slice(0, 100_000);
}

export async function callMcpTool(
  server: McpServerSettings,
  toolName: string,
  args: Record<string, unknown>,
): Promise<string> {
  const connection = await connectMcp(server);
  try {
    const result = await withTimeout(
      connection.client.callTool({ name: toolName, arguments: args }),
      `调用 ${toolName}`,
    );
    return resultToText(result);
  } finally {
    await connection.client.close().catch(() => undefined);
  }
}