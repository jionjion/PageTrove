import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing';
import { closePageTroveDatabase, openPageTroveDatabase } from '@/services/database';
import {
  countChatMessagesByLocalDay,
  getChat,
  recordChatToolExecution,
  removeChat,
  saveChat,
  TOOL_EXECUTION_CLAIM_LEASE_MS,
} from '@/services/chat-store';
import type { ChatSession } from '@/types/chat';
import { AppError } from '@/utils/errors';

function makeChat(overrides: Partial<ChatSession> = {}): ChatSession {
  const now = new Date().toISOString();
  return {
    id: 'chat-1',
    revision: 'revision-a',
    title: '测试会话',
    messages: [{ role: 'user', content: '第一版', createdAt: now }],
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

beforeEach(async () => {
  fakeBrowser.reset();
  await closePageTroveDatabase();
  globalThis.indexedDB = new IDBFactory();
});

afterEach(async () => {
  await closePageTroveDatabase();
});

describe('saveChat 乐观并发', () => {
  it('create 前置条件要求记录不存在', async () => {
    const original = makeChat();
    await saveChat(original, null);

    await expect(saveChat(makeChat({ revision: 'other' }), null)).rejects.toMatchObject({
      code: 'WRITE_CONFLICT',
    } satisfies Partial<AppError>);
    expect(await getChat(original.id)).toEqual(original);
  });

  it('revision 匹配时更新，迟到写入失败且不能覆盖新版本', async () => {
    const original = makeChat();
    await saveChat(original, null);

    const current = makeChat({
      revision: 'revision-b',
      title: '新版本',
      updatedAt: new Date(Date.now() + 1_000).toISOString(),
    });
    await saveChat(current, {
      updatedAt: original.updatedAt,
      revision: original.revision,
    });

    const stale = makeChat({
      revision: 'revision-stale',
      title: '迟到版本',
      updatedAt: new Date(Date.now() + 2_000).toISOString(),
    });
    await expect(
      saveChat(stale, {
        updatedAt: original.updatedAt,
        revision: original.revision,
      }),
    ).rejects.toMatchObject({ code: 'WRITE_CONFLICT' } satisfies Partial<AppError>);
    expect(await getChat(original.id)).toEqual(current);
  });

  it('已取消的写入不会进入事务', async () => {
    const controller = new AbortController();
    controller.abort(new DOMException('用户取消', 'AbortError'));

    await expect(saveChat(makeChat(), null, controller.signal)).rejects.toMatchObject({
      name: 'AbortError',
    });
    const db = await openPageTroveDatabase();
    expect(await db.count('chats')).toBe(0);
    expect(await db.count('chatEntries')).toBe(0);
  });

  it('原子记录工具 unknown 状态并用终态覆盖', async () => {
    const original = makeChat();
    await saveChat(original, null);

    const startedRecord = await recordChatToolExecution(
      original.id,
      {
        id: 'execution-1',
        serverName: '测试 MCP',
        toolName: 'create_item',
        status: 'unknown',
        phase: 'claimed',
        claimedAt: new Date().toISOString(),
        operationKey: `sha256-v1:${'a'.repeat(64)}`,
        turnId: 'turn-1',
        summary: '结果尚未确认',
      },
      { updatedAt: original.updatedAt, revision: original.revision },
    );
    const started = startedRecord.session;
    expect(startedRecord.kind).toBe('recorded');
    expect(started.toolExecutions).toEqual([
      expect.objectContaining({ id: 'execution-1', status: 'unknown' }),
    ]);
    expect(started.revision).not.toBe(original.revision);

    await expect(
      recordChatToolExecution(original.id, {
        ...startedRecord.execution,
        status: 'success',
        phase: undefined,
        operationKey: `sha256-v1:${'9'.repeat(64)}`,
      }),
    ).rejects.toMatchObject({ code: 'SAVE_FAILED' });

    const completedRecord = await recordChatToolExecution(original.id, {
      ...startedRecord.execution,
      status: 'success',
      phase: undefined,
      summary: '调用成功',
    });
    const completed = completedRecord.session;
    expect(completed.toolExecutions).toEqual([
      expect.objectContaining({ id: 'execution-1', status: 'success' }),
    ]);

    await expect(
      recordChatToolExecution(
        original.id,
        {
          id: 'execution-2',
          serverName: '测试 MCP',
          toolName: 'delete_item',
          status: 'unknown',
          phase: 'claimed',
          claimedAt: new Date().toISOString(),
          operationKey: `sha256-v1:${'b'.repeat(64)}`,
          turnId: 'turn-1',
        },
        { updatedAt: original.updatedAt, revision: original.revision },
      ),
    ).rejects.toMatchObject({ code: 'WRITE_CONFLICT' });
    expect(await getChat(original.id)).toEqual(completed);
  });

  it('相同操作指纹已成功或结果未知时不创建新执行', async () => {
    const original = makeChat();
    await saveChat(original, null);
    const operationKey = `sha256-v1:${'a'.repeat(64)}`;
    const first = await recordChatToolExecution(
      original.id,
      {
        id: 'execution-1',
        serverName: '测试 MCP',
        toolName: 'create_item',
        status: 'unknown',
        phase: 'claimed',
        claimedAt: new Date().toISOString(),
        operationKey,
        turnId: 'turn-1',
      },
      { updatedAt: original.updatedAt, revision: original.revision },
    );

    const blocked = await recordChatToolExecution(
      original.id,
      {
        id: 'execution-2',
        serverName: '测试 MCP',
        toolName: 'create_item',
        status: 'unknown',
        phase: 'claimed',
        claimedAt: new Date().toISOString(),
        operationKey,
        turnId: 'turn-1',
      },
      { updatedAt: original.updatedAt, revision: original.revision },
    );
    expect(blocked.kind).toBe('blocked-unknown');
    expect(blocked.execution.id).toBe('execution-1');
    expect(blocked.session.toolExecutions).toHaveLength(1);

    const success = await recordChatToolExecution(
      original.id,
      { ...first.execution, status: 'success', phase: undefined },
      {
        updatedAt: first.session.updatedAt,
        revision: first.session.revision,
      },
    );
    const reused = await recordChatToolExecution(
      original.id,
      {
        id: 'execution-3',
        serverName: '测试 MCP',
        toolName: 'create_item',
        status: 'unknown',
        phase: 'claimed',
        claimedAt: new Date().toISOString(),
        operationKey,
        turnId: 'turn-1',
      },
      {
        updatedAt: success.session.updatedAt,
        revision: success.session.revision,
      },
    );
    expect(reused.kind).toBe('already-success');
    expect(reused.execution.id).toBe('execution-1');
    expect(reused.session.toolExecutions).toHaveLength(1);
  });

  it('审计达上限时 fail closed，不丢弃旧记录', async () => {
    const original = makeChat({
      toolExecutions: Array.from({ length: 200 }, (_, index) => ({
        id: `execution-${index}`,
        serverName: '测试 MCP',
        toolName: 'create_item',
        status: 'success' as const,
        operationKey: `sha256-v1:${index.toString(16).padStart(64, '0')}`,
        turnId: 'turn-1',
      })),
    });
    await saveChat(original, null);

    await expect(
      recordChatToolExecution(
        original.id,
        {
          id: 'execution-overflow',
          serverName: '测试 MCP',
          toolName: 'create_item',
          status: 'unknown',
          phase: 'claimed',
          claimedAt: new Date().toISOString(),
          operationKey: `sha256-v1:${'f'.repeat(64)}`,
          turnId: 'turn-1',
        },
        { updatedAt: original.updatedAt, revision: original.revision },
      ),
    ).rejects.toMatchObject({
      code: 'SAVE_FAILED',
      message: expect.stringContaining('审计已达上限'),
    });
    expect((await getChat(original.id))?.toolExecutions).toHaveLength(200);
  });

  it('结果未知的工具执行存在时禁止删除会话', async () => {
    const original = makeChat({
      toolExecutions: [
        {
          id: 'execution-running',
          serverName: '测试 MCP',
          toolName: 'create_item',
          status: 'unknown',
          phase: 'claimed',
          claimedAt: new Date().toISOString(),
          operationKey: `sha256-v1:${'c'.repeat(64)}`,
          turnId: 'turn-1',
        },
      ],
    });
    await saveChat(original, null);

    await expect(removeChat(original.id)).rejects.toMatchObject({
      code: 'SAVE_FAILED',
      message: expect.stringContaining('正在执行'),
    });
    expect(await getChat(original.id)).toEqual(original);

    const settled = await recordChatToolExecution(original.id, {
      ...original.toolExecutions![0],
      status: 'success',
      phase: undefined,
    });
    await expect(removeChat(original.id)).resolves.toBeUndefined();
    expect(settled.session.toolExecutions?.[0].status).toBe('success');
    expect(await getChat(original.id)).toBeUndefined();
  });

  it('只阻止租约内 claimed，过期 claim 允许删除', async () => {
    const expired = makeChat({
      id: 'expired-claim-chat',
      toolExecutions: [
        {
          id: 'execution-expired',
          serverName: '测试 MCP',
          toolName: 'create_item',
          status: 'unknown',
          phase: 'claimed',
          claimedAt: new Date(
            Date.now() - TOOL_EXECUTION_CLAIM_LEASE_MS - 1,
          ).toISOString(),
          operationKey: `sha256-v1:${'e'.repeat(64)}`,
          turnId: 'turn-expired',
        },
      ],
    });
    await saveChat(expired, null);

    await expect(removeChat(expired.id)).resolves.toBeUndefined();
    expect(await getChat(expired.id)).toBeUndefined();
  });

  it('in-doubt terminal 按 execution entry 收敛，不受并发消息 CAS 影响', async () => {
    const original = makeChat({
      messages: [
        {
          id: 'turn-1',
          role: 'user',
          content: '执行工具',
          createdAt: '2026-08-12T00:00:00Z',
        },
      ],
    });
    await saveChat(original, null);
    const claim = await recordChatToolExecution(
      original.id,
      {
        id: 'execution-concurrent',
        serverName: '测试 MCP',
        toolName: 'create_item',
        status: 'unknown',
        phase: 'claimed',
        claimedAt: new Date().toISOString(),
        operationKey: `sha256-v1:${'1'.repeat(64)}`,
        turnId: 'turn-1',
      },
      { updatedAt: original.updatedAt, revision: original.revision },
    );
    const concurrent = {
      ...claim.session,
      revision: 'concurrent-revision',
      title: '并发更新',
      updatedAt: new Date(Date.now() + 1_000).toISOString(),
    };
    await saveChat(concurrent, {
      updatedAt: claim.session.updatedAt,
      revision: claim.session.revision,
    });

    const settled = await recordChatToolExecution(original.id, {
      ...claim.execution,
      status: 'unknown',
      phase: 'in-doubt',
    });
    expect(settled.session).toMatchObject({
      title: '并发更新',
      revision: 'concurrent-revision',
    });
    expect(settled.session.toolExecutions?.[0]).toMatchObject({
      status: 'unknown',
      phase: 'in-doubt',
      operationKey: claim.execution.operationKey,
    });
  });

  it('读到 claimed 的迟到消息写入不会覆盖已收敛 terminal', async () => {
    const original = makeChat();
    await saveChat(original, null);
    const claim = await recordChatToolExecution(
      original.id,
      {
        id: 'execution-reverse-race',
        serverName: '测试 MCP',
        toolName: 'create_item',
        status: 'unknown',
        phase: 'claimed',
        claimedAt: new Date().toISOString(),
        operationKey: `sha256-v1:${'2'.repeat(64)}`,
        turnId: 'turn-1',
      },
      { updatedAt: original.updatedAt, revision: original.revision },
    );
    const staleWithRunning = {
      ...claim.session,
      revision: 'late-message-revision',
      title: '迟到消息写入',
      updatedAt: new Date(Date.now() + 1_000).toISOString(),
    };
    await recordChatToolExecution(original.id, {
      ...claim.execution,
      status: 'success',
      phase: undefined,
    });
    await saveChat(staleWithRunning, {
      updatedAt: claim.session.updatedAt,
      revision: claim.session.revision,
    });

    const stored = await getChat(original.id);
    expect(stored?.title).toBe('迟到消息写入');
    expect(stored?.toolExecutions?.[0]).toMatchObject({
      status: 'success',
      phase: undefined,
    });
  });
});

describe('countChatMessagesByLocalDay', () => {
  it('按本地自然日统计全部会话消息，跳过无效时间', async () => {
    const day1 = new Date(2026, 2, 3, 10, 0).toISOString();
    const day1Late = new Date(2026, 2, 3, 23, 30).toISOString();
    const day2 = new Date(2026, 2, 4, 0, 30).toISOString();

    await saveChat(
      makeChat({
        id: 'day-chat-a',
        messages: [
          { role: 'user', content: '1', createdAt: day1 },
          { role: 'assistant', content: '2', createdAt: day1Late },
          { role: 'user', content: 'bad', createdAt: 'not-a-date' },
        ],
      }),
      null,
    );
    await saveChat(
      makeChat({
        id: 'day-chat-b',
        messages: [{ role: 'user', content: '3', createdAt: day2 }],
      }),
      null,
    );

    const counts = await countChatMessagesByLocalDay();
    expect(counts.get('2026-03-03')).toBe(2);
    expect(counts.get('2026-03-04')).toBe(1);
    expect(counts.size).toBe(2);
  });

  it('空库返回空 Map', async () => {
    expect((await countChatMessagesByLocalDay()).size).toBe(0);
  });
});
