import { Button, Cascader, Input, Tooltip } from 'antd';
import {
  AimOutlined,
  ArrowDownOutlined,
  ReloadOutlined,
  ScissorOutlined,
  SendOutlined,
  StopOutlined,
} from '@ant-design/icons';
import type { ModelOptionGroup } from '@/hooks/useChatController';

interface Props {
  input: string;
  busy: boolean;
  picking: boolean;
  capturing: boolean;
  visionEnabled: boolean;
  /** 当前生效模型的 provider::model 键。 */
  model?: string;
  /** 按供应商分组的两级模型选项。 */
  modelOptions: ModelOptionGroup[];
  awayFromBottom: boolean;
  /** 是否显示"重新读取当前页面"按钮（仅当前网页会话）。 */
  canRefreshPage: boolean;
  /** 已开启：下次提问将重新读取当前页面。 */
  refreshPagePending: boolean;
  onInputChange: (value: string) => void;
  onSend: () => void;
  onStop: () => void;
  onPick: () => void;
  onCapture: () => void;
  onModelChange: (model: string) => void;
  onScrollToBottom: () => void;
  onToggleRefreshPage: () => void;
}

/** 输入区:文本框、模型选择与发送/停止/选取/截图/回到底部按钮组。 */
export function ChatComposer({
  input,
  busy,
  picking,
  capturing,
  visionEnabled,
  model,
  modelOptions,
  awayFromBottom,
  canRefreshPage,
  refreshPagePending,
  onInputChange,
  onSend,
  onStop,
  onPick,
  onCapture,
  onModelChange,
  onScrollToBottom,
  onToggleRefreshPage,
}: Props) {
  // 两级级联:一级供应商(仅分组),二级模型(value 为完整 provider::model 键)。
  const cascaderOptions = modelOptions.map((group) => ({
    value: group.label,
    label: group.label,
    children: group.options,
  }));
  const activeGroup = modelOptions.find((group) =>
    group.options.some((option) => option.value === model),
  );
  const cascaderValue = model && activeGroup ? [activeGroup.label, model] : undefined;

  return (
    <div className="chat-input">
      <div className="chat-input-card">
        <Input.TextArea
          variant="borderless"
          aria-label="输入问题"
          autoSize={{ minRows: 3, maxRows: 8 }}
          placeholder="输入问题…"
          value={input}
          disabled={busy}
          onChange={(event) => onInputChange(event.target.value)}
          onPressEnter={(event) => {
            if (!event.shiftKey) {
              event.preventDefault();
              onSend();
            }
          }}
        />
        <div className="chat-input-footer">
          <Cascader
            size="small"
            variant="borderless"
            title="选择模型"
            aria-label="选择模型"
            style={{ minWidth: 120, maxWidth: 250 }}
            placeholder="选择模型"
            allowClear={false}
            expandTrigger="hover"
            value={cascaderValue}
            options={cascaderOptions}
            displayRender={(labels) => labels.at(-1) ?? ''}
            onChange={(value) => {
              const key = value.at(-1);
              if (typeof key === 'string') onModelChange(key);
            }}
          />
          <div className="chat-input-actions">
            {awayFromBottom && (
              <Tooltip title="回到底部">
                <Button
                  size="small"
                  aria-label="回到底部"
                  icon={<ArrowDownOutlined />}
                  onClick={onScrollToBottom}
                />
              </Tooltip>
            )}
            {canRefreshPage && (
              <Tooltip
                title={
                  refreshPagePending
                    ? '已开启：下次提问将重新读取当前页面'
                    : '下次提问重新读取当前页面'
                }
              >
                <Button
                  size="small"
                  aria-label="下次提问重新读取当前页面"
                  aria-pressed={refreshPagePending}
                  type={refreshPagePending ? 'primary' : 'default'}
                  ghost={refreshPagePending}
                  icon={<ReloadOutlined />}
                  disabled={busy}
                  onClick={onToggleRefreshPage}
                />
              </Tooltip>
            )}
            {busy ? (
              <Button
                size="small"
                danger
                aria-label="停止生成"
                icon={<StopOutlined />}
                onClick={onStop}
              />
            ) : (
              <Tooltip title="发送">
                <Button
                  size="small"
                  aria-label="发送"
                  type="primary"
                  icon={<SendOutlined />}
                  disabled={!input.trim()}
                  onClick={onSend}
                />
              </Tooltip>
            )}
            <Tooltip title="选取页面元素">
              <Button
                size="small"
                aria-label="选取页面元素"
                icon={<AimOutlined />}
                loading={picking}
                disabled={busy}
                onClick={onPick}
              />
            </Tooltip>
            <Tooltip title={visionEnabled ? '框选页面截图' : '当前模型未启用图片输入'}>
              <Button
                size="small"
                aria-label="框选页面截图"
                icon={<ScissorOutlined />}
                loading={capturing}
                disabled={busy || !visionEnabled}
                onClick={onCapture}
              />
            </Tooltip>
          </div>
        </div>
      </div>
    </div>
  );
}
