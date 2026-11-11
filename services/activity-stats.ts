import type { ClipIndexEntry } from '@/types/clip';
import {
  addLocalDays,
  startOfLocalDay,
  toLocalDayKey,
  toLocalMonthKey,
} from '@/utils/date';

export interface DailyActivityCount {
  clips: number;
  messages: number;
  total: number;
}

export interface ActivityCalendarDay {
  dateKey: string;
  date: Date;
  clips: number;
  messages: number;
  total: number;
  /** 0 = 无活动；1–4 为固定阈值强度 */
  level: number;
  isFuture: boolean;
}

export interface ActivityCalendarWeek {
  /** 该列首日所在月份发生变化的标签，如 "3月" */
  monthLabel?: string;
  days: ActivityCalendarDay[];
}

export interface ActivitySummary {
  todayClips: number;
  todayMessages: number;
  todayTotal: number;
  last7DaysTotal: number;
  /** 连续活跃天数；今天无活动时从昨天起算 */
  activeStreak: number;
}

/** 固定阈值：0 / 1–2 / 3–5 / 6–9 / ≥10，不按当前最大值动态缩放。 */
export function activityLevel(total: number): number {
  if (total <= 0) return 0;
  if (total <= 2) return 1;
  if (total <= 5) return 2;
  if (total <= 9) return 3;
  return 4;
}

/** 合并收藏与聊天消息的每日计数；无效时间跳过。 */
export function aggregateDailyActivity(
  clips: ClipIndexEntry[],
  messagesByDay: Map<string, number>,
): Map<string, DailyActivityCount> {
  const daily = new Map<string, DailyActivityCount>();

  const bucket = (key: string): DailyActivityCount => {
    const existing = daily.get(key);
    if (existing) return existing;
    const created: DailyActivityCount = { clips: 0, messages: 0, total: 0 };
    daily.set(key, created);
    return created;
  };

  for (const clip of clips) {
    const key = toLocalDayKey(clip.createdAt);
    if (!key) continue;
    const counts = bucket(key);
    counts.clips += 1;
    counts.total += 1;
  }

  for (const [key, count] of messagesByDay) {
    if (!Number.isFinite(count) || count <= 0) continue;
    const counts = bucket(key);
    counts.messages += count;
    counts.total += count;
  }

  return daily;
}

/**
 * 生成近 N 周（默认 26 周）的日历网格。
 * 每列固定周一→周日，最后一列包含今天；今天之后的格子标记 isFuture。
 */
export function buildActivityCalendar(
  daily: Map<string, DailyActivityCount>,
  options: { today?: Date; weeks?: number } = {},
): ActivityCalendarWeek[] {
  const weeks = options.weeks ?? 26;
  const today = startOfLocalDay(options.today ?? new Date());
  const todayKey = toLocalDayKey(today);
  if (!todayKey) return [];

  // JS 的 getDay() 以周日为 0；换算成周一为第 1 天的偏移。
  const offsetFromMonday = (today.getDay() + 6) % 7;
  const weekStart = addLocalDays(today, -offsetFromMonday);
  const start = addLocalDays(weekStart, -(weeks - 1) * 7);

  const result: ActivityCalendarWeek[] = [];
  let lastMonth: string | undefined;

  for (let week = 0; week < weeks; week++) {
    const days: ActivityCalendarDay[] = [];
    let monthLabel: string | undefined;

    for (let day = 0; day < 7; day++) {
      const date = addLocalDays(start, week * 7 + day);
      const dateKey = toLocalDayKey(date);
      if (!dateKey) continue;

      const counts = daily.get(dateKey);
      const total = counts?.total ?? 0;
      days.push({
        dateKey,
        date,
        clips: counts?.clips ?? 0,
        messages: counts?.messages ?? 0,
        total,
        level: activityLevel(total),
        isFuture: dateKey > todayKey,
      });

      if (day === 0) {
        const monthKey = toLocalMonthKey(date);
        if (monthKey && monthKey !== lastMonth) {
          monthLabel = `${date.getMonth() + 1}月`;
        }
        lastMonth = monthKey;
      }
    }

    result.push({ monthLabel, days });
  }

  return result;
}

/** 今日、近 7 天（含今天）与连续活跃天数。 */
export function summarizeActivity(
  daily: Map<string, DailyActivityCount>,
  todayInput: Date = new Date(),
): ActivitySummary {
  const today = startOfLocalDay(todayInput);
  const todayKey = toLocalDayKey(today);
  const todayCounts = todayKey ? daily.get(todayKey) : undefined;

  let last7DaysTotal = 0;
  for (let offset = 6; offset >= 0; offset--) {
    const key = toLocalDayKey(addLocalDays(today, -offset));
    if (key) last7DaysTotal += daily.get(key)?.total ?? 0;
  }

  let cursor = today;
  if ((todayCounts?.total ?? 0) === 0) cursor = addLocalDays(cursor, -1);
  let activeStreak = 0;
  for (;;) {
    const key = toLocalDayKey(cursor);
    if (!key || (daily.get(key)?.total ?? 0) <= 0) break;
    activeStreak += 1;
    cursor = addLocalDays(cursor, -1);
  }

  return {
    todayClips: todayCounts?.clips ?? 0,
    todayMessages: todayCounts?.messages ?? 0,
    todayTotal: todayCounts?.total ?? 0,
    last7DaysTotal,
    activeStreak,
  };
}
