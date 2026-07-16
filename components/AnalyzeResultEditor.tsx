import { Button, Card, Input, Select, Typography } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import type { AnalyzeResult } from '@/types/ai';

interface Props {
  value: AnalyzeResult;
  onChange: (next: AnalyzeResult) => void;
  /** 重新执行 AI 整理 */
  onRetry?: () => void;
}

const Label = ({ children }: { children: string }) => (
  <Typography.Text strong style={{ display: 'block', margin: '8px 0 4px' }}>
    {children}
  </Typography.Text>
);

/** AI 结果编辑器：保存前允许用户修改所有字段 */
export function AnalyzeResultEditor({ value, onChange, onRetry }: Props) {
  return (
    <Card
      size="small"
      title="AI 整理结果"
      style={{ width: '100%' }}
      extra={
        onRetry && (
          <Button size="small" type="text" icon={<ReloadOutlined />} onClick={onRetry}>
            重新整理
          </Button>
        )
      }
    >
      <Label>摘要</Label>
      <Input.TextArea
        autoSize={{ minRows: 3, maxRows: 6 }}
        value={value.summary}
        onChange={(e) => onChange({ ...value, summary: e.target.value })}
      />

      <Label>标签（最多5个）</Label>
      <Select
        mode="tags"
        style={{ width: '100%' }}
        placeholder="输入后回车添加标签"
        value={value.tags}
        onChange={(tags) => onChange({ ...value, tags: tags.slice(0, 5) })}
        open={false}
        suffixIcon={null}
        tokenSeparators={[',', '，']}
      />

      <Typography.Text type="secondary" style={{ display: 'block', marginTop: 8 }}>
        AI 置信度：{Math.round(value.confidence * 100)}%
      </Typography.Text>
    </Card>
  );
}
