import { describe, expect, it } from 'vitest';
import { IDLE_PHASE, type SendPhase, sendPhaseReducer } from '@/services/chat-send-phase';
import type { ChatToolActivity } from '@/services/ai/provider';
import type { ToolApprovalRequest } from '@/types/mcp-tool';

const RUN_A = 'run-a';
const RUN_B = 'run-b';

const activity = (id: string, status: ChatToolActivity['status']) =>
  ({ id, serverName: 'srv', toolName: 'tool', status }) as ChatToolActivity;

const approval = (requestId: string): ToolApprovalRequest => ({
  requestId,
  toolCallId: 'call-1',
  serverId: 'server-1',
  serverName: 'server',
  toolName: 'write',
  argumentsPreview: '{}',
  risk: { level: 'high', reasons: ['未知风险'], requiresApproval: true },
});

describe('sendPhaseReducer', () => {
  it('start：进入带 runId 的 preparing 并清空工具活动', () => {
    expect(sendPhaseReducer(IDLE_PHASE, { type: 'start', runId: RUN_A })).toEqual({
      status: 'preparing',
      runId: RUN_A,
      toolActivities: [],
    });
  });

  it('stream-start：携带 refs 进入 streaming', () => {
    const preparing = sendPhaseReducer(IDLE_PHASE, {
      type: 'start',
      runId: RUN_A,
    });
    const refs = [{ citation: 'S1', sourceId: 'a', title: 't', url: 'u' }];
    expect(
      sendPhaseReducer(preparing, {
        type: 'stream-start',
        runId: RUN_A,
        refs,
      }),
    ).toEqual({
      status: 'streaming',
      runId: RUN_A,
      text: '',
      refs,
      toolActivities: [],
    });
  });

  it('stream-start 保留准备期间的工具活动', () => {
    let state = sendPhaseReducer(IDLE_PHASE, {
      type: 'start',
      runId: RUN_A,
    });
    state = sendPhaseReducer(state, {
      type: 'tool-activity',
      runId: RUN_A,
      activity: activity('a1', 'running'),
    });
    state = sendPhaseReducer(state, {
      type: 'stream-start',
      runId: RUN_A,
    });
    expect(state.status).toBe('streaming');
    expect(
      (state as Extract<SendPhase, { status: 'streaming' }>).toolActivities,
    ).toHaveLength(1);
  });

  it('chunk 整段覆盖文本，同 id 工具活动执行更新', () => {
    let state = sendPhaseReducer(IDLE_PHASE, {
      type: 'start',
      runId: RUN_A,
    });
    state = sendPhaseReducer(state, {
      type: 'stream-start',
      runId: RUN_A,
    });
    state = sendPhaseReducer(state, {
      type: 'chunk',
      runId: RUN_A,
      text: '你好',
    });
    state = sendPhaseReducer(state, {
      type: 'tool-activity',
      runId: RUN_A,
      activity: activity('a1', 'running'),
    });
    state = sendPhaseReducer(state, {
      type: 'tool-activity',
      runId: RUN_A,
      activity: activity('a1', 'success'),
    });
    const streaming = state as Extract<SendPhase, { status: 'streaming' }>;
    expect(streaming.text).toBe('你好');
    expect(streaming.toolActivities).toEqual([
      expect.objectContaining({ id: 'a1', status: 'success' }),
    ]);
  });

  it('旧 run 的 chunk、活动、审批和 finish 都不能污染新 run', () => {
    let state = sendPhaseReducer(IDLE_PHASE, {
      type: 'start',
      runId: RUN_A,
    });
    state = sendPhaseReducer(state, {
      type: 'approval-requested',
      runId: RUN_A,
      request: approval('request-a'),
    });
    state = sendPhaseReducer(state, { type: 'start', runId: RUN_B });
    const current = state;

    state = sendPhaseReducer(state, {
      type: 'chunk',
      runId: RUN_A,
      text: '迟到内容',
    });
    state = sendPhaseReducer(state, {
      type: 'tool-activity',
      runId: RUN_A,
      activity: activity('late', 'success'),
    });
    state = sendPhaseReducer(state, {
      type: 'approval-requested',
      runId: RUN_A,
      request: approval('late-request'),
    });
    state = sendPhaseReducer(state, { type: 'finish', runId: RUN_A });

    expect(state).toBe(current);
    expect(state).toEqual({
      status: 'preparing',
      runId: RUN_B,
      toolActivities: [],
    });
  });

  it('idle 和不匹配 run 忽略迟到回调，reset 无条件回 idle', () => {
    expect(
      sendPhaseReducer(IDLE_PHASE, {
        type: 'chunk',
        runId: RUN_A,
        text: 'x',
      }),
    ).toBe(IDLE_PHASE);

    const preparing = sendPhaseReducer(IDLE_PHASE, {
      type: 'start',
      runId: RUN_A,
    });
    expect(sendPhaseReducer(preparing, { type: 'stream-start', runId: RUN_B })).toBe(
      preparing,
    );
    expect(sendPhaseReducer(preparing, { type: 'reset' })).toBe(IDLE_PHASE);
  });
});
