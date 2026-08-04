import { describe, expect, it } from 'vitest';
import {
  MAX_SCOPE_TOTAL_CHARS,
  MIN_SOURCE_CHARS,
  selectRelevantExcerpt,
  sourceBudget,
} from '@/services/content-excerpts';

describe('sourceBudget', () => {
  it('无来源时返回总预算', () => {
    expect(sourceBudget(0)).toBe(MAX_SCOPE_TOTAL_CHARS);
  });

  it('按来源数平分预算', () => {
    expect(sourceBudget(2)).toBe(Math.floor(MAX_SCOPE_TOTAL_CHARS / 2));
  });

  it('来源很多时不低于最小预算', () => {
    expect(sourceBudget(100)).toBe(MIN_SOURCE_CHARS);
  });
});

describe('selectRelevantExcerpt', () => {
  it('空正文返回空串', () => {
    expect(selectRelevantExcerpt('   ', '问题', 100)).toBe('');
  });

  it('正文短于预算时全文返回', () => {
    expect(selectRelevantExcerpt('短正文', '问题', 100)).toBe('短正文');
  });

  it('超预算且无命中时截断开头', () => {
    const content = 'a'.repeat(5000);
    const result = selectRelevantExcerpt(content, 'zzz', 1000);
    expect(result).toBe('a'.repeat(1000));
  });

  it('命中词的段落被优先保留', () => {
    const filler = '无关内容。'.repeat(300); // 约 1500 字,保证分块
    const target = '这里讨论量子计算的最新进展。';
    const content = `${filler}\n${target}\n${filler}`;
    const result = selectRelevantExcerpt(content, '量子计算', 1600);
    expect(result).toContain('量子计算');
  });

  it('结果不超过预算', () => {
    const content = '段落内容。'.repeat(2000);
    const result = selectRelevantExcerpt(content, '段落', 3000);
    expect(result.length).toBeLessThanOrEqual(3000);
  });

  it('首段始终保留', () => {
    const first = '开头段落标识XYZ。';
    const content = first + '其他内容。'.repeat(1000) + '量子计算。';
    const result = selectRelevantExcerpt(content, '量子计算', 2000);
    expect(result.startsWith(first.slice(0, 10))).toBe(true);
  });
});
