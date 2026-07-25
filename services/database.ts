import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { ClipIndexEntry, WebClip } from '@/types/clip';
import type { ChatIndexEntry, ChatSession } from '@/types/chat';
import { AppError } from '@/utils/errors';

export const DB_NAME = 'pagetrove';
export const DB_VERSION = 1;

interface MetaRecord {
  key: string;
  value: unknown;
  updatedAt: string;
}

export interface PageTroveDatabase extends DBSchema {
  meta: {
    key: string;
    value: MetaRecord;
  };
  clips: {
    key: string;
    value: WebClip;
  };
  clipEntries: {
    key: string;
    value: ClipIndexEntry;
    indexes: {
      normalizedUrl: string;
      createdAt: string;
    };
  };
  chats: {
    key: string;
    value: ChatSession;
  };
  chatEntries: {
    key: string;
    value: ChatIndexEntry;
    indexes: {
      updatedAt: string;
    };
  };
}

export type PageTroveDB = IDBPDatabase<PageTroveDatabase>;

/** 将 IndexedDB 原始异常映射为用户可理解的应用错误；不泄露原始堆栈与数据内容。 */
export function mapDatabaseError(error: unknown): AppError {
  if (error instanceof AppError) return error;
  if (error instanceof DOMException) {
    switch (error.name) {
      case 'ConstraintError':
        return new AppError('DUPLICATE_CLIP');
      case 'QuotaExceededError':
        return new AppError('STORAGE_FULL');
      case 'VersionError':
        return new AppError('DB_VERSION_MISMATCH');
      case 'AbortError':
        return new AppError('SAVE_FAILED');
      case 'InvalidStateError':
        return new AppError('DB_OPEN_FAILED', '数据库连接已失效，请重试');
      default:
        return new AppError('DB_OPEN_FAILED', '数据库访问失败，请重试');
    }
  }
  return new AppError('DB_OPEN_FAILED', '数据库访问失败，请重试');
}

let dbPromise: Promise<PageTroveDB> | undefined;

async function initMeta(db: PageTroveDB): Promise<void> {
  const now = new Date().toISOString();
  const tx = db.transaction('meta', 'readwrite');
  const existing = await tx.store.get('createdAt');
  if (!existing) {
    await tx.store.put({ key: 'schema', value: DB_VERSION, updatedAt: now });
    await tx.store.put({ key: 'createdAt', value: now, updatedAt: now });
  }
  await tx.store.put({ key: 'lastOpenedAt', value: now, updatedAt: now });
  await tx.done;
}

export function openPageTroveDatabase(): Promise<PageTroveDB> {
  if (dbPromise) return dbPromise;

  dbPromise = (async () => {
    let db: PageTroveDB;
    try {
      db = await openDB<PageTroveDatabase>(DB_NAME, DB_VERSION, {
        upgrade(database, oldVersion) {
          if (oldVersion < 1) {
            database.createObjectStore('meta', { keyPath: 'key' });
            database.createObjectStore('clips', { keyPath: 'id' });
            const clipEntries = database.createObjectStore('clipEntries', {
              keyPath: 'id',
            });
            clipEntries.createIndex('normalizedUrl', 'normalizedUrl', {
              unique: true,
            });
            clipEntries.createIndex('createdAt', 'createdAt');
            database.createObjectStore('chats', { keyPath: 'id' });
            const chatEntries = database.createObjectStore('chatEntries', {
              keyPath: 'id',
            });
            chatEntries.createIndex('updatedAt', 'updatedAt');
          }
        },
        blocked() {
          // 其他页面持有旧版本连接，本次打开被阻塞。
          // 打开 Promise 仍会在对方关闭后完成；这里不抛错，仅在长期阻塞时由用户重试。
        },
        blocking() {
          // 其他上下文正在升级到更新版本，主动让出连接。
          db?.close();
          dbPromise = undefined;
        },
        terminated() {
          // 浏览器异常终止连接，下次操作重新打开。
          dbPromise = undefined;
        },
      });
    } catch (error) {
      dbPromise = undefined;
      if (error instanceof DOMException && error.name === 'VersionError') {
        throw new AppError('DB_VERSION_MISMATCH');
      }
      throw new AppError('DB_OPEN_FAILED');
    }

    try {
      await initMeta(db);
    } catch {
      // meta 仅用于诊断，写入失败不阻断数据操作。
    }
    return db;
  })();

  return dbPromise;
}

export async function closePageTroveDatabase(): Promise<void> {
  const promise = dbPromise;
  dbPromise = undefined;
  if (!promise) return;
  try {
    (await promise).close();
  } catch {
    // 已经关闭或打开失败，无需处理。
  }
}
