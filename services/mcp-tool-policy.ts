import { Validator } from '@cfworker/json-schema';
import type { McpToolAnnotations, ToolRiskAssessment } from '@/types/mcp-tool';

const MAX_ARGUMENT_BYTES = 32 * 1024;
const MAX_ARGUMENT_PREVIEW = 4_000;
const SENSITIVE_KEY =
  /(?:auth|cookie|token|secret|password|passwd|api[-_ ]?key|access[-_ ]?key|private[-_ ]?key|credential|session[-_ ]?id|signature)/i;

export type ToolArgumentsResult =
  | { ok: true; arguments: Record<string, unknown> }
  | {
      ok: false;
      code:
        | 'ARGUMENTS_TOO_LARGE'
        | 'INVALID_JSON'
        | 'INVALID_ARGUMENT_SHAPE'
        | 'INVALID_SCHEMA'
        | 'SCHEMA_MISMATCH';
      message: string;
    };

export function assessToolRisk(annotations?: McpToolAnnotations): ToolRiskAssessment {
  const reasons: string[] = [];
  if (!annotations) {
    reasons.push('服务未声明工具风险信息');
  } else {
    if (annotations.readOnlyHint !== true) reasons.push('未明确声明为只读');
    if (annotations.destructiveHint !== false) reasons.push('未明确排除破坏性操作');
    if (annotations.openWorldHint !== false) reasons.push('可能与外部系统交互');
  }
  return {
    level: reasons.length === 0 ? 'low' : 'high',
    reasons:
      reasons.length > 0
        ? reasons
        : ['服务声明为只读、非破坏且不访问开放世界；声明仍未经拾页验证'],
    requiresApproval: true,
  };
}

export function parseAndValidateToolArguments(
  raw: string,
  inputSchema: Record<string, unknown> | boolean,
): ToolArgumentsResult {
  if (new TextEncoder().encode(raw).byteLength > MAX_ARGUMENT_BYTES) {
    return {
      ok: false,
      code: 'ARGUMENTS_TOO_LARGE',
      message: '工具参数超过 32 KB，工具未执行',
    };
  }

  let parsed: unknown;
  try {
    parsed = raw.trim() ? JSON.parse(raw) : {};
  } catch {
    return {
      ok: false,
      code: 'INVALID_JSON',
      message: '工具参数不是有效 JSON，工具未执行',
    };
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return {
      ok: false,
      code: 'INVALID_ARGUMENT_SHAPE',
      message: '工具参数必须是 JSON 对象，工具未执行',
    };
  }

  try {
    // cfworker 校验器为纯解释执行，不生成代码，兼容扩展页的 script-src 'self' CSP。
    // 它原生支持布尔根 schema 与本地 $ref；未解析的 $ref / 非法正则仍在构造或校验时抛错。
    const validator = new Validator(inputSchema, '2020-12', true);
    const result = validator.validate(parsed);
    if (!result.valid) {
      const detail = result.errors
        .map((error) => `${error.instanceLocation}: ${error.error}`)
        .join('; ');
      return {
        ok: false,
        code: 'SCHEMA_MISMATCH',
        message: `工具参数不符合 Schema，工具未执行：${detail.slice(0, 300)}`,
      };
    }
  } catch (error) {
    // 编译或校验阶段抛错（未解析的 $ref、非法 pattern 正则等）都按失败关闭；
    // 附上真实原因但限制长度，避免不可信文本无界进入模型历史。
    const reason =
      error instanceof Error && error.message ? error.message : String(error);
    return {
      ok: false,
      code: 'INVALID_SCHEMA',
      message: `工具 Schema 无法验证，工具未执行：${reason.slice(0, 300)}`,
    };
  }
  return { ok: true, arguments: parsed as Record<string, unknown> };
}

function redactValue(value: unknown, depth: number): unknown {
  if (depth > 6) return '[层级过深]';
  if (Array.isArray(value)) {
    return value.slice(0, 50).map((item) => redactValue(item, depth + 1));
  }
  if (typeof value !== 'object' || value === null) return value;
  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value).slice(0, 100)) {
    result[key] = SENSITIVE_KEY.test(key) ? '[已脱敏]' : redactValue(item, depth + 1);
  }
  return result;
}

export function buildToolArgumentsPreview(args: Record<string, unknown>): string {
  let text: string;
  try {
    text = JSON.stringify(redactValue(args, 0), null, 2);
  } catch {
    return '{\n  "参数": "无法安全展示"\n}';
  }
  return text.length > MAX_ARGUMENT_PREVIEW
    ? `${text.slice(0, MAX_ARGUMENT_PREVIEW)}\n…（已截断）`
    : text;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`;
  }
  if (typeof value === 'object' && value !== null) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(Reflect.get(value, key))}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

/**
 * 为同一 user turn 内的同一外部操作生成稳定指纹。
 * 指纹用随机 message id 做域分离，日志中不保存参数本身。
 */
export async function buildToolOperationKey(input: {
  turnId: string;
  endpoint: string;
  serverId: string;
  toolName: string;
  arguments: Record<string, unknown>;
}): Promise<string> {
  const payload = [
    'pagetrove-mcp-journal-v1',
    input.turnId,
    input.endpoint,
    input.toolName,
    canonicalJson(input.arguments),
  ].join('\0');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(payload));
  return `sha256-v1:${[...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')}`;
}
