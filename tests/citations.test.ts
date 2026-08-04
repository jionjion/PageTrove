import { describe, expect, it } from 'vitest';
import { linkifyCitations } from '@/services/citations';

const sources = [
  { url: 'https://a.example.com' },
  { url: 'https://b.example.com' },
];

describe('linkifyCitations', () => {
  it('将 [S1] 替换为对应来源链接', () => {
    expect(linkifyCitations('见 [S1] 与 [S2]。', sources)).toBe(
      '见 [S1](https://a.example.com) 与 [S2](https://b.example.com)。',
    );
  });

  it('无来源时原样返回', () => {
    expect(linkifyCitations('见 [S1]。', undefined)).toBe('见 [S1]。');
    expect(linkifyCitations('见 [S1]。', [])).toBe('见 [S1]。');
  });

  it('已是链接形式的不重复处理', () => {
    const input = '见 [S1](https://a.example.com)。';
    expect(linkifyCitations(input, sources)).toBe(input);
  });

  it('越界编号保持原样', () => {
    expect(linkifyCitations('见 [S99]。', sources)).toBe('见 [S99]。');
  });

  it('同一编号多次出现均替换', () => {
    expect(linkifyCitations('[S1] 和 [S1]', sources)).toBe(
      '[S1](https://a.example.com) 和 [S1](https://a.example.com)',
    );
  });

  it('已知局限:代码块中的 [S1] 也会被替换(P1 风险,计划以 remark 插件修复)', () => {
    // 该用例固化当前行为;修复后应改为断言代码块内不被改写。
    expect(linkifyCitations('`[S1]`', sources)).toBe(
      '`[S1](https://a.example.com)`',
    );
  });
});
