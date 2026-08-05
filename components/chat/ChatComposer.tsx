import { Button, Input, Select, Tooltip } from 'antd';
import {
  AimOutlined,
  ArrowDownOutlined,
  ScissorOutlined,
  SendOutlined,
  StopOutlined,
} from '@ant-design/icons';

interface Props {
  input: string;
  busy: boolean;
  picking: boolean;
  capturing: boolean;
  visionEnabled: boolean;
  model?: string;
  modelOptions: string[];
  awayFromBottom: boolean;
  onInputChange: (value: string) => void;
  onSend: () => void;
  onStop: () => void;
  onPick: () => void;
  onCapture: () => void;
  onModelChange: (model: string) => void;
  onScrollToBottom: () => void;
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
  onInputChange,
  onSend,
  onStop,
  onPick,
  onCapture,
  onModelChange,
  onScrollToBottom,
}: Props) {
  return (
    <div className="chat-input">
      <div className="chat-input-card">
        <Input.TextArea
          variant="borderless"
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
          <Select
            size="small"
            variant="borderless"
            title="选择模型"
            style={{ maxWidth: 150 }}
            popupMatchSelectWidth={false}
            value={model}
            onChange={onModelChange}
            options={modelOptions.map((option) => ({ value: option, label: option }))}
          />
          <div className="chat-input-actions">
            {awayFromBottom && (
              <Tooltip title="回到底部">
                <Button
                  size="small"
                  icon={<ArrowDownOutlined />}
                  onClick={onScrollToBottom}
                />
              </Tooltip>
            )}
            {busy ? (
              <Button size="small" danger icon={<StopOutlined />} onClick={onStop} />
            ) : (
              <Tooltip title="发送">
                <Button
                  size="small"
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
                icon={<AimOutlined />}
                loading={picking}
                disabled={busy}
                onClick={onPick}
              />
            </Tooltip>
            <Tooltip
              title={visionEnabled ? '框选页面截图' : '当前模型未启用图片输入'}
            >
              <Button
                size="small"
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
