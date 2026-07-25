/** 右键"向拾页提问"产生的临时意图，经 storage.session 传递给侧边栏。 */
export interface QuoteChatIntent {
  id: string;
  kind: 'quote';
  tabId: number;
  title: string;
  url: string;
  text: string;
  createdAt: string;
}
