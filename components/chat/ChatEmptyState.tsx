import { ReadOutlined } from '@ant-design/icons';

/** 空会话占位:scope 会话展示快捷问题,普通会话展示品牌提示。 */
export function ChatEmptyState({
  hasScope,
  onPreset,
}: {
  hasScope: boolean;
  onPreset: (text: string) => void;
}) {
  if (!hasScope) {
    return (
      <div className="empty-hint chat-empty">
        <ReadOutlined className="chat-empty-icon" />
        <div>拾取互联网中有价值的碎片</div>
      </div>
    );
  }
  return (
    <div className="scope-quick-questions">
      <ReadOutlined className="chat-empty-icon" />
      <div>已就绪，可针对所选来源提问</div>
      <div className="scope-quick-divider">
        <span className="scope-quick-divider-line" />
        <span className="scope-quick-divider-dot" />
        <span className="scope-quick-divider-line" />
      </div>
      {['比较这些页面的核心差异', '整理成一份结构化报告'].map((preset) => (
        <span
          key={preset}
          className="scope-quick-question"
          onClick={() => onPreset(preset)}
        >
          {preset}
        </span>
      ))}
    </div>
  );
}
