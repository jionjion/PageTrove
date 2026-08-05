import { LoadingOutlined } from '@ant-design/icons';
import type { CitationRef } from '@/types/chat';
import type { ChatToolActivity } from '@/services/ai/provider';
import { ToolActivityList } from '@/components/chat/ToolActivityList';
import { ChatMarkdown } from '@/components/chat/ChatMarkdown';

interface Props {
  /** undefined=未在流式;''=已开始但尚无内容(显示"正在生成…")。 */
  streaming?: string;
  refs?: CitationRef[];
  toolActivities: ChatToolActivity[];
  verbose: boolean;
}

/** 流式回答气泡:流式文本或"正在生成…"占位,连同进行中的工具活动。 */
export function StreamingBubble({ streaming, refs, toolActivities, verbose }: Props) {
  if (streaming === undefined && toolActivities.length === 0) return null;
  return (
    <div className="msg-group assistant">
      <ToolActivityList calls={toolActivities} verbose={verbose} />
      <div className="bubble assistant">
        {streaming ? (
          <ChatMarkdown content={streaming} refs={refs} />
        ) : (
          <span className="msg-generating">
            <LoadingOutlined spin /> 正在生成…
          </span>
        )}
      </div>
    </div>
  );
}
