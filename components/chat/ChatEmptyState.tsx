import { ReadOutlined } from '@ant-design/icons';
import { EmptyState } from '@/components/EmptyState';

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
      <EmptyState
        icon={<ReadOutlined />}
        title="拾取互联网中有价值的碎片"
        description="收藏网页后，可以与 AI 对话分析"
      />
    );
  }
  return (
    <div className="scope-quick-questions">
      <div className="empty-state-icon"><ReadOutlined /></div>
      <div className="empty-state-title">已就绪，可针对所选来源提问</div>
      <div className="empty-state-desc">选择下方快捷问题或直接输入</div>
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
