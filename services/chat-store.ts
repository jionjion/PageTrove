import { browser } from 'wxt/browser';
import type { ChatIndexEntry, ChatSession } from '@/types/chat';
import { AppError } from '@/utils/errors';

const INDEX_KEY = 'chats:index';

const chatKey = (id: string) => `chat:${id}`;

function toIndexEntry(session: ChatSession): ChatIndexEntry {
  return {
    id: session.id,
    title: session.title,
    clipId: session.clipId,
    messageCount: session.messages.length,
    updatedAt: session.updatedAt,
  };
}

export async function getChatIndex(): Promise<ChatIndexEntry[]> {
  const result = await browser.storage.local.get(INDEX_KEY);
  const index = (result[INDEX_KEY] as ChatIndexEntry[] | undefined) ?? [];
  return index.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function getChat(id: string): Promise<ChatSession | undefined> {
  const result = await browser.storage.local.get(chatKey(id));
  return result[chatKey(id)] as ChatSession | undefined;
}

/** 新建或更新会话，并同步索引 */
export async function saveChat(session: ChatSession): Promise<void> {
  try {
    await browser.storage.local.set({ [chatKey(session.id)]: session });
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (message.toLowerCase().includes('quota')) {
      throw new AppError('STORAGE_FULL');
    }
    throw new AppError('SAVE_FAILED');
  }
  const result = await browser.storage.local.get(INDEX_KEY);
  const index = (result[INDEX_KEY] as ChatIndexEntry[] | undefined) ?? [];
  await browser.storage.local.set({
    [INDEX_KEY]: [
      toIndexEntry(session),
      ...index.filter((e) => e.id !== session.id),
    ],
  });
}

export async function removeChat(id: string): Promise<void> {
  await browser.storage.local.remove(chatKey(id));
  const result = await browser.storage.local.get(INDEX_KEY);
  const index = (result[INDEX_KEY] as ChatIndexEntry[] | undefined) ?? [];
  await browser.storage.local.set({
    [INDEX_KEY]: index.filter((e) => e.id !== id),
  });
}
