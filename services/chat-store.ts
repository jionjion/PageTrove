import type { ChatIndexEntry, ChatSession, ChatToolCall } from '@/types/chat';
import type { ToolExecutionRecordResult } from '@/services/ai/provider';
import { mapDatabaseError, openPageTroveDatabase } from '@/services/database';
import { emitDataChanged } from '@/services/data-events';
import { AppError } from '@/utils/errors';

function toIndexEntry(session: ChatSession): ChatIndexEntry {
  return {
    id: session.id,
    title: session.title,
    clipId: session.clipId,
    url: session.page?.url,
    messageCount: session.messages.length,
    updatedAt: session.updatedAt,
  };
}

export interface ChatWriteVersion {
  updatedAt: string;
  revision?: string;
}

const MAX_TOOL_EXECUTIONS = 200;
export const TOOL_EXECUTION_CLAIM_LEASE_MS = 5 * 60_000;

function isIsoTimestamp(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(value)) return false;
  return Number.isFinite(Date.parse(value));
}

/** 只有租约窗口内的 claimed 才可能仍在执行远端副作用。 */
export function isActiveToolExecutionClaim(
  execution: ChatToolCall,
  now = Date.now(),
): boolean {
  if (
    execution.status !== 'unknown' ||
    execution.phase !== 'claimed' ||
    !isIsoTimestamp(execution.claimedAt)
  ) {
    return false;
  }
  const age = now - Date.parse(execution.claimedAt);
  return age >= -TOOL_EXECUTION_CLAIM_LEASE_MS && age < TOOL_EXECUTION_CLAIM_LEASE_MS;
}

function matchesExpected(
  existing: ChatSession | undefined,
  expected: string | ChatWriteVersion | null,
): boolean {
  return expected === null
    ? existing === undefined
    : typeof expected === 'string'
      ? existing?.updatedAt === expected
      : existing?.updatedAt === expected.updatedAt &&
        existing.revision === expected.revision;
}

export async function getChatIndex(): Promise<ChatIndexEntry[]> {
  const db = await openPageTroveDatabase();
  let entries: ChatIndexEntry[];
  try {
    entries = await db.getAll('chatEntries');
  } catch (error) {
    throw mapDatabaseError(error);
  }
  return [...entries].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function getChat(id: string): Promise<ChatSession | undefined> {
  const db = await openPageTroveDatabase();
  try {
    return await db.get('chats', id);
  } catch (error) {
    throw mapDatabaseError(error);
  }
}

/** 新建或更新会话；详情与轻量索引在同一事务中写入。 */
export async function saveChat(
  session: ChatSession,
  expected?: string | ChatWriteVersion | null,
  signal?: AbortSignal,
): Promise<void> {
  const db = await openPageTroveDatabase();
  signal?.throwIfAborted();
  const tx = db.transaction(['chats', 'chatEntries'], 'readwrite');
  const onAbort = () => {
    try {
      tx.abort();
    } catch {
      // 事务已经提交或中止时无需再次处理。
    }
  };
  signal?.addEventListener('abort', onAbort, { once: true });
  try {
    let sessionToStore = session;
    if (expected !== undefined) {
      const existing = await tx.objectStore('chats').get(session.id);
      if (!matchesExpected(existing, expected)) {
        tx.abort();
        await tx.done.catch(() => undefined);
        throw new AppError('WRITE_CONFLICT');
      }
      // 消息写入不得用读取时的 in-doubt journal 覆盖已收敛的 entry-CAS 终态。
      if (existing?.toolExecutions) {
        sessionToStore = { ...session, toolExecutions: existing.toolExecutions };
      }
    }
    signal?.throwIfAborted();
    await tx.objectStore('chats').put(sessionToStore);
    await tx.objectStore('chatEntries').put(toIndexEntry(sessionToStore));
    await tx.done;
  } catch (error) {
    if (signal?.aborted) {
      throw signal.reason ?? new DOMException('请求已取消', 'AbortError');
    }
    if (error instanceof AppError) throw error;
    throw mapDatabaseError(error);
  } finally {
    signal?.removeEventListener('abort', onAbort);
  }
  emitDataChanged('chats');
}

/**
 * 以乐观并发令牌原子追加/更新 MCP 执行记录。
 * 同 id 的 unknown 会被最终状态覆盖；不会保存参数或远端结果。
 */
export async function recordChatToolExecution(
  sessionId: string,
  execution: ChatToolCall,
  expected?: ChatWriteVersion,
): Promise<ToolExecutionRecordResult & { session: ChatSession }> {
  const isClaim = execution.status === 'unknown' && execution.phase === 'claimed';
  const isInDoubt = execution.status === 'unknown' && execution.phase === 'in-doubt';
  if (
    (execution.status === 'unknown' && !isClaim && !isInDoubt) ||
    (execution.status !== 'unknown' && execution.phase !== undefined) ||
    !execution.operationKey ||
    !execution.turnId ||
    (execution.claimedAt !== undefined && !isIsoTimestamp(execution.claimedAt)) ||
    (isClaim && !isIsoTimestamp(execution.claimedAt))
  ) {
    throw new AppError('SAVE_FAILED', '工具执行审计标识不完整，工具未执行');
  }
  const db = await openPageTroveDatabase();
  const tx = db.transaction(['chats', 'chatEntries'], 'readwrite');
  try {
    const store = tx.objectStore('chats');
    const existing = await store.get(sessionId);
    if (!existing) {
      tx.abort();
      await tx.done.catch(() => undefined);
      throw new AppError('WRITE_CONFLICT');
    }

    const executions = [...(existing.toolExecutions ?? [])];
    const existingIndex = executions.findIndex((item) => item.id === execution.id);
    if (isClaim) {
      const prior = executions.find(
        (item) => item.operationKey === execution.operationKey,
      );
      if (prior?.status === 'success' || prior?.status === 'unknown') {
        await tx.done;
        return {
          kind: prior.status === 'success' ? 'already-success' : 'blocked-unknown',
          execution: prior,
          session: existing,
        };
      }
      if (!expected || !matchesExpected(existing, expected)) {
        tx.abort();
        await tx.done.catch(() => undefined);
        throw new AppError('WRITE_CONFLICT');
      }
    } else {
      const prior = existingIndex >= 0 ? executions[existingIndex] : undefined;
      if (
        !prior ||
        prior.status !== 'unknown' ||
        prior.phase !== 'claimed' ||
        !prior.operationKey ||
        !prior.turnId ||
        execution.operationKey !== prior.operationKey ||
        execution.turnId !== prior.turnId
      ) {
        tx.abort();
        await tx.done.catch(() => undefined);
        throw new AppError('SAVE_FAILED', '工具执行审计状态无效');
      }
      execution = {
        ...execution,
        operationKey: prior.operationKey,
        turnId: prior.turnId,
        claimedAt: prior.claimedAt,
      };
    }
    if (existingIndex < 0 && executions.length >= MAX_TOOL_EXECUTIONS) {
      tx.abort();
      await tx.done.catch(() => undefined);
      throw new AppError(
        'SAVE_FAILED',
        '当前会话的工具执行审计已达上限，请新建会话后继续',
      );
    }
    if (existingIndex >= 0) executions[existingIndex] = execution;
    else executions.push(execution);
    const updated: ChatSession = {
      ...existing,
      toolExecutions: executions,
      // claim 参与消息 CAS；terminal 只做 entry-CAS，不改变内容令牌。
      revision: isClaim ? crypto.randomUUID() : existing.revision,
      updatedAt: isClaim ? new Date().toISOString() : existing.updatedAt,
    };
    await store.put(updated);
    await tx.objectStore('chatEntries').put(toIndexEntry(updated));
    await tx.done;
    emitDataChanged('chats');
    return { kind: 'recorded', execution, session: updated };
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw mapDatabaseError(error);
  }
}

export async function removeChat(id: string): Promise<void> {
  const db = await openPageTroveDatabase();
  try {
    const tx = db.transaction(['chats', 'chatEntries'], 'readwrite');
    const existing = await tx.objectStore('chats').get(id);
    if (existing?.toolExecutions?.some((item) => isActiveToolExecutionClaim(item))) {
      tx.abort();
      await tx.done.catch(() => undefined);
      throw new AppError(
        'SAVE_FAILED',
        '工具正在执行，请等待执行完成或五分钟租约到期后再删除会话',
      );
    }
    await tx.objectStore('chats').delete(id);
    await tx.objectStore('chatEntries').delete(id);
    await tx.done;
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw mapDatabaseError(error);
  }
  emitDataChanged('chats');
}
