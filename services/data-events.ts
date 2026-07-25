import { browser } from 'wxt/browser';

/** 数据变更实体类型 */
export type DataEntity = 'clips' | 'chats';

const MESSAGE_TYPE = 'pagetrove:data-changed';

interface DataChangedMessage {
  type: typeof MESSAGE_TYPE;
  entity: DataEntity;
}

type Listener = () => void;

/** 同一页面内的监听器集合 */
const localListeners: Record<DataEntity, Set<Listener>> = {
  clips: new Set(),
  chats: new Set(),
};

function isDataChangedMessage(message: unknown): message is DataChangedMessage {
  return (
    typeof message === 'object' &&
    message !== null &&
    (message as Record<string, unknown>).type === MESSAGE_TYPE &&
    ((message as Record<string, unknown>).entity === 'clips' ||
      (message as Record<string, unknown>).entity === 'chats')
  );
}

let runtimeListenerRegistered = false;

function ensureRuntimeListener(): void {
  if (runtimeListenerRegistered) return;
  runtimeListenerRegistered = true;
  browser.runtime.onMessage.addListener((message: unknown) => {
    if (!isDataChangedMessage(message)) return;
    for (const listener of localListeners[message.entity]) {
      listener();
    }
  });
}

/** 通知本页面及其他扩展页面：某类数据已变更。必须在写入事务成功后调用。 */
export function emitDataChanged(entity: DataEntity): void {
  // 同页面监听器直接触发
  for (const listener of localListeners[entity]) {
    listener();
  }
  // 跨扩展页面广播；没有接收者时静默忽略
  const message: DataChangedMessage = { type: MESSAGE_TYPE, entity };
  browser.runtime.sendMessage(message).catch(() => {});
}

/** 订阅数据变更，返回取消订阅函数。 */
export function onDataChanged(
  entity: DataEntity,
  callback: Listener,
): () => void {
  ensureRuntimeListener();
  localListeners[entity].add(callback);
  return () => {
    localListeners[entity].delete(callback);
  };
}
