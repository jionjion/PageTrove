/** MCP 服务声明的工具提示；它们来自远端，只能辅助风险展示。 */
export interface McpToolAnnotations {
  title?: string;
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
}

export type ToolRiskLevel = 'low' | 'high';

export interface ToolRiskAssessment {
  level: ToolRiskLevel;
  reasons: string[];
  /** 当前策略始终逐次确认，服务端声明不能替代用户授权。 */
  requiresApproval: true;
}

export interface ToolApprovalRequest {
  requestId: string;
  toolCallId: string;
  serverId: string;
  serverName: string;
  toolName: string;
  description?: string;
  /** 已脱敏且截断的参数文本，仅供 UI 展示。 */
  argumentsPreview: string;
  annotations?: McpToolAnnotations;
  risk: ToolRiskAssessment;
}

export type ToolApprovalDecision =
  | { kind: 'approve-once' }
  | { kind: 'deny' }
  /** 用户已核对外部系统后，沿用原 user turn 继续模型，不重复调用工具。 */
  | { kind: 'continue-without-execution' };

export type ToolApprovalHandler = (
  request: ToolApprovalRequest,
  signal: AbortSignal,
) => Promise<ToolApprovalDecision>;
