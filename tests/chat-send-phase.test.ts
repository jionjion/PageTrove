import { describe, expect, it } from 'vitest';
import {
  IDLE_PHASE,
  type SendPhase,
  sendPhaseReducer,
} from '@/services/chat-send-phase';
import type { ChatToolActivity } from '@/services/ai/provider';

const activity = (id: string, status: ChatToolActivity['status']) =>
  ({ id, serverName: 'srv', toolName: 'tool', status }) as ChatToolActivity;

describe('sendPhaseReducer', () => {
  it('start:进入 preparing 并清空工具活动', () => {
    expect(sendPhaseReducer(IDLE_PHASE, { type: 'start' })).toEqual({
      status: 'preparing',
      toolActivities: [],
    });
  });

  it('stream-start:携带 refs 进入 streaming,text 为空串', () => {
    const preparing = sendPhaseReducer(IDLE_PHASE, { type: 'start' });
    const refs = [{ citation: 'S1', sourceId: 'a', title: 't', url: 'u' }];
    expect(sendPhaseReducer(preparing, { type: 'stream-start', refs })).toEqual({
      status: 'streaming',
      text: '',
      refs,
      toolActivities: [],
    });
  });

  it('stream-start 保留 preparing 期间的工具活动', () => {
    let state = sendPhaseReducer(IDLE_PHASE, { type: 'start' });
    state = sendPhaseReducer(state, {
      type: 'tool-activity',
      activity: activity('a1', 'running'),
    });
    state = sendPhaseReducer(state, { type: 'stream-start' });
    expect(state.status).toBe('streaming');
    expect((state as Extract<SendPhase, { status: 'streaming' }>).toolActivities).toHaveLength(1);
  });

  it('chunk:整段覆盖文本', () => {
    let state = sendPhaseReducer(IDLE_PHASE, { type: 'start' });
    state = sendPhaseReducer(state, { type: 'stream-start' });
    state = sendPhaseReducer(state, { type: 'chunk', text: '你好' });
    state = sendPhaseReducer(state, { type: 'chunk', text: '你好,世界' });
    expect((state as Extract<SendPhase, { status: 'streaming' }>).text).toBe(
      '你好,世界',
    );
  });

  it('idle 收到 chunk 不变(abort 后迟到回调守卫)', () => {
    expect(sendPhaseReducer(IDLE_PHASE, { type: 'chunk', text: 'x' })).toBe(
      IDLE_PHASE,
    );
  });

  it('preparing 收到 chunk 不变', () => {
    const preparing = sendPhaseReducer(IDLE_PHASE, { type: 'start' });
    expect(sendPhaseReducer(preparing, { type: 'chunk', text: 'x' })).toBe(
      preparing,
    );
  });

  it('tool-activity:同 id 更新,新 id 追加', () => {
    let state = sendPhaseReducer(IDLE_PHASE, { type: 'start' });
    state = sendPhaseReducer(state, {
      type: 'tool-activity',
      activity: activity('a1', 'running'),
    });
    state = sendPhaseReducer(state, {
      type: 'tool-activity',
      activity: activity('a2', 'running'),
    });
    state = sendPhaseReducer(state, {
      type: 'tool-activity',
      activity: activity('a1', 'success'),
    });
    const activities = (
      state as Extract<SendPhase, { status: 'preparing' }>
    ).toolActivities;
    expect(activities).toHaveLength(2);
    expect(activities[0]).toMatchObject({ id: 'a1', status: 'success' });
  });

  it('idle 收到 tool-activity 不变', () => {
    expect(
      sendPhaseReducer(IDLE_PHASE, {
        type: 'tool-activity',
        activity: activity('a1', 'running'),
      }),
    ).toBe(IDLE_PHASE);
  });

  it('finish:任何态回到 idle,幂等', () => {
    let state = sendPhaseReducer(IDLE_PHASE, { type: 'start' });
    state = sendPhaseReducer(state, { type: 'stream-start' });
    state = sendPhaseReducer(state, { type: 'finish' });
    expect(state).toBe(IDLE_PHASE);
    expect(sendPhaseReducer(state, { type: 'finish' })).toBe(IDLE_PHASE);
  });

  it('idle 收到 stream-start 不变(finish 后迟到守卫)', () => {
    expect(sendPhaseReducer(IDLE_PHASE, { type: 'stream-start' })).toBe(
      IDLE_PHASE,
    );
  });
});
