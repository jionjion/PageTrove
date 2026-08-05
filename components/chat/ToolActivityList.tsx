import { useState } from 'react';
import {
  CaretDownOutlined,
  CaretRightOutlined,
  LoadingOutlined,
  ToolOutlined,
} from '@ant-design/icons';
import type { ChatToolCall } from '@/types/chat';
import type { ChatToolActivity } from '@/services/ai/provider';

/** 工具调用活动列表:标题行显示进行中/完成计数,verbose 时可展开明细。 */
export function ToolActivityList({
  calls,
  verbose,
}: {
  calls: (ChatToolCall | ChatToolActivity)[];
  verbose: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  if (calls.length === 0) return null;
  const running = calls.find((call) => call.status === 'running');
  const canExpand = verbose;
  return (
    <div className="tool-activity-list">
      <button
        type="button"
        className="tool-activity-header"
        onClick={() => canExpand && setExpanded((current) => !current)}
      >
        {canExpand ? (
          expanded ? <CaretDownOutlined /> : <CaretRightOutlined />
        ) : (
          <span style={{ width: 14, display: 'inline-block' }} />
        )}
        <ToolOutlined />
        {running ? (
          <>
            <span className="tool-activity-title">
              {verbose
                ? `正在调用 ${running.serverName} · ${running.toolName}…`
                : `正在调用工具（已执行 ${calls.filter((call) => call.status !== 'running').length} 个）…`}
            </span>
            <LoadingOutlined spin />
          </>
        ) : (
          <span className="tool-activity-title">已调用 {calls.length} 个工具</span>
        )}
      </button>
      {verbose &&
        expanded &&
        calls.map((call) => (
          <div className={`tool-activity ${call.status}`} key={call.id}>
            <div className="tool-activity-row">
              {call.status === 'running' && <LoadingOutlined spin />}
              <span className="tool-activity-name">
                {call.serverName} · {call.toolName}
              </span>
            </div>
            {call.summary && (
              <pre className="tool-activity-summary">{call.summary}</pre>
            )}
          </div>
        ))}
    </div>
  );
}
