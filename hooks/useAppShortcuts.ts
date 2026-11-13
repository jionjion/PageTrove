import { useEffect, useRef } from 'react';
import type { ShortcutAction, ShortcutMap } from '@/types/shortcuts';
import {
  comboFromEvent,
  DoubleTapDetector,
  matchShortcutCombo,
  matchShortcutDouble,
} from '@/services/shortcuts';

/**
 * 扩展页面(侧边栏)内的快捷键:焦点在面板时直接本地执行,
 * 不经过消息往返;与内容脚本共用同一套匹配规则。
 */
export function useAppShortcuts(
  shortcuts: ShortcutMap,
  onAction: (action: ShortcutAction) => void,
): void {
  const shortcutsRef = useRef(shortcuts);
  const handlerRef = useRef(onAction);
  useEffect(() => {
    shortcutsRef.current = shortcuts;
    handlerRef.current = onAction;
  });

  useEffect(() => {
    const detector = new DoubleTapDetector();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.repeat) return;
      const combo = comboFromEvent(event);
      if (combo) {
        const action = matchShortcutCombo(shortcutsRef.current, combo);
        if (action) {
          event.preventDefault();
          event.stopPropagation();
          handlerRef.current(action);
          return;
        }
      }
      detector.keydown(event.key);
    };

    const onKeyUp = (event: KeyboardEvent) => {
      const fired = detector.keyup(event.key);
      if (!fired) return;
      const action = matchShortcutDouble(shortcutsRef.current, fired);
      if (action) {
        event.preventDefault();
        event.stopPropagation();
        handlerRef.current(action);
      }
    };

    const onBlur = () => detector.reset();

    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('keyup', onKeyUp, true);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('keyup', onKeyUp, true);
      window.removeEventListener('blur', onBlur);
    };
  }, []);
}
