import { describe, expect, it } from 'vitest';
import { formatTime, formatTokens } from '@/utils/format';

describe('formatTokens', () => {
  it('千以下原样', () => {
    expect(formatTokens(999)).toBe('999');
  });

  it('千级带 k', () => {
    expect(formatTokens(1_000)).toBe('1.0k');
    expect(formatTokens(1_500)).toBe('1.5k');
  });

  it('百万级带 M', () => {
    expect(formatTokens(2_300_000)).toBe('2.3M');
  });
});

describe('formatTime', () => {
  it('今天只显示时分', () => {
    const now = new Date();
    now.setHours(9, 5, 0, 0);
    expect(formatTime(now.toISOString())).toBe('09:05');
  });

  it('跨日显示月-日', () => {
    const date = new Date();
    date.setDate(date.getDate() - 40);
    date.setHours(14, 30, 0, 0);
    expect(formatTime(date.toISOString())).toBe(
      `${date.getMonth() + 1}-${date.getDate()} 14:30`,
    );
  });
});
