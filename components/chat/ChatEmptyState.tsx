import { ReadOutlined } from '@ant-design/icons';

/** 空会话占位:scope 会话展示快捷问题,普通会话展示品牌提示。 */
export function ChatEmptyState({
  hasScope,
  onPreset,
}: {
  hasScope: boolean;
  onPreset: (text: string) => void;
}) {
  const presets = hasScope
    ? ['比较这些页面的核心差异', '整理成一份结构化报告']
    : ['概括这篇内容', '列出核心观点', '有哪些值得注意的细节'];
  return (
    <div className="chat-welcome">
      <div className="chat-welcome-mark" aria-hidden="true">
        <ReadOutlined />
      </div>
      <div className="chat-welcome-copy">
        <h1>{hasScope ? '从这些来源开始探究' : '从阅读到理解'}</h1>
        <p>
          {hasScope
            ? '围绕所选来源提问，比较和整理内容'
            : '围绕网页内容提问，整理值得保留的想法'}
        </p>
      </div>
      <div className="chat-welcome-prompts">
        <div className="chat-welcome-label">试着问</div>
        {presets.map((preset) => (
          <button key={preset} type="button" onClick={() => onPreset(preset)}>
            <span>{preset}</span>
            <span aria-hidden="true">↗</span>
          </button>
        ))}
      </div>
    </div>
  );
}
