/** token 数格式化:1.5k / 2.3M。 */
export function formatTokens(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return String(value);
}

/** ISO 时间 → 本地展示:同日只显示时分,跨日加"月-日"。 */
export function formatTime(iso: string): string {
  const date = new Date(iso);
  const sameDay = date.toDateString() === new Date().toDateString();
  const time = `${String(date.getHours()).padStart(2, '0')}:${String(
    date.getMinutes(),
  ).padStart(2, '0')}`;
  return sameDay ? time : `${date.getMonth() + 1}-${date.getDate()} ${time}`;
}
