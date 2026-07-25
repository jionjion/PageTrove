import { enqueueQuoteIntent } from '@/services/chat-intent-store';

const MENU_ID = 'pagetrove-ask-selection';

export default defineBackground(() => {
  // 点击扩展图标时打开侧边栏
  browser.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch((error: unknown) => {
      console.error('设置侧边栏失败：', error);
    });

  // 注册右键菜单：选中文字后"向拾页提问"
  browser.runtime.onInstalled.addListener(() => {
    browser.contextMenus.removeAll(() => {
      browser.contextMenus.create({
        id: MENU_ID,
        title: '向拾页提问："%s"',
        contexts: ['selection'],
      });
    });
  });

  browser.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId !== MENU_ID) return;
    const selection = info.selectionText?.trim();
    if (!selection || !tab?.id) return;

    // 同步并发发起：sidePanel.open 依赖用户手势，不能等待其他 Promise。
    void enqueueQuoteIntent({
      tabId: tab.id,
      title: tab.title ?? '',
      url: info.pageUrl ?? tab.url ?? '',
      text: selection,
    }).catch((error: unknown) => {
      console.error('保存引用意图失败：', error);
    });
    browser.sidePanel.open({ tabId: tab.id }).catch((error: unknown) => {
      console.error('打开侧边栏失败：', error);
    });
  });
});
