import { Card, Input, Select, Typography } from 'antd';
import type { AnalyzeResult } from '@/types/ai';

interface Props {
  value: AnalyzeResult;
  onChange: (next: AnalyzeResult) => void;
}

function linesToArray(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

const Label = ({ children }: { children: string }) => (
  <Typography.Text strong style={{ display: 'block', margin: '8px 0 4px' }}>
    {children}
  </Typography.Text>
);

/** AI 结果编辑器：保存前允许用户修改所有字段 */
export function AnalyzeResultEditor({ value, onChange }: Props) {
  return (
    <Card size="small" title="AI 整理结果" style={{ width: '100%' }}>
      <Label>一句话介绍</Label>
      <Input.TextArea
        rows={2}
        value={value.summary}
        onChange={(e) => onChange({ ...value, summary: e.target.value })}
      />

      <Label>好玩的地方（每行一条）</Label>
      <Input.TextArea
        rows={3}
        value={value.interestingPoints.join('\n')}
        onChange={(e) =>
          onChange({ ...value, interestingPoints: linesToArray(e.target.value) })
        }
      />

      <Label>值得借鉴（每行一条）</Label>
      <Input.TextArea
        rows={3}
        value={value.inspiration.join('\n')}
        onChange={(e) =>
          onChange({ ...value, inspiration: linesToArray(e.target.value) })
        }
      />

      <Label>标签</Label>
      <Select
        mode="tags"
        style={{ width: '100%' }}
        placeholder="输入后回车添加标签"
        value={value.tags}
        onChange={(tags) => onChange({ ...value, tags: tags.slice(0, 6) })}
        open={false}
        suffixIcon={null}
        tokenSeparators={[',', '，']}
      />

      <Label>分类</Label>
      <Input
        value={value.category}
        onChange={(e) => onChange({ ...value, category: e.target.value })}
      />

      <Typography.Text type="secondary" style={{ display: 'block', marginTop: 8 }}>
        AI 置信度：{Math.round(value.confidence * 100)}%
      </Typography.Text>
    </Card>
  );
}
