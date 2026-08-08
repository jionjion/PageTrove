import type { ReactNode } from 'react';

/**
 * 统一空状态占位：垂直居中，图标 + 标题 + 说明。
 * 三个视图（收藏页、当前页、对话）共用，保持风格一致。
 */
export function EmptyState({
  icon,
  title,
  description,
}: {
  icon: ReactNode;
  title: string;
  description: string;
}) {
  return (
    <div className="empty-state">
      <div className="empty-state-icon">{icon}</div>
      <div className="empty-state-title">{title}</div>
      <div className="empty-state-desc">{description}</div>
    </div>
  );
}
