import type { ChatIndexEntry, ChatSession } from '@/types/chat';
import { mapDatabaseError, openPageTroveDatabase } from '@/services/database';
import { emitDataChanged } from '@/services/data-events';

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
export async function saveChat(session: ChatSession): Promise<void> {
  const db = await openPageTroveDatabase();
  try {
    const tx = db.transaction(['chats', 'chatEntries'], 'readwrite');
    await tx.objectStore('chats').put(session);
    await tx.objectStore('chatEntries').put(toIndexEntry(session));
    await tx.done;
  } catch (error) {
    throw mapDatabaseError(error);
  }
  emitDataChanged('chats');
}

export async function removeChat(id: string): Promise<void> {
  const db = await openPageTroveDatabase();
  try {
    const tx = db.transaction(['chats', 'chatEntries'], 'readwrite');
    await tx.objectStore('chats').delete(id);
    await tx.objectStore('chatEntries').delete(id);
    await tx.done;
  } catch (error) {
    throw mapDatabaseError(error);
  }
  emitDataChanged('chats');
}
