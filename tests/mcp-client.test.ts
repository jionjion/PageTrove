import { describe, expect, it } from 'vitest';
import {
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
    expect(() => validateMcpServer(makeServer({ name: '  ' }))).toThrow(
      '名称不能为空',
    );
  });

  it('URL 无效或协议不支持抛错', () => {
    expect(() => validateMcpServer(makeServer({ url: 'not-a-url' }))).toThrow(
      'URL 无效',
    );
    expect(() =>
      validateMcpServer(makeServer({ url: 'ftp://mcp.example.com' })),
    ).toThrow('HTTP 或 HTTPS');
  });

  it('headersJson 非法时联动抛错', () => {
    expect(() =>
      validateMcpServer(makeServer({ headersJson: '{bad' })),
    ).toThrow('有效的 JSON');
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

  it('非法 inputSchema 回退为空对象 Schema', () => {
    expect(normalizeTool({ name: 't', inputSchema: [1] })?.inputSchema).toEqual({
      type: 'object',
      properties: {},
    });
    expect(normalizeTool({ name: 't' })?.inputSchema).toEqual({
      type: 'object',
      properties: {},
    });
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
    });
    expect(tool?.name).toHaveLength(200);
    expect(tool?.description).toHaveLength(1_000);
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

  it('结果超过 100KB 截断', () => {
    const text = resultToText({
      content: [{ type: 'text', text: 'x'.repeat(200_000) }],
    });
    expect(text).toHaveLength(100_000);
  });
});
