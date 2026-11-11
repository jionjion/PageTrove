import { describe, expect, it } from 'vitest';
import {
  activityLevel,
  aggregateDailyActivity,
  buildActivityCalendar,
  summarizeActivity,
  type DailyActivityCount,
} from '@/services/activity-stats';
import type { ClipIndexEntry } from '@/types/clip';
import { toLocalDayKey, toLocalMonthKey } from '@/utils/date';

function makeClip(createdAt: string, id = createdAt): ClipIndexEntry {
  return {
    id,
    title: '测试收藏',
    url: 'https://example.com',
    normalizedUrl: 'https://example.com',
    domain: 'example.com',
    tags: [],
    createdAt,
  };
}

function dailyOf(entries: [Date, number, number][]): Map<string, DailyActivityCount> {
  const daily = new Map<string, DailyActivityCount>();
  for (const [date, clips, messages] of entries) {
    const key = toLocalDayKey(date)!;
    daily.set(key, { clips, messages, total: clips + messages });
  }
  return daily;
}

describe('本地日期键', () => {
  it('凌晨与深夜都归属本地自然日', () => {
    expect(toLocalDayKey(new Date(2026, 0, 2, 0, 30))).toBe('2026-01-02');
    expect(toLocalDayKey(new Date(2026, 0, 2, 23, 30))).toBe('2026-01-02');
    expect(toLocalMonthKey(new Date(2026, 11, 31, 23, 59))).toBe('2026-12');
  });

  it('无效时间返回 undefined', () => {
    expect(toLocalDayKey('not-a-date')).toBeUndefined();
    expect(toLocalMonthKey('not-a-date')).toBeUndefined();
  });
});

describe('activityLevel', () => {
  it('使用固定阈值分层', () => {
    expect([0, 1, 2, 3, 5, 6, 9, 10, 100].map(activityLevel)).toEqual([
      0, 1, 1, 2, 2, 3, 3, 4, 4,
    ]);
  });
});

describe('aggregateDailyActivity', () => {
  it('合并收藏与聊天消息，跳过无效收藏时间', () => {
    const clips = [
      makeClip(new Date(2026, 10, 11, 9, 0).toISOString(), 'a'),
      makeClip(new Date(2026, 10, 11, 22, 0).toISOString(), 'b'),
      makeClip('bad-time', 'bad'),
    ];
    const messages = new Map<string, number>([
      ['2026-11-11', 3],
      ['2026-11-10', 2],
      ['2026-11-09', 0],
    ]);

    const daily = aggregateDailyActivity(clips, messages);
    expect(daily.get('2026-11-11')).toEqual({ clips: 2, messages: 3, total: 5 });
    expect(daily.get('2026-11-10')).toEqual({ clips: 0, messages: 2, total: 2 });
    expect(daily.has('2026-11-09')).toBe(false);
  });
});

describe('buildActivityCalendar', () => {
  const today = new Date(2026, 10, 11); // 周三

  it('生成 26 周、周一起始，最后一列包含今天', () => {
    const weeks = buildActivityCalendar(dailyOf([]), { today, weeks: 26 });
    expect(weeks).toHaveLength(26);
    weeks.forEach((week) => expect(week.days).toHaveLength(7));

    expect(weeks[0].days[0].date.getDay()).toBe(1);
    const todayCell = weeks[25].days.find((day) => day.dateKey === '2026-11-11');
    expect(todayCell).toMatchObject({ total: 0, isFuture: false });
    expect(weeks[25].days[0].dateKey).toBe('2026-11-09');
    expect(weeks[25].days.slice(3).every((day) => day.isFuture)).toBe(true);
  });

  it('填入每日计数与强度，未来格不计数', () => {
    const daily = dailyOf([[today, 2, 8]]);
    const weeks = buildActivityCalendar(daily, { today, weeks: 26 });
    const cell = weeks[25].days.find((day) => day.dateKey === '2026-11-11')!;
    expect(cell).toMatchObject({ clips: 2, messages: 8, total: 10, level: 4 });
    expect(weeks[25].days[6]).toMatchObject({ total: 0, isFuture: true });
  });

  it('列首月份变化时生成月份标签', () => {
    const weeks = buildActivityCalendar(dailyOf([]), { today, weeks: 26 });
    expect(weeks[0].monthLabel).toBeDefined();
    expect(weeks.some((week) => week.monthLabel === '11月')).toBe(true);
  });
});

describe('summarizeActivity', () => {
  const today = new Date(2026, 10, 11);

  it('汇总今日、近 7 天与连续活跃天数', () => {
    const daily = dailyOf([
      [new Date(2026, 10, 11), 1, 2],
      [new Date(2026, 10, 10), 1, 0],
      [new Date(2026, 10, 8), 0, 2],
      [new Date(2026, 10, 7), 5, 5],
    ]);
    expect(summarizeActivity(daily, today)).toEqual({
      todayClips: 1,
      todayMessages: 2,
      todayTotal: 3,
      last7DaysTotal: 16,
      activeStreak: 2,
    });
  });

  it('今天无活动时从昨天起算连续天数', () => {
    const daily = dailyOf([
      [new Date(2026, 10, 10), 1, 0],
      [new Date(2026, 10, 9), 0, 1],
    ]);
    expect(summarizeActivity(daily, today).activeStreak).toBe(2);
  });

  it('近 7 天只统计含今天的最近 7 天', () => {
    const daily = dailyOf([
      [new Date(2026, 10, 5), 1, 0], // 6 天前，包含
      [new Date(2026, 10, 4), 1, 0], // 7 天前，不包含
    ]);
    expect(summarizeActivity(daily, today).last7DaysTotal).toBe(1);
  });
});
