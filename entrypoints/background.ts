import { browser, type Browser } from 'wxt/browser';
import {
  enqueueQuoteIntent,
  isTakeIntentMessage,
  takeNextQuoteIntent,
} from '@/services/chat-intent-store';
import { registerSettingsPatchWriter } from '@/services/settings-store';
import { isShortcutMessage } from '@/services/shortcuts';
import { SHORTCUT_VIEW_MAP, type ShortcutAction } from '@/types/shortcuts';
import { enqueueShortcutIntent } from '@/services/shortcut-intent-store';
import { runQuickSave } from '@/services/quick-save';

const MENU_ID = 'pagetrove-ask-selection';
const OPEN_PANEL_COMMAND = 'open-panel';

function openPanelForTab(tabId: number): void {
  browser.sidePanel.open({ tabId }).catch((error: unknown) => {
    console.error('打开侧边栏失败：', error);
  });
}

/** 需要侧边栏承载的动作;open-panel 本身只开面板,无后续意图。 */
function shortcutNeedsPanel(action: ShortcutAction): boolean {
  return (
    action === 'open-panel' ||
    action === 'new-chat' ||
    SHORTCUT_VIEW_MAP[action] !== undefined
  );
}

function handleShortcutAction(action: ShortcutAction, tabId?: number): void {
  if (action === 'quick-save') {
    void runQuickSave(tabId);
    return;
  }
  if (action === 'open-settings') {
    void browser.runtime.openOptionsPage();
    return;
  }
  if (action === 'new-chat') {
    void enqueueShortcutIntent({ view: 'chat', newChat: true });
    return;
  }
  const view = SHORTCUT_VIEW_MAP[action];
  if (view) void enqueueShortcutIntent({ view });
}

export default defineBackground(() => {
  registerSettingsPatchWriter();
  browser.runtime.onMessage.addListener((message: unknown, sender) => {
    if (isTakeIntentMessage(message)) return takeNextQuoteIntent();
    if (isShortcutMessage(message)) {
      const tabId = sender.tab?.id;
      // 同步调用 sidePanel.open:内容脚本按键的用户手势随消息传递,
      // 任何 await 都会让手势失效,因此开面板必须先于异步动作。
      if (shortcutNeedsPanel(message.action) && typeof tabId === 'number') {
        openPanelForTab(tabId);
      }
      handleShortcutAction(message.action, tabId);
      return;
    }
  });

  // 点击扩展图标时打开侧边栏
  browser.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch((error: unknown) => {
      console.error('设置侧边栏失败：', error);
    });

  // 浏览器级备用快捷键(manifest.commands):内容脚本无法注入的页面也能开面板。
  // 默认的「双击 Alt」由内容脚本监听,不占用 command 键位。
  browser.commands.onCommand.addListener((command: string, tab?: Browser.tabs.Tab) => {
    if (command !== OPEN_PANEL_COMMAND) return;
    if (typeof tab?.id === 'number') {
      openPanelForTab(tab.id);
      return;
    }
    void browser.tabs
      .query({ active: true, currentWindow: true })
      .then(([active]) => {
        if (typeof active?.id === 'number') openPanelForTab(active.id);
      })
      .catch((error: unknown) => {
        console.error('查询当前标签页失败：', error);
      });
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
    openPanelForTab(tab.id);
  });
});
