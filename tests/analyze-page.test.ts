import { describe, expect, it } from 'vitest';
import { validateAnalyzeResult } from '@/services/ai/analyze-page';

describe('validateAnalyzeResult', () => {
  it('非有限 confidence 使用安全默认值', () => {
    expect(
      validateAnalyzeResult({
        summary: '摘要',
        tags: ['标签'],
        confidence: Number.NaN,
      }).confidence,
    ).toBe(0.5);
  });

  it('请求清洗正文时缺少 content 会 fail closed', () => {
    expect(() =>
      validateAnalyzeResult({ summary: '摘要', tags: ['标签'], confidence: 0.9 }, true),
    ).toThrow('AI 返回格式异常');
  });

  it('confidence 被限制到 0..1，正文按需接受', () => {
    expect(
      validateAnalyzeResult(
        {
          summary: '摘要',
          tags: ['标签'],
          confidence: 2,
          content: '正文',
        },
        true,
      ),
    ).toMatchObject({ confidence: 1, content: '正文' });
  });
});
