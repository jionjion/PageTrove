import { browser } from 'wxt/browser';
import {
  DEFAULT_SHORTCUTS,
  type ShortcutAction,
  type ShortcutMap,
} from '@/types/shortcuts';
import {
  comboFromEvent,
  DoubleTapDetector,
  matchShortcutCombo,
  matchShortcutDouble,
  SHORTCUT_MESSAGE_TYPE,
  type ShortcutMessage,
} from '@/services/shortcuts';
import { decodeSettings, getSettings } from '@/services/settings-store';

/**
 * 网页内快捷键监听:自定义键位(含双击修饰键)由拾页自己识别,
 * 命中后发消息给 background 执行。只注入顶层 frame,不干扰 iframe。
 */
export default defineContentScript({
  matches: ['<all_urls>'],
  runAt: 'document_idle',
  main() {
    if (window.top !== window) return;

    let shortcuts: ShortcutMap = DEFAULT_SHORTCUTS;
    void getSettings()
      .then((settings) => {
        shortcuts = settings.shortcuts;
      })
      .catch(() => {});

    // 设置页改键后即时生效,无需刷新页面
    const onStorageChanged = (
      changes: Record<string, Browser.storage.StorageChange>,
      areaName: string,
    ) => {
      if (areaName !== 'local' || !changes.settings) return;
      shortcuts = decodeSettings(changes.settings.newValue).shortcuts;
    };
    browser.storage.onChanged.addListener(onStorageChanged);

    const detector = new DoubleTapDetector();
    const send = (action: ShortcutAction) => {
      // 同步发送:keydown/keyup 的用户手势会随消息传递,
      // background 得以在回调中同步调用 sidePanel.open。
      void browser.runtime
        .sendMessage({ type: SHORTCUT_MESSAGE_TYPE, action } satisfies ShortcutMessage)
        .catch(() => {});
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.repeat) return;
      const combo = comboFromEvent(event);
      if (combo) {
        const action = matchShortcutCombo(shortcuts, combo);
        if (action) {
          event.preventDefault();
          event.stopPropagation();
          send(action);
          return;
        }
      }
      detector.keydown(event.key);
    };

    const onKeyUp = (event: KeyboardEvent) => {
      const fired = detector.keyup(event.key);
      if (!fired) return;
      const action = matchShortcutDouble(shortcuts, fired);
      if (action) {
        event.preventDefault();
        event.stopPropagation();
        send(action);
      }
    };

    const onBlur = () => detector.reset();

    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('keyup', onKeyUp, true);
    window.addEventListener('blur', onBlur);

    return () => {
      browser.storage.onChanged.removeListener(onStorageChanged);
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('keyup', onKeyUp, true);
      window.removeEventListener('blur', onBlur);
    };
  },
});
