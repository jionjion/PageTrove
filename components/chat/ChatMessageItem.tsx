import { Button, Tooltip } from 'antd';
import {
  CaretDownOutlined,
  CaretUpOutlined,
  CheckOutlined,
  ClockCircleOutlined,
  CopyOutlined,
  DislikeFilled,
  DislikeOutlined,
  LikeFilled,
  LikeOutlined,
  ReloadOutlined,
} from '@ant-design/icons';
import type { ChatMessage, CitationRef } from '@/types/chat';
import { formatTime, formatTokens } from '@/utils/format';
import { ToolActivityList } from '@/components/chat/ToolActivityList';
import { ChatMarkdown } from '@/components/chat/ChatMarkdown';

interface Props {
  message: ChatMessage;
  index: number;
  verbose: boolean;
  /** assistant 消息的引用映射,由父组件按 message.citationRefs ?? legacyRefs 算好。 */
  refs?: CitationRef[];
  copied: boolean;
  rating?: 'like' | 'dislike';
  busy: boolean;
  onCopy: (content: string, index: number) => void;
  onRate: (index: number, value: 'like' | 'dislike') => void;
  onRegenerate: (index: number) => void;
}

/** 单条消息:时间、工具调用摘要、气泡,assistant 追加 tokens/耗时与操作按钮。 */
export function ChatMessageItem({
  message,
  index,
  verbose,
  refs,
  copied,
  rating,
  busy,
  onCopy,
  onRate,
  onRegenerate,
}: Props) {
  return (
    <div className={`msg-group ${message.role}`}>
      <div className="msg-time">{formatTime(message.createdAt)}</div>
      {message.toolCalls && (
        <ToolActivityList calls={message.toolCalls} verbose={verbose} />
      )}
      <div className={`bubble ${message.role}`}>
        <ChatMarkdown
          content={message.content}
          refs={message.role === 'assistant' ? refs : undefined}
        />
      </div>
      {message.role === 'assistant' && (
        <div className="msg-footer">
          <div className="msg-stats">
            {message.usage && (
              <span className="msg-meta">
                <CaretUpOutlined />
                {formatTokens(message.usage.promptTokens)}
                <CaretDownOutlined />
                {formatTokens(message.usage.completionTokens)}
              </span>
            )}
            {message.elapsedMs !== undefined && (
              <span className="msg-meta">
                <ClockCircleOutlined />
                {(message.elapsedMs / 1_000).toFixed(1)}s
              </span>
            )}
          </div>
          <div className="msg-actions">
            <Tooltip title="复制">
              <Button
                type="text"
                size="small"
                icon={copied ? <CheckOutlined /> : <CopyOutlined />}
                onClick={() => onCopy(message.content, index)}
              />
            </Tooltip>
            <Tooltip title="有帮助">
              <Button
                type="text"
                size="small"
                className={rating === 'like' ? 'rated' : undefined}
                icon={rating === 'like' ? <LikeFilled /> : <LikeOutlined />}
                onClick={() => onRate(index, 'like')}
              />
            </Tooltip>
            <Tooltip title="没帮助">
              <Button
                type="text"
                size="small"
                className={rating === 'dislike' ? 'rated' : undefined}
                icon={
                  rating === 'dislike' ? <DislikeFilled /> : <DislikeOutlined />
                }
                onClick={() => onRate(index, 'dislike')}
              />
            </Tooltip>
            <Tooltip title="重新回答">
              <Button
                type="text"
                size="small"
                icon={<ReloadOutlined />}
                disabled={busy}
                onClick={() => onRegenerate(index)}
              />
            </Tooltip>
          </div>
        </div>
      )}
    </div>
  );
}
