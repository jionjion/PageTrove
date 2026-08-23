import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExtensionSettings } from '@/types/settings';
import type { RoundResult } from '@/services/ai/provider';
import type { ToolApprovalDecision } from '@/types/mcp-tool';

const mocks = vi.hoisted(() => ({
  collectEnabledMcpTools: vi.fn(),
  callMcpTool: vi.fn(),
  requestStreamingRound: vi.fn(),
}));

vi.mock('@/services/mcp-client', () => ({
  collectEnabledMcpTools: mocks.collectEnabledMcpTools,
  callMcpTool: mocks.callMcpTool,
}));

vi.mock('@/services/ai/openai-compatible-provider', () => ({
  requestStreamingRound: mocks.requestStreamingRound,
}));

import { streamChat } from '@/services/ai/chat-orchestrator';

const settings: ExtensionSettings = {
  provider: 'custom',
  apiKey: 'test-only-key',
  baseUrl: 'https://ai.example.com/v1',
  model: 'tool-model',
  maxContentLength: 12_000,
  includeSelectedText: true,
  modelCapabilities: {
    'custom::tool-model': { vision: false, tools: true },
  },
  mcpServers: [
    {
      id: 'server-1',
      name: '测试 MCP',
      url: 'https://mcp.example.com',
      transport: 'streamable-http',
      enabled: true,
      disabledTools: [],
    },
  ],
  mcpVerboseLog: true,
};

function toolRound(argumentsText = '{"query":"hello"}'): RoundResult {
  return {
    content: '',
    toolCalls: [
      {
        id: 'call-1',
        type: 'function',
        function: { name: 'mcp_0_0_search', arguments: argumentsText },
      },
    ],
  };
}

function finalRound(): RoundResult {
  return { content: '最终回答', toolCalls: [] };
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.collectEnabledMcpTools.mockResolvedValue({
    tools: [
      {
        name: 'search',
        toolName: 'search',
        modelName: 'mcp_0_0_search',
        serverId: 'server-1',
        serverName: '测试 MCP',
        description: '搜索内容',
        inputSchema: {
          type: 'object',
          properties: { query: { type: 'string' } },
          required: ['query'],
          additionalProperties: false,
        },
      },
    ],
    warnings: [],
  });
  mocks.requestStreamingRound
    .mockResolvedValueOnce(toolRound())
    .mockResolvedValueOnce(finalRound());
  mocks.callMcpTool.mockResolvedValue({
    text: 'private remote result',
    isError: false,
  });
});

describe('streamChat MCP 授权边界', () => {
  it('调用前已取消时不会发现工具或发起模型请求', async () => {
    const controller = new AbortController();
    controller.abort(new DOMException('已取消', 'AbortError'));

    await expect(
      streamChat(
        { title: '页面', url: 'https://page.example.com', content: '正文' },
        [{ role: 'user', content: '请搜索' }],
        settings,
        vi.fn(),
        controller.signal,
      ),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(mocks.collectEnabledMcpTools).not.toHaveBeenCalled();
    expect(mocks.requestStreamingRound).not.toHaveBeenCalled();
  });

  it('没有审批处理器时默认拒绝且绝不执行', async () => {
    const result = await streamChat(
      { title: '页面', url: 'https://page.example.com', content: '正文' },
      [{ role: 'user', content: '请搜索' }],
      settings,
      vi.fn(),
    );

    expect(mocks.callMcpTool).not.toHaveBeenCalled();
    expect(result.toolCalls).toEqual([
      expect.objectContaining({ status: 'denied', toolName: 'search' }),
    ]);
    const secondMessages = mocks.requestStreamingRound.mock.calls[1][1];
    expect(secondMessages).toContainEqual(
      expect.objectContaining({
        role: 'tool',
        content: expect.stringContaining('用户拒绝'),
      }),
    );
  });

  it('批准一次后只执行一次，持久化摘要不包含完整结果', async () => {
    const requestToolApproval = vi.fn().mockResolvedValue({
      kind: 'approve-once',
    });
    const onToolExecution = vi.fn(async (execution) => ({
      kind: 'recorded' as const,
      execution,
    }));
    const result = await streamChat(
      { title: '页面', url: 'https://page.example.com', content: '正文' },
      [{ role: 'user', content: '请搜索' }],
      settings,
      vi.fn(),
      undefined,
      { requestToolApproval, onToolExecution, toolTurnId: 'turn-1' },
    );

    expect(requestToolApproval).toHaveBeenCalledTimes(1);
    expect(requestToolApproval.mock.calls[0][0]).toMatchObject({
      serverName: '测试 MCP',
      toolName: 'search',
      risk: { level: 'high', requiresApproval: true },
    });
    expect(mocks.callMcpTool).toHaveBeenCalledTimes(1);
    expect(onToolExecution.mock.calls.map(([call]) => call.status)).toEqual([
      'unknown',
      'success',
    ]);
    expect(onToolExecution.mock.calls[0][0]).toMatchObject({
      phase: 'claimed',
      claimedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
    });
    expect(onToolExecution.mock.calls[1][0]).toMatchObject({
      operationKey: expect.stringMatching(/^sha256-v1:[a-f0-9]{64}$/),
      turnId: 'turn-1',
    });
    expect(result.toolCalls[0]).toMatchObject({
      status: 'success',
      summary: expect.stringContaining('完整结果未保存'),
    });
    expect(JSON.stringify(result.toolCalls)).not.toContain('private remote result');
  });

  it('工具成功后后续模型轮次失败时，成功审计已先持久化', async () => {
    mocks.requestStreamingRound.mockReset();
    mocks.requestStreamingRound
      .mockResolvedValueOnce(toolRound())
      .mockRejectedValueOnce(new Error('后续模型轮次失败'));
    const onToolExecution = vi.fn(async (execution) => ({
      kind: 'recorded' as const,
      execution,
    }));

    await expect(
      streamChat(
        { title: '页面', url: 'https://page.example.com', content: '正文' },
        [{ role: 'user', content: '请搜索' }],
        settings,
        vi.fn(),
        undefined,
        {
          requestToolApproval: vi.fn().mockResolvedValue({ kind: 'approve-once' }),
          onToolExecution,
          toolTurnId: 'turn-1',
        },
      ),
    ).rejects.toThrow('后续模型轮次失败');

    expect(onToolExecution.mock.calls.map(([call]) => call.status)).toEqual([
      'unknown',
      'success',
    ]);
    expect(mocks.callMcpTool).toHaveBeenCalledTimes(1);
  });

  it('MCP isError 作为结果未知持久化，不误报成功', async () => {
    mocks.callMcpTool.mockResolvedValueOnce({
      text: '远端返回的敏感错误',
      isError: true,
    });
    const onToolExecution = vi.fn(async (execution) => ({
      kind: 'recorded' as const,
      execution,
    }));

    const result = await streamChat(
      { title: '页面', url: 'https://page.example.com', content: '正文' },
      [{ role: 'user', content: '请执行' }],
      settings,
      vi.fn(),
      undefined,
      {
        requestToolApproval: vi.fn().mockResolvedValue({ kind: 'approve-once' }),
        onToolExecution,
        toolTurnId: 'turn-1',
      },
    );

    expect(result.toolCalls[0]).toMatchObject({ status: 'unknown' });
    expect(JSON.stringify(result.toolCalls)).not.toContain('敏感错误');
    expect(onToolExecution.mock.calls.at(-1)?.[0]).toMatchObject({
      status: 'unknown',
      phase: 'in-doubt',
      operationKey: expect.any(String),
      turnId: 'turn-1',
    });
  });

  it('审计写入不可用时 fail closed，不执行已批准工具', async () => {
    const result = await streamChat(
      { title: '页面', url: 'https://page.example.com', content: '正文' },
      [{ role: 'user', content: '请搜索' }],
      settings,
      vi.fn(),
      undefined,
      { requestToolApproval: vi.fn().mockResolvedValue({ kind: 'approve-once' }) },
    );

    expect(mocks.callMcpTool).not.toHaveBeenCalled();
    expect(result.toolCalls[0]).toMatchObject({ status: 'error' });
  });

  it('同一 user turn 的相同操作已成功时不重复调用远端', async () => {
    const prior = {
      id: 'prior-execution',
      serverName: '测试 MCP',
      toolName: 'search',
      status: 'success' as const,
      summary: '先前已成功',
    };
    const onToolExecution = vi.fn().mockResolvedValue({
      kind: 'already-success',
      execution: prior,
    });

    const result = await streamChat(
      { title: '页面', url: 'https://page.example.com', content: '正文' },
      [{ role: 'user', content: '请搜索' }],
      settings,
      vi.fn(),
      undefined,
      {
        requestToolApproval: vi.fn().mockResolvedValue({ kind: 'approve-once' }),
        onToolExecution,
        toolTurnId: 'turn-1',
      },
    );

    expect(mocks.callMcpTool).not.toHaveBeenCalled();
    expect(result.toolCalls).toEqual([prior]);
    const secondMessages = mocks.requestStreamingRound.mock.calls[1][1];
    expect(secondMessages).toContainEqual(
      expect.objectContaining({
        role: 'tool',
        content: expect.stringContaining('未重复执行'),
      }),
    );
  });

  it('审批回调返回未知值时安全拒绝，不会落入批准分支', async () => {
    const requestToolApproval = vi.fn().mockResolvedValue({ kind: 'unexpected' });
    const result = await streamChat(
      { title: '页面', url: 'https://page.example.com', content: '正文' },
      [{ role: 'user', content: '请搜索' }],
      settings,
      vi.fn(),
      undefined,
      { requestToolApproval },
    );

    expect(mocks.callMcpTool).not.toHaveBeenCalled();
    expect(result.toolCalls[0]).toMatchObject({ status: 'denied' });
  });

  it('参数 JSON 或 Schema 校验失败时不询问、不执行', async () => {
    mocks.requestStreamingRound.mockReset();
    mocks.requestStreamingRound
      .mockResolvedValueOnce(toolRound('{bad'))
      .mockResolvedValueOnce(finalRound());
    const requestToolApproval = vi.fn();

    const result = await streamChat(
      { title: '页面', url: 'https://page.example.com', content: '正文' },
      [{ role: 'user', content: '请搜索' }],
      settings,
      vi.fn(),
      undefined,
      { requestToolApproval },
    );

    expect(requestToolApproval).not.toHaveBeenCalled();
    expect(mocks.callMcpTool).not.toHaveBeenCalled();
    expect(result.toolCalls[0]).toMatchObject({
      status: 'error',
      summary: '参数校验失败，工具未执行',
    });
  });

  it('等待审批时取消会终止整轮且不执行工具', async () => {
    const controller = new AbortController();
    const requestToolApproval = vi.fn(
      (_request, signal: AbortSignal) =>
        new Promise<ToolApprovalDecision>((_, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason), { once: true });
          controller.abort(new DOMException('用户停止', 'AbortError'));
        }),
    );

    await expect(
      streamChat(
        { title: '页面', url: 'https://page.example.com', content: '正文' },
        [{ role: 'user', content: '请搜索' }],
        settings,
        vi.fn(),
        controller.signal,
        { requestToolApproval },
      ),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(mocks.callMcpTool).not.toHaveBeenCalled();
    expect(mocks.requestStreamingRound).toHaveBeenCalledTimes(1);
  });

  it('工具开始后取消会先把 claimed 审计收敛为 in-doubt', async () => {
    const controller = new AbortController();
    const onToolExecution = vi.fn(async (execution) => ({
      kind: 'recorded' as const,
      execution,
    }));
    mocks.callMcpTool.mockImplementationOnce(async () => {
      controller.abort(new DOMException('用户停止', 'AbortError'));
      throw controller.signal.reason;
    });

    await expect(
      streamChat(
        { title: '页面', url: 'https://page.example.com', content: '正文' },
        [{ role: 'user', content: '请执行' }],
        settings,
        vi.fn(),
        controller.signal,
        {
          requestToolApproval: vi.fn().mockResolvedValue({ kind: 'approve-once' }),
          onToolExecution,
          toolTurnId: 'turn-1',
        },
      ),
    ).rejects.toMatchObject({ name: 'AbortError' });

    expect(onToolExecution.mock.calls.map(([call]) => [call.status, call.phase])).toEqual(
      [
        ['unknown', 'claimed'],
        ['unknown', 'in-doubt'],
      ],
    );
  });

  it('claim 落盘期间取消也会收敛 in-doubt，不调用远端', async () => {
    const controller = new AbortController();
    const onToolExecution = vi.fn(async (execution) => {
      if (execution.phase === 'claimed') {
        controller.abort(new DOMException('用户停止', 'AbortError'));
      }
      return { kind: 'recorded' as const, execution };
    });

    await expect(
      streamChat(
        { title: '页面', url: 'https://page.example.com', content: '正文' },
        [{ role: 'user', content: '请执行' }],
        settings,
        vi.fn(),
        controller.signal,
        {
          requestToolApproval: vi.fn().mockResolvedValue({ kind: 'approve-once' }),
          onToolExecution,
          toolTurnId: 'turn-1',
        },
      ),
    ).rejects.toMatchObject({ name: 'AbortError' });

    expect(mocks.callMcpTool).not.toHaveBeenCalled();
    expect(onToolExecution.mock.calls.map(([call]) => call.phase)).toEqual([
      'claimed',
      'in-doubt',
    ]);
  });
});
