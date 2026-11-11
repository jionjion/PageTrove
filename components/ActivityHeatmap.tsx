import { useMemo } from 'react';
import { Typography } from 'antd';
import {
  buildActivityCalendar,
  summarizeActivity,
  type DailyActivityCount,
} from '@/services/activity-stats';

const CELL = 15;
const GAP = 4;
const STEP = CELL + GAP;
const LEFT_PAD = 20;
const TOP_PAD = 14;
const WEEKS = 26;
const WIDTH = LEFT_PAD + WEEKS * STEP + 8;
const HEIGHT = TOP_PAD + 7 * STEP - GAP;

const LEVEL_COLORS = ['#ebedf0', '#d6e4ff', '#91caff', '#4096ff', '#1677ff'];

const WEEKDAY_LABELS: { row: number; label: string }[] = [
  { row: 0, label: '一' },
  { row: 2, label: '三' },
  { row: 4, label: '五' },
];

interface Props {
  daily: Map<string, DailyActivityCount>;
  today: Date;
}

function TooltipText({
  month,
  day,
  clips,
  messages,
}: {
  month: number;
  day: number;
  clips: number;
  messages: number;
}) {
  return `${month}月${day}日：收藏 ${clips} 条 · 对话 ${messages} 条`;
}

export function ActivityHeatmap({ daily, today }: Props) {
  const weeks = useMemo(
    () => buildActivityCalendar(daily, { today, weeks: WEEKS }),
    [daily, today],
  );
  const summary = useMemo(() => summarizeActivity(daily, today), [daily, today]);

  return (
    <div className="activity-heatmap">
      <div className="activity-heatmap-summary">
        <span>
          今日 <strong>{summary.todayTotal}</strong>
          <Typography.Text type="secondary">
            （收藏 {summary.todayClips} · 对话 {summary.todayMessages}）
          </Typography.Text>
        </span>
        <span>
          近 7 天 <strong>{summary.last7DaysTotal}</strong>
        </span>
        <span>
          连续活跃 <strong>{summary.activeStreak}</strong> 天
        </span>
      </div>

      <svg
        className="activity-heatmap-svg"
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        role="img"
        aria-label={`近 6 个月每日活跃：今日 ${summary.todayTotal} 条，近 7 天 ${summary.last7DaysTotal} 条，连续活跃 ${summary.activeStreak} 天`}
      >
        {weeks.map((week, weekIndex) =>
          week.monthLabel ? (
            <text
              key={`month-${week.days[0]?.dateKey ?? weekIndex}`}
              x={LEFT_PAD + weekIndex * STEP}
              y={9}
              fontSize="9"
              fill="#8c8c8c"
            >
              {week.monthLabel}
            </text>
          ) : null,
        )}

        {WEEKDAY_LABELS.map(({ row, label }) => (
          <text
            key={label}
            x={LEFT_PAD - 6}
            y={TOP_PAD + row * STEP + CELL / 2}
            textAnchor="end"
            dominantBaseline="middle"
            fontSize="9"
            fill="#8c8c8c"
          >
            {label}
          </text>
        ))}

        {weeks.map((week, weekIndex) =>
          week.days.map((day, dayIndex) => {
            const x = LEFT_PAD + weekIndex * STEP;
            const y = TOP_PAD + dayIndex * STEP;
            if (day.isFuture) {
              return (
                <rect
                  key={day.dateKey}
                  x={x}
                  y={y}
                  width={CELL}
                  height={CELL}
                  rx={3}
                  fill="transparent"
                />
              );
            }
            return (
              <rect
                key={day.dateKey}
                x={x}
                y={y}
                width={CELL}
                height={CELL}
                rx={3}
                fill={LEVEL_COLORS[day.level]}
              >
                <title>
                  {TooltipText({
                    month: day.date.getMonth() + 1,
                    day: day.date.getDate(),
                    clips: day.clips,
                    messages: day.messages,
                  })}
                </title>
              </rect>
            );
          }),
        )}
      </svg>
    </div>
  );
}
