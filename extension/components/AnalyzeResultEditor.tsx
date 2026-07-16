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

function tagsToArray(text: string): string[] {
  return text
    .split(/[,，]/)
    .map((tag) => tag.trim())
    .filter(Boolean)
    .slice(0, 6);
}

/** AI 结果编辑器：保存前允许用户修改所有字段 */
export function AnalyzeResultEditor({ value, onChange }: Props) {
  return (
    <section className="card analyze-editor">
      <label className="field-label">一句话介绍</label>
      <textarea
        rows={2}
        value={value.summary}
        onChange={(e) => onChange({ ...value, summary: e.target.value })}
      />

      <label className="field-label">好玩的地方（每行一条）</label>
      <textarea
        rows={3}
        value={value.interestingPoints.join('\n')}
        onChange={(e) =>
          onChange({ ...value, interestingPoints: linesToArray(e.target.value) })
        }
      />

      <label className="field-label">值得借鉴（每行一条）</label>
      <textarea
        rows={3}
        value={value.inspiration.join('\n')}
        onChange={(e) =>
          onChange({ ...value, inspiration: linesToArray(e.target.value) })
        }
      />

      <label className="field-label">标签（逗号分隔）</label>
      <input
        type="text"
        value={value.tags.join(', ')}
        onChange={(e) => onChange({ ...value, tags: tagsToArray(e.target.value) })}
      />

      <label className="field-label">分类</label>
      <input
        type="text"
        value={value.category}
        onChange={(e) => onChange({ ...value, category: e.target.value })}
      />

      <div className="confidence">AI 置信度：{Math.round(value.confidence * 100)}%</div>
    </section>
  );
}
