import type { CitationRef } from '@/types/chat';
import type { ChatToolActivity } from '@/services/ai/provider';

/**
 * 发送生命周期判别联合:
 * idle → (start) → preparing → (stream-start) → streaming → (finish) → idle。
 * 消灭 busy/streaming/refs 各自独立 useState 时的非法组合。
 */
export type SendPhase =
  | { status: 'idle' }
  | { status: 'preparing'; toolActivities: ChatToolActivity[] }
  | {
      status: 'streaming';
      text: string;
      refs?: CitationRef[];
      toolActivities: ChatToolActivity[];
    };

export type SendPhaseAction =
  | { type: 'start' }
  | { type: 'stream-start'; refs?: CitationRef[] }
  /** 流式回调整段覆盖(非追加),与 streamChat 现行为一致。 */
  | { type: 'chunk'; text: string }
  | { type: 'tool-activity'; activity: ChatToolActivity }
  | { type: 'finish' };

export const IDLE_PHASE: SendPhase = { status: 'idle' };

function upsertActivity(
  activities: ChatToolActivity[],
  activity: ChatToolActivity,
): ChatToolActivity[] {
  const index = activities.findIndex((item) => item.id === activity.id);
  if (index < 0) return [...activities, activity];
  return activities.map((item, itemIndex) =>
    itemIndex === index ? activity : item,
  );
}

export function sendPhaseReducer(
  state: SendPhase,
  action: SendPhaseAction,
): SendPhase {
  switch (action.type) {
    case 'start':
      return { status: 'preparing', toolActivities: [] };
    case 'stream-start':
      if (state.status === 'idle') return state;
      return {
        status: 'streaming',
        text: '',
        refs: action.refs,
        toolActivities: state.toolActivities,
      };
    case 'chunk':
      // 非流式态收到迟到 chunk(如 abort 后)直接忽略。
      if (state.status !== 'streaming') return state;
      return { ...state, text: action.text };
    case 'tool-activity':
      if (state.status === 'idle') return state;
      return {
        ...state,
        toolActivities: upsertActivity(state.toolActivities, action.activity),
      };
    case 'finish':
      return IDLE_PHASE;
  }
}
