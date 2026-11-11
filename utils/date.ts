/** 本地日期工具：所有“天/月”均按浏览器本地时区计算，避免 UTC 串日。 */

function toDate(value: Date | string): Date | undefined {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

export function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/** 按本地日历加减自然日，不使用毫秒运算（避免夏令时导致 23/25 小时）。 */
export function addLocalDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

/** 本地自然日键：YYYY-MM-DD；无效时间返回 undefined。 */
export function toLocalDayKey(value: Date | string): string | undefined {
  const date = toDate(value);
  if (!date) return undefined;
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(
    2,
    '0',
  )}-${String(date.getDate()).padStart(2, '0')}`;
}

/** 本地自然月键：YYYY-MM；无效时间返回 undefined。 */
export function toLocalMonthKey(value: Date | string): string | undefined {
  const date = toDate(value);
  if (!date) return undefined;
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}
