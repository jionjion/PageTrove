import type { ReactNode } from 'react';
import {
  BlockedArt,
  ClipsArt,
  HistoryArt,
  ResearchArt,
  SearchArt,
} from '@/components/empty-state/EmptyStateArt';

export type EmptyStateArt = 'history' | 'clips' | 'research' | 'blocked' | 'search';

const ART_MAP: Record<EmptyStateArt, () => ReactNode> = {
  history: HistoryArt,
  clips: ClipsArt,
  research: ResearchArt,
  blocked: BlockedArt,
  search: SearchArt,
};

interface EmptyStateAction {
  label: string;
  icon?: ReactNode;
  onClick: () => void;
}

/**
 * 统一空状态占位:直接复用对话欢迎页(.chat-welcome)的排版与视觉——
 * 品牌插画 + 渐变标题 + 说明 + 可选行动按钮,保证与 ChatEmptyState 同一副好看的样子。
 * 外层 .empty-state 绝对定位铺满 .app-body 并垂直居中,各视图位置一致。
 */
export function EmptyState({
  art,
  title,
  description,
  action,
}: {
  art: EmptyStateArt;
  title: string;
  description: string;
  action?: EmptyStateAction;
}) {
  const Art = ART_MAP[art];
  return (
    <div className="empty-state">
      <div className="chat-welcome">
        <div className="chat-welcome-hero" aria-hidden="true">
          <Art />
        </div>
        <div className="chat-welcome-copy">
          <h1>{title}</h1>
          <p>{description}</p>
        </div>
        {action && (
          <button type="button" className="empty-state-action" onClick={action.onClick}>
            {action.icon}
            <span>{action.label}</span>
          </button>
        )}
      </div>
    </div>
  );
}
