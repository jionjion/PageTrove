import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button, Typography } from 'antd';
import {
  DEFAULT_SHORTCUTS,
  SHORTCUT_ACTIONS,
  type ShortcutAction,
  type ShortcutBinding,
  type ShortcutMap,
} from '@/types/shortcuts';
import {
  bindingTokens,
  cloneShortcuts,
  comboFromEvent,
  DoubleTapDetector,
  findShortcutConflict,
  isMacPlatform,
  validateBinding,
} from '@/services/shortcuts';

const ACTION_LABELS: Record<ShortcutAction, string> = {
  'open-panel': '唤起侧边栏',
  'quick-save': '一键收录',
  'new-chat': '新对话',
  'view-chat': '对话',
  'view-current': '收录',
  'view-clips': '收藏',
  'view-research': '探究',
  'view-history': '历史',
  'open-settings': '打开设置',
};

interface Props {
  value: ShortcutMap;
  onChange: (next: ShortcutMap) => void;
}

/* 与模型配置页同一套 Label / Hint 排版语言 */
const Label = ({ children }: { children: string }) => (
  <Typography.Text strong className="options-section-label">
    {children}
  </Typography.Text>
);

const Hint = ({ children }: { children: React.ReactNode }) => (
  <Typography.Paragraph type="secondary" className="options-hint">
    {children}
  </Typography.Paragraph>
);

/** 快捷键配置:沿用模型配置页的 Label → 控件 → Hint 表单节奏。 */
export function ShortcutSettings({ value, onChange }: Props) {
  const mac = useMemo(() => isMacPlatform(), []);

  const [recording, setRecording] = useState<ShortcutAction>();
  const [rowError, setRowError] = useState<{ action: ShortcutAction; message: string }>();
  const [flash, setFlash] = useState<ShortcutAction>();

  const valueRef = useRef(value);
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    valueRef.current = value;
    onChangeRef.current = onChange;
  });

  useEffect(() => {
    if (!flash) return;
    const timer = setTimeout(() => setFlash(undefined), 1_000);
    return () => clearTimeout(timer);
  }, [flash]);

  const commit = useCallback(
    (action: ShortcutAction, binding: ShortcutBinding): boolean => {
      const invalid = validateBinding(binding);
      if (invalid) {
        setRowError({ action, message: invalid });
        return false;
      }
      const conflict = findShortcutConflict(valueRef.current, action, binding);
      if (conflict) {
        setRowError({
          action,
          message: `与「${ACTION_LABELS[conflict]}」冲突，请换一个`,
        });
        return false;
      }
      setRowError(undefined);
      onChangeRef.current({ ...valueRef.current, [action]: binding });
      setRecording(undefined);
      setFlash(action);
      return true;
    },
    [],
  );

  // 录制:捕获下一次合法组合键或双击修饰键;Esc 取消
  useEffect(() => {
    if (!recording) return;
    const detector = new DoubleTapDetector();
    const onKeyDown = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();
      if (event.key === 'Escape' && !event.ctrlKey && !event.altKey && !event.metaKey) {
        setRecording(undefined);
        setRowError(undefined);
        return;
      }
      if (event.repeat) return;
      const combo = comboFromEvent(event);
      if (combo) {
        commit(recording, { kind: 'combo', keys: combo });
        return;
      }
      detector.keydown(event.key);
    };
    const onKeyUp = (event: KeyboardEvent) => {
      const fired = detector.keyup(event.key);
      if (fired) commit(recording, { kind: 'double', keys: fired });
    };
    const onBlur = () => {
      setRecording(undefined);
      setRowError(undefined);
    };
    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('keyup', onKeyUp, true);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('keyup', onKeyUp, true);
      window.removeEventListener('blur', onBlur);
    };
  }, [recording, commit]);

  const resetAll = () => {
    setRowError(undefined);
    setRecording(undefined);
    onChange(cloneShortcuts(DEFAULT_SHORTCUTS));
  };

  const renderKeycap = (action: ShortcutAction) => {
    const binding = value[action];
    const tokens = bindingTokens(binding, mac);

    if (recording === action) {
      return (
        <span className="pt-keycap pt-keycap-recording" role="status" aria-live="polite">
          按下快捷键…
        </span>
      );
    }

    return (
      <button
        type="button"
        className={[
          'pt-keycap',
          rowError?.action === action ? 'pt-keycap-error' : '',
          flash === action ? 'pt-keycap-flash' : '',
        ]
          .filter(Boolean)
          .join(' ')}
        title="点击修改快捷键"
        aria-label={`${ACTION_LABELS[action]}快捷键：${tokens.join(' + ')}${binding.kind === 'double' ? '（双击）' : ''}，点击修改`}
        onClick={() => {
          setRowError(undefined);
          setRecording(action);
        }}
      >
        <span className="pt-keycap-value">
          {binding.kind === 'double' ? (
            <>
              {tokens[0]}
              <span className="pt-keycap-double">双击</span>
            </>
          ) : (
            tokens.join(' + ')
          )}
        </span>
      </button>
    );
  };

  return (
    <div className="pt-shortcut-settings">
      <Label>键位</Label>
      <div className="pt-shortcut-rows">
        {SHORTCUT_ACTIONS.map((action) => (
          <div key={action}>
            <div className="pt-shortcut-row">
              <span className="pt-shortcut-name">{ACTION_LABELS[action]}</span>
              {renderKeycap(action)}
            </div>
            {rowError?.action === action && (
              <div className="pt-shortcut-error" role="alert">
                {rowError.message}
              </div>
            )}
          </div>
        ))}
      </div>
      <div className="pt-shortcut-foot">
        <Hint>点击键位即可修改</Hint>
        <Button type="link" size="small" onClick={resetAll}>
          全部恢复默认
        </Button>
      </div>
    </div>
  );
}
