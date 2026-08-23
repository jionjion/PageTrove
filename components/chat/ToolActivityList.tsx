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
  const active = calls.find(
    (call) => call.status === 'running' || call.status === 'awaiting-approval',
  );
  const unknownCount = calls.filter((call) => call.status === 'unknown').length;
  const canExpand = verbose;
  return (
    <div className="tool-activity-list">
      <button
        type="button"
        className="tool-activity-header"
        onClick={() => canExpand && setExpanded((current) => !current)}
      >
        {canExpand ? (
          expanded ? (
            <CaretDownOutlined />
          ) : (
            <CaretRightOutlined />
          )
        ) : (
          <span style={{ width: 14, display: 'inline-block' }} />
        )}
        <ToolOutlined />
        {active ? (
          <>
            <span className="tool-activity-title">
              {verbose
                ? active.status === 'awaiting-approval'
                  ? `等待确认 ${active.serverName} · ${active.toolName}`
                  : `正在调用 ${active.serverName} · ${active.toolName}…`
                : active.status === 'awaiting-approval'
                  ? '等待确认工具调用'
                  : `正在调用工具（已完成 ${calls.filter((call) => ['success', 'error', 'denied'].includes(call.status)).length} 个）…`}
            </span>
            {active.status === 'running' && <LoadingOutlined spin />}
          </>
        ) : (
          <span className="tool-activity-title">
            {unknownCount > 0
              ? `${unknownCount} 个工具的执行结果未知`
              : `已调用 ${calls.length} 个工具`}
          </span>
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
            {call.summary && <pre className="tool-activity-summary">{call.summary}</pre>}
          </div>
        ))}
    </div>
  );
}
