import { useCallback, useEffect, useState } from 'react';
import { Card, Progress, Statistic, Typography } from 'antd';
import {
  FolderOpenOutlined,
  MessageOutlined,
  TagsOutlined,
} from '@ant-design/icons';
import { queryClips } from '@/services/clip-store';
import { getChatIndex } from '@/services/chat-store';
import { onDataChanged } from '@/services/data-events';

interface MonthBucket {
  /** 展示标签，如 "3月" */
  label: string;
  count: number;
}

interface Stats {
  clipCount: number;
  chatCount: number;
  messageCount: number;
  tagCount: number;
  months: MonthBucket[];
  storageUsage?: number;
  storageQuota?: number;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

/** 最近 6 个月（含当月）的 YYYY-MM 键与展示标签 */
function recentMonths(): { key: string; label: string }[] {
  const result: { key: string; label: string }[] = [];
  const now = new Date();
  for (let offset = 5; offset >= 0; offset--) {
    const d = new Date(now.getFullYear(), now.getMonth() - offset, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    result.push({ key, label: `${d.getMonth() + 1}月` });
  }
  return result;
}

async function collectStats(): Promise<Stats> {
  const [entries, chats] = await Promise.all([queryClips(), getChatIndex()]);

  const tags = new Set<string>();
  const monthCounts = new Map<string, number>();
  for (const entry of entries) {
    entry.tags.forEach((t) => tags.add(t));
    const month = entry.createdAt.slice(0, 7);
    monthCounts.set(month, (monthCounts.get(month) ?? 0) + 1);
  }

  const stats: Stats = {
    clipCount: entries.length,
    chatCount: chats.length,
    messageCount: chats.reduce((sum, c) => sum + c.messageCount, 0),
    tagCount: tags.size,
    months: recentMonths().map(({ key, label }) => ({
      label,
      count: monthCounts.get(key) ?? 0,
    })),
  };

  try {
    const estimate = await navigator.storage?.estimate?.();
    if (estimate) {
      stats.storageUsage = estimate.usage;
      stats.storageQuota = estimate.quota;
    }
  } catch {
    // 估算不可用时隐藏存储条目
  }
  return stats;
}

const CHART = {
  width: 300,
  height: 96,
  paddingX: 20,
  paddingTop: 18,
  paddingBottom: 22,
} as const;

/** 近 6 个月收藏折线图：SVG 折线 + 渐变面积 + 数据点 */
function MonthLineChart({
  months,
  maxCount,
}: {
  months: MonthBucket[];
  maxCount: number;
}) {
  const { width, height, paddingX, paddingTop, paddingBottom } = CHART;
  const innerWidth = width - paddingX * 2;
  const innerHeight = height - paddingTop - paddingBottom;
  const stepX = months.length > 1 ? innerWidth / (months.length - 1) : 0;

  const points = months.map((m, i) => ({
    x: paddingX + i * stepX,
    y: paddingTop + innerHeight - (m.count / maxCount) * innerHeight,
    ...m,
  }));

  const linePath = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`)
    .join(' ');
  const baseline = paddingTop + innerHeight;
  const areaPath = `${linePath} L${points[points.length - 1].x},${baseline} L${points[0].x},${baseline} Z`;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      style={{
        width: '100%',
        maxWidth: 420,
        height: 'auto',
        display: 'block',
        marginTop: 4,
      }}
    >
      <defs>
        <linearGradient id="pagetrove-stats-area" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#1677ff" stopOpacity="0.18" />
          <stop offset="100%" stopColor="#1677ff" stopOpacity="0.02" />
        </linearGradient>
      </defs>

      <line
        x1={paddingX}
        y1={baseline}
        x2={width - paddingX}
        y2={baseline}
        stroke="#f0f0f0"
      />
      <path d={areaPath} fill="url(#pagetrove-stats-area)" />
      <path
        d={linePath}
        fill="none"
        stroke="#1677ff"
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
      />

      {points.map((p) => (
        <g key={p.label}>
          <circle cx={p.x} cy={p.y} r="2.5" fill="#fff" stroke="#1677ff" strokeWidth="1.5">
            <title>{`${p.label}：${p.count} 条`}</title>
          </circle>
          {p.count > 0 && (
            <text
              x={p.x}
              y={p.y - 6}
              textAnchor="middle"
              fontSize="9"
              fill="#8c8c8c"
            >
              {p.count}
            </text>
          )}
          <text
            x={p.x}
            y={height - 6}
            textAnchor="middle"
            fontSize="9"
            fill="#8c8c8c"
          >
            {p.label}
          </text>
        </g>
      ))}
    </svg>
  );
}

export function DataStatsPanel() {
  const [stats, setStats] = useState<Stats>();

  const refresh = useCallback(() => {
    void collectStats().then(setStats);
  }, []);

  useEffect(() => {
    refresh();
    const offClips = onDataChanged('clips', refresh);
    const offChats = onDataChanged('chats', refresh);
    return () => {
      offClips();
      offChats();
    };
  }, [refresh]);

  if (!stats) return null;

  const maxMonth = Math.max(1, ...stats.months.map((m) => m.count));
  const usagePercent =
    stats.storageUsage !== undefined && stats.storageQuota
      ? Math.min(100, (stats.storageUsage / stats.storageQuota) * 100)
      : undefined;

  return (
    <div>
      <Typography.Text strong className="options-section-label">
        使用概况
      </Typography.Text>
      <div style={{ display: 'flex', gap: 12, marginBottom: 12 }}>
        <Card size="small" style={{ flex: 1 }}>
          <Statistic
            title={<span style={{ fontSize: 13 }}>收藏</span>}
            value={stats.clipCount}
            valueStyle={{ fontSize: 20 }}
            prefix={<FolderOpenOutlined />}
            suffix={<span style={{ fontSize: 12 }}>条</span>}
          />
        </Card>
        <Card size="small" style={{ flex: 1 }}>
          <Statistic
            title={<span style={{ fontSize: 13 }}>对话</span>}
            value={stats.chatCount}
            valueStyle={{ fontSize: 20 }}
            prefix={<MessageOutlined />}
            suffix={
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                轮 / {stats.messageCount} 条消息
              </Typography.Text>
            }
          />
        </Card>
        <Card size="small" style={{ flex: 1 }}>
          <Statistic
            title={<span style={{ fontSize: 13 }}>标签</span>}
            value={stats.tagCount}
            valueStyle={{ fontSize: 20 }}
            prefix={<TagsOutlined />}
            suffix={<span style={{ fontSize: 12 }}>枚</span>}
          />
        </Card>
      </div>

      <Typography.Text strong className="options-section-label">
        近 6 个月收藏
      </Typography.Text>
      <Card size="small" style={{ marginBottom: 12 }}>
        <MonthLineChart months={stats.months} maxCount={maxMonth} />
      </Card>

      {usagePercent !== undefined && (
        <>
          <Typography.Text strong className="options-section-label">
            存储用量
          </Typography.Text>
          <Card size="small">
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              浏览器存储估算（含扩展全部本地数据）
            </Typography.Text>
            <Progress
              percent={Number(usagePercent.toFixed(2))}
              size="small"
              format={() =>
                `${formatBytes(stats.storageUsage!)} / ${formatBytes(stats.storageQuota!)}`
              }
            />
          </Card>
        </>
      )}
    </div>
  );
}
