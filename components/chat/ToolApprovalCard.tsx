import { useState } from 'react';
import { Button } from 'antd';
import {
  SafetyCertificateOutlined,
  ToolOutlined,
  WarningFilled,
} from '@ant-design/icons';
import type { ToolApprovalRequest } from '@/types/mcp-tool';

function hintLabel(value: boolean | undefined): string {
  if (value === true) return '是';
  if (value === false) return '否';
  return '未声明';
}

function AnnotationItem({ label, value }: { label: string; value?: boolean }) {
  return (
    <span className={`tool-approval-hint${value === false ? ' is-no' : ''}`}>
      {label} {hintLabel(value)}
    </span>
  );
}

/** MCP 调用的一次性授权卡；所有远端文字均按普通文本展示。 */
export function ToolApprovalCard({
  request,
  onApprove,
  onDeny,
}: {
  request: ToolApprovalRequest;
  onApprove: () => void;
  onDeny: () => void;
}) {
  const highRisk = request.risk.level === 'high';
  const [submitting, setSubmitting] = useState(false);
  const settle = (callback: () => void) => {
    if (submitting) return;
    setSubmitting(true);
    callback();
  };
  return (
    <div className={`tool-approval-card${highRisk ? ' is-high-risk' : ' is-low-risk'}`}>
      <div className="tool-approval-header">
        <ToolOutlined className="tool-approval-title-icon" />
        <span className="tool-approval-title">MCP 工具请求确认</span>
        <span className={`tool-approval-badge${highRisk ? ' is-high-risk' : ''}`}>
          {highRisk ? '高风险' : '低风险'}
        </span>
      </div>

      <div
        className={`tool-approval-banner${highRisk ? ' is-high-risk' : ' is-low-risk'}`}
      >
        {highRisk ? <WarningFilled /> : <SafetyCertificateOutlined />}
        <span>{request.risk.reasons.join('；')}</span>
      </div>

      <div className="tool-approval-fields">
        <div className="tool-approval-field">
          <span className="tool-approval-label">服务</span>
          <span className="tool-approval-value">{request.serverName}</span>
        </div>
        <div className="tool-approval-field">
          <span className="tool-approval-label">工具</span>
          <span className="tool-approval-value">{request.toolName}</span>
        </div>
        {request.description && (
          <div className="tool-approval-field">
            <span className="tool-approval-label">说明</span>
            <span className="tool-approval-value">{request.description}</span>
          </div>
        )}
        <div className="tool-approval-field">
          <span className="tool-approval-label">声明</span>
          <span className="tool-approval-hints">
            <AnnotationItem label="只读" value={request.annotations?.readOnlyHint} />
            <AnnotationItem
              label="可能破坏"
              value={request.annotations?.destructiveHint}
            />
            <AnnotationItem label="幂等" value={request.annotations?.idempotentHint} />
            <AnnotationItem label="开放世界" value={request.annotations?.openWorldHint} />
          </span>
        </div>
      </div>

      <div className="tool-approval-args-heading">参数（敏感字段已脱敏）</div>
      <pre className="tool-approval-arguments">{request.argumentsPreview}</pre>
      <div className="tool-approval-note">
        风险标记由 MCP 服务提供，仅供参考。授权只对本次调用有效。
      </div>

      <div className="tool-approval-actions">
        <Button
          size="small"
          autoFocus
          disabled={submitting}
          onClick={() => settle(onDeny)}
        >
          拒绝本次
        </Button>
        <Button
          size="small"
          danger={highRisk}
          type="primary"
          loading={submitting}
          onClick={() => settle(onApprove)}
        >
          允许本次调用
        </Button>
      </div>
    </div>
  );
}
