import type { CitationRef } from '@/types/chat';
import type { ChatToolActivity } from '@/services/ai/provider';
import type { ToolApprovalRequest } from '@/types/mcp-tool';

interface ActiveSendPhase {
  runId: string;
  toolActivities: ChatToolActivity[];
  pendingApproval?: ToolApprovalRequest;
}
/** 每个异步回调都绑定 runId；旧运行不能改变新运行状态。 */
export type SendPhase =
  | { status: 'idle' }
  | ({ status: 'preparing' } & ActiveSendPhase)
  | ({
      status: 'streaming';
      text: string;
      refs?: CitationRef[];
    } & ActiveSendPhase);

export type SendPhaseAction =
  | { type: 'start'; runId: string }
  | { type: 'stream-start'; runId: string; refs?: CitationRef[] }
  | { type: 'chunk'; runId: string; text: string }
  | { type: 'tool-activity'; runId: string; activity: ChatToolActivity }
  | {
      type: 'approval-requested';
      runId: string;
      request: ToolApprovalRequest;
    }
  | { type: 'approval-cleared'; runId: string; requestId: string }
  | { type: 'finish'; runId: string }
  | { type: 'reset' };

export const IDLE_PHASE: SendPhase = { status: 'idle' };

function upsertActivity(
  activities: ChatToolActivity[],
  activity: ChatToolActivity,
): ChatToolActivity[] {
  const index = activities.findIndex((item) => item.id === activity.id);
  if (index < 0) return [...activities, activity];
  return activities.map((item, itemIndex) => (itemIndex === index ? activity : item));
}

function belongsToCurrentRun(
  state: SendPhase,
  action: Exclude<SendPhaseAction, { type: 'start' } | { type: 'reset' }>,
): state is Exclude<SendPhase, { status: 'idle' }> {
  return state.status !== 'idle' && state.runId === action.runId;
}

export function sendPhaseReducer(state: SendPhase, action: SendPhaseAction): SendPhase {
  if (action.type === 'reset') return IDLE_PHASE;
  if (action.type === 'start') {
    return {
      status: 'preparing',
      runId: action.runId,
      toolActivities: [],
    };
  }
  if (!belongsToCurrentRun(state, action)) return state;

  switch (action.type) {
    case 'stream-start':
      return {
        status: 'streaming',
        runId: state.runId,
        text: '',
        refs: action.refs,
        toolActivities: state.toolActivities,
        pendingApproval: state.pendingApproval,
      };
    case 'chunk':
      if (state.status !== 'streaming') return state;
      return { ...state, text: action.text };
    case 'tool-activity':
      return {
        ...state,
        toolActivities: upsertActivity(state.toolActivities, action.activity),
      };
    case 'approval-requested':
      return { ...state, pendingApproval: action.request };
    case 'approval-cleared':
      if (state.pendingApproval?.requestId !== action.requestId) return state;
      return { ...state, pendingApproval: undefined };
    case 'finish':
      return IDLE_PHASE;
  }
}
