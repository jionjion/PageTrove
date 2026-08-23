import { describe, expect, it } from 'vitest';
import {
  assessToolRisk,
  buildToolArgumentsPreview,
  buildToolOperationKey,
  parseAndValidateToolArguments,
} from '@/services/mcp-tool-policy';

const schema = {
  type: 'object',
  properties: { query: { type: 'string' } },
  required: ['query'],
  additionalProperties: false,
};

describe('assessToolRisk', () => {
  it('缺失或不完整声明按高风险处理且始终需要确认', () => {
    expect(assessToolRisk()).toMatchObject({
      level: 'high',
      requiresApproval: true,
    });
    expect(assessToolRisk({ readOnlyHint: true })).toMatchObject({
      level: 'high',
      requiresApproval: true,
    });
  });

  it('只有明确只读、非破坏、非开放世界时显示低风险', () => {
    expect(
      assessToolRisk({
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
      }),
    ).toMatchObject({ level: 'low', requiresApproval: true });
  });
});

describe('parseAndValidateToolArguments', () => {
  it('解析并返回符合 Schema 的对象', () => {
    expect(parseAndValidateToolArguments('{"query":"hello"}', schema)).toEqual({
      ok: true,
      arguments: { query: 'hello' },
    });
  });

  it('坏 JSON、数组和 Schema mismatch 均失败关闭', () => {
    expect(parseAndValidateToolArguments('{bad', schema)).toMatchObject({
      ok: false,
      code: 'INVALID_JSON',
    });
    expect(parseAndValidateToolArguments('[]', schema)).toMatchObject({
      ok: false,
      code: 'INVALID_ARGUMENT_SHAPE',
    });
    expect(parseAndValidateToolArguments('{"query":1}', schema)).toMatchObject({
      ok: false,
      code: 'SCHEMA_MISMATCH',
    });
  });

  it('非法 Schema 和超大参数均拒绝', () => {
    // cfworker 把未知 type 当作校验失败而非抛错
    expect(
      parseAndValidateToolArguments('{}', {
        type: 'definitely-not-a-json-schema-type',
      }),
    ).toMatchObject({ ok: false, code: 'SCHEMA_MISMATCH' });
    expect(
      parseAndValidateToolArguments(
        JSON.stringify({ query: 'x'.repeat(40_000) }),
        schema,
      ),
    ).toMatchObject({ ok: false, code: 'ARGUMENTS_TOO_LARGE' });
  });

  it('布尔根 schema 兼容 true/false，失败原因透出真实异常', () => {
    expect(parseAndValidateToolArguments('{}', true)).toEqual({
      ok: true,
      arguments: {},
    });
    expect(parseAndValidateToolArguments('{}', false)).toMatchObject({
      ok: false,
      code: 'SCHEMA_MISMATCH',
    });
    // 未解析的 $ref 会抛错，但原因不再被吞掉
    const badRef = parseAndValidateToolArguments('{}', {
      $ref: '#/definitions/Input',
    });
    expect(badRef).toMatchObject({ ok: false, code: 'INVALID_SCHEMA' });
    if (badRef.ok === false) {
      expect(badRef.message).toContain('Unresolved $ref');
    }
  });

  it('内嵌定义的可本地解析 $ref 正常通过', () => {
    const refSchema = {
      $ref: '#/definitions/Query',
      definitions: {
        Query: {
          type: 'object',
          properties: { q: { type: 'string' } },
          required: ['q'],
        },
      },
    };
    expect(parseAndValidateToolArguments('{"q":"hi"}', refSchema)).toEqual({
      ok: true,
      arguments: { q: 'hi' },
    });
  });
});

describe('buildToolArgumentsPreview', () => {
  it('递归脱敏常见凭据字段并截断超长参数', () => {
    const preview = buildToolArgumentsPreview({
      query: 'hello',
      apiKey: 'secret-a',
      nested: { Authorization: 'secret-b', text: 'x'.repeat(10_000) },
    });
    expect(preview).toContain('hello');
    expect(preview).toContain('[已脱敏]');
    expect(preview).not.toContain('secret-a');
    expect(preview).not.toContain('secret-b');
    expect(preview).toContain('已截断');
  });
});

describe('buildToolOperationKey', () => {
  it('对对象 key 顺序稳定，且不把原始参数写入指纹', async () => {
    const common = {
      turnId: 'turn-1',
      endpoint: 'https://mcp.example.com',
      serverId: 'server-1',
      toolName: 'create_item',
    };
    const first = await buildToolOperationKey({
      ...common,
      arguments: { b: 2, a: { secret: 'private-value', x: 1 } },
    });
    const reordered = await buildToolOperationKey({
      ...common,
      arguments: { a: { x: 1, secret: 'private-value' }, b: 2 },
    });

    expect(first).toBe(reordered);
    expect(first).toMatch(/^sha256-v1:[a-f0-9]{64}$/);
    expect(first).not.toContain('private-value');
    await expect(
      buildToolOperationKey({
        ...common,
        turnId: 'turn-2',
        arguments: { b: 2, a: { secret: 'private-value', x: 1 } },
      }),
    ).resolves.not.toBe(first);
  });
});
