import { describe, expect, it } from 'vitest';
import {
  limitMcpResponseBody,
  modelToolName,
  normalizeTool,
  parseMcpHeaders,
  resultToText,
  validateMcpServer,
} from '@/services/mcp-client';
import type { McpServerSettings } from '@/types/settings';

function makeServer(overrides: Partial<McpServerSettings> = {}): McpServerSettings {
  return {
    id: 's1',
    name: '测试服务',
    url: 'https://mcp.example.com/mcp',
    transport: 'streamable-http',
    enabled: true,
    disabledTools: [],
    ...overrides,
  };
}

describe('parseMcpHeaders', () => {
  it('未配置或空白时返回空对象', () => {
    expect(parseMcpHeaders(undefined)).toEqual({});
    expect(parseMcpHeaders('')).toEqual({});
    expect(parseMcpHeaders('   ')).toEqual({});
  });

  it('解析合法 JSON 对象并 trim 键名', () => {
    expect(parseMcpHeaders('{" X-Key ":"v1","Other":"v2"}')).toEqual({
      'X-Key': 'v1',
      Other: 'v2',
    });
  });

  it('空键名被跳过', () => {
    expect(parseMcpHeaders('{"  ":"v"}')).toEqual({});
  });

  it('超过 20KB 抛错', () => {
    const huge = `{"k":"${'x'.repeat(20_001)}"}`;
    expect(() => parseMcpHeaders(huge)).toThrow('过长');
  });

  it('坏 JSON、非对象、非字符串值抛错', () => {
    expect(() => parseMcpHeaders('{bad')).toThrow('有效的 JSON');
    expect(() => parseMcpHeaders('[1]')).toThrow('JSON 对象');
    expect(() => parseMcpHeaders('"str"')).toThrow('JSON 对象');
    expect(() => parseMcpHeaders('{"k":1}')).toThrow('必须是字符串');
  });
});

describe('validateMcpServer', () => {
  it('合法 http/https 通过', () => {
    expect(() => validateMcpServer(makeServer())).not.toThrow();
    expect(() =>
      validateMcpServer(makeServer({ url: 'http://localhost:3000/mcp' })),
    ).not.toThrow();
  });

  it('名称为空抛错', () => {
    expect(() => validateMcpServer(makeServer({ name: '  ' }))).toThrow('名称不能为空');
  });

  it('URL 无效或协议不支持抛错', () => {
    expect(() => validateMcpServer(makeServer({ url: 'not-a-url' }))).toThrow('URL 无效');
    expect(() => validateMcpServer(makeServer({ url: 'ftp://mcp.example.com' }))).toThrow(
      'HTTP 或 HTTPS',
    );
  });

  it('headersJson 非法时联动抛错', () => {
    expect(() => validateMcpServer(makeServer({ headersJson: '{bad' }))).toThrow(
      '有效的 JSON',
    );
  });
});

describe('normalizeTool', () => {
  it('合法工具保留 name/description/inputSchema', () => {
    const tool = normalizeTool({
      name: 'search',
      description: '搜索',
      inputSchema: { type: 'object', properties: { q: { type: 'string' } } },
    });
    expect(tool).toEqual({
      name: 'search',
      description: '搜索',
      inputSchema: { type: 'object', properties: { q: { type: 'string' } } },
    });
  });

  it('非对象或缺 name 返回 undefined', () => {
    expect(normalizeTool(null)).toBeUndefined();
    expect(normalizeTool('x')).toBeUndefined();
    expect(normalizeTool({})).toBeUndefined();
    expect(normalizeTool({ name: '   ' })).toBeUndefined();
  });

  it('非法或缺失 inputSchema 时不向模型暴露工具', () => {
    expect(normalizeTool({ name: 't', inputSchema: [1] })).toBeUndefined();
    expect(normalizeTool({ name: 't' })).toBeUndefined();
  });

  it('布尔根 schema（true/false）予以保留', () => {
    expect(normalizeTool({ name: 't', inputSchema: true })?.inputSchema).toBe(true);
    expect(normalizeTool({ name: 't', inputSchema: false })?.inputSchema).toBe(false);
  });

  it('inputSchema 序列化超过 50KB 拒绝', () => {
    const tool = normalizeTool({
      name: 't',
      inputSchema: { pad: 'x'.repeat(50_001) },
    });
    expect(tool).toBeUndefined();
  });

  it('工具名截断 200、描述截断 1000', () => {
    const tool = normalizeTool({
      name: 'n'.repeat(300),
      description: 'd'.repeat(2_000),
      inputSchema: { type: 'object', properties: {} },
    });
    expect(tool?.name).toHaveLength(200);
    expect(tool?.description).toHaveLength(1_000);
  });

  it('只保留合法 annotations 字段', () => {
    const tool = normalizeTool({
      name: 'safe-tool',
      inputSchema: { type: 'object', properties: {} },
      annotations: {
        title: '  只读查询  ',
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: 'yes',
        openWorldHint: false,
        extra: 'ignored',
      },
    });
    expect(tool?.annotations).toEqual({
      title: '只读查询',
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: false,
    });
  });
});

describe('modelToolName', () => {
  it('拼接 mcp_{server}_{tool}_{name} 并替换非法字符', () => {
    expect(modelToolName(0, 2, 'my.tool name')).toBe('mcp_0_2_my_tool_name');
  });

  it('总长截断到 64', () => {
    const name = modelToolName(1, 1, 'x'.repeat(100));
    expect(name).toHaveLength(64);
    expect(name.startsWith('mcp_1_1_')).toBe(true);
  });
});

describe('resultToText', () => {
  it('非对象结果转字符串', () => {
    expect(resultToText('ok')).toBe('ok');
    expect(resultToText(42)).toBe('42');
    expect(resultToText(null)).toBe('null');
  });

  it('拼接 structuredContent 与 text 块', () => {
    const text = resultToText({
      structuredContent: { a: 1 },
      content: [
        { type: 'text', text: '第一行' },
        { type: 'image', mimeType: 'image/png' },
        { type: 'resource_link', uri: 'https://a.example.com' },
        null,
      ],
    });
    expect(text).toContain('{"a":1}');
    expect(text).toContain('第一行');
    expect(text).toContain('[MCP 返回图片：image/png]');
    expect(text).toContain('resource_link');
  });

  it('无可识别块时回退整体 JSON 序列化', () => {
    expect(resultToText({ foo: 'bar' })).toBe('{"foo":"bar"}');
  });

  it('单个文本块先按 50K 预算截断', () => {
    const text = resultToText({
      content: [{ type: 'text', text: 'x'.repeat(200_000) }],
    });
    expect(text).toHaveLength(50_000);
    expect(text).toContain('内容已截断');
  });

  it('structuredContent 按深度、节点和字符串预算序列化', () => {
    const circular: Record<string, unknown> = {
      pad: 'x'.repeat(100_000),
    };
    circular.self = circular;

    const text = resultToText({
      structuredContent: circular,
      content: [{ type: 'text', text: '后续文本' }],
    });

    expect(text.length).toBeLessThanOrEqual(100_000);
    expect(text).toContain('内容已截断');
    expect(text).toContain('后续文本');
  });

  it('只读取前 100 个内容块并报告省略数', () => {
    const text = resultToText({
      content: Array.from({ length: 105 }, (_, index) => ({
        type: 'text',
        text: `block-${index}`,
      })),
    });

    expect(text).toContain('block-99');
    expect(text).not.toContain('block-100');
    expect(text).toContain('其余 5 个内容块已省略');
  });

  it('不执行 structuredContent 中的访问器', () => {
    const getter = () => {
      throw new Error('不应访问');
    };
    const structuredContent = {} as Record<string, unknown>;
    Object.defineProperty(structuredContent, 'secret', {
      enumerable: true,
      get: getter,
    });

    expect(() => resultToText({ structuredContent })).not.toThrow();
    expect(resultToText({ structuredContent })).toContain('访问器已省略');
  });
});

describe('limitMcpResponseBody', () => {
  it('Content-Length 已知超限时在读取前 fail closed', () => {
    const response = new Response('small', {
      headers: { 'content-length': '11' },
    });

    expect(() => limitMcpResponseBody(response, 10)).toThrow('超过 10 字节限制');
  });

  it('无 Content-Length 时按实际流式字节数拒绝并取消源流', async () => {
    let cancelled = false;
    const encoder = new TextEncoder();
    const response = new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoder.encode('1234'));
          controller.enqueue(encoder.encode('5678'));
        },
        cancel() {
          cancelled = true;
        },
      }),
    );

    const limited = limitMcpResponseBody(response, 7);
    await expect(limited.text()).rejects.toThrow('超过 7 字节限制');
    expect(cancelled).toBe(true);
  });

  it('限额内保留状态、响应头和正文', async () => {
    const response = new Response('hello', {
      status: 201,
      statusText: 'Created',
      headers: { 'x-mcp-test': 'yes' },
    });

    const limited = limitMcpResponseBody(response, 5);
    expect(limited.status).toBe(201);
    expect(limited.statusText).toBe('Created');
    expect(limited.headers.get('x-mcp-test')).toBe('yes');
    await expect(limited.text()).resolves.toBe('hello');
  });

  it('拒绝非正整数限额', () => {
    expect(() => limitMcpResponseBody(new Response(''), 0)).toThrow('正整数');
    expect(() => limitMcpResponseBody(new Response(''), 1.5)).toThrow('正整数');
  });
});
