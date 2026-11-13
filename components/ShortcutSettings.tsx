import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { browser } from 'wxt/browser';
import { App as AntApp, Button, Switch, Tooltip, Typography } from 'antd';
import {
  FolderOpenOutlined,
  FileSearchOutlined,
  HistoryOutlined,
  KeyOutlined,
  LayoutOutlined,
  MessageOutlined,
  PlusOutlined,
  SettingOutlined,
  StarOutlined,
  ThunderboltOutlined,
  UndoOutlined,
} from '@ant-design/icons';
import {
  DEFAULT_SHORTCUTS,
  SHORTCUT_GROUPS,
  type ShortcutAction,
  type ShortcutBinding,
  type ShortcutMap,
} from '@/types/shortcuts';
import {
  bindingEquals,
  bindingTokens,
  cloneBinding,
  cloneShortcuts,
  comboFromEvent,
  DoubleTapDetector,
  findShortcutConflict,
  isMacPlatform,
  validateBinding,
} from '@/services/shortcuts';

const ACTION_META: Record<
  ShortcutAction,
  { label: string; description: string; icon: React.ReactNode }
> = {
  'open-panel': {
    label: '唤起侧边栏',
    description: '在任意网页打开拾页侧边栏',
    icon: <LayoutOutlined />,
  },
  'quick-save': {
    label: '一键收录',
    description: '不开面板直接保存当前页，AI 整理异步补齐',
    icon: <ThunderboltOutlined />,
  },
  'new-chat': {
    label: '新对话',
    description: '针对当前网页发起新对话',
    icon: <PlusOutlined />,
  },
  'view-chat': {
    label: '对话',
    description: '切换到对话视图',
    icon: <MessageOutlined />,
  },
  'view-current': {
    label: '收录',
    description: '切换到当前页收录视图',
    icon: <StarOutlined />,
  },
  'view-clips': {
    label: '收藏',
    description: '切换到收藏列表',
    icon: <FolderOpenOutlined />,
  },
  'view-research': {
    label: '探究',
    description: '切换到多页探究',
    icon: <FileSearchOutlined />,
  },
  'view-history': {
    label: '历史',
    description: '切换到对话历史',
    icon: <HistoryOutlined />,
  },
  'open-settings': {
    label: '打开设置',
    description: '打开拾页设置页',
    icon: <SettingOutlined />,
  },
};

/** 浏览器级备用键(chrome.commands.getAll 的显示格式)归一为内部键名。 */
function normalizeBrowserShortcut(shortcut: string): string {
  return shortcut
    .split('+')
    .map((part) => {
      if (part === 'Ctrl' || part === 'MacCtrl') return 'Control';
      if (part === 'Command') return 'Meta';
      return part;
    })
    .join('+');
}

interface Props {
  value: ShortcutMap;
  onChange: (next: ShortcutMap) => void;
  autoAnalyze: boolean;
  onAutoAnalyzeChange: (checked: boolean) => void;
}

export function ShortcutSettings({
  value,
  onChange,
  autoAnalyze,
  onAutoAnalyzeChange,
}: Props) {
  const { message } = AntApp.useApp();
  const mac = useMemo(() => isMacPlatform(), []);

  const [recording, setRecording] = useState<ShortcutAction>();
  const [rowError, setRowError] = useState<{ action: ShortcutAction; message: string }>();
  const [flash, setFlash] = useState<ShortcutAction>();
  const [browserKey, setBrowserKey] = useState<string>();

  const valueRef = useRef(value);
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    valueRef.current = value;
    onChangeRef.current = onChange;
  });

  // 浏览器级备用键如实展示(用户可能在 chrome://extensions/shortcuts 改过)
  useEffect(() => {
    let cancelled = false;
    browser.commands
      .getAll()
      .then((commands) => {
        if (cancelled) return;
        const command = commands.find((item) => item.name === 'open-panel');
        setBrowserKey(command?.shortcut ?? '');
      })
      .catch(() => setBrowserKey(''));
    return () => {
      cancelled = true;
    };
  }, []);

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
          message: `与「${ACTION_META[conflict].label}」冲突，请换一个`,
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

  const resetAction = (action: ShortcutAction) => {
    const standard = cloneBinding(DEFAULT_SHORTCUTS[action]);
    const conflict = findShortcutConflict(value, action, standard);
    if (conflict) {
      setRowError({
        action,
        message: `默认键位与「${ACTION_META[conflict].label}」冲突，请先调整对方`,
      });
      return;
    }
    setRowError(undefined);
    onChange({ ...value, [action]: standard });
    setFlash(action);
  };

  const resetAll = () => {
    setRowError(undefined);
    setRecording(undefined);
    onChange(cloneShortcuts(DEFAULT_SHORTCUTS));
    message.success('已恢复全部默认快捷键');
  };

  const renderKeycap = (action: ShortcutAction) => {
    const binding = value[action];
    const isRecording = recording === action;
    const hasError = rowError?.action === action;
    const tokens = bindingTokens(binding, mac);

    if (isRecording) {
      return (
        <span className="pt-keycap pt-keycap-recording" role="status" aria-live="polite">
          <span className="pt-rec-dot" aria-hidden="true" />
          按下新快捷键…
          <span className="pt-rec-esc">Esc 取消</span>
        </span>
      );
    }

    return (
      <button
        type="button"
        className={[
          'pt-keycap',
          hasError ? 'pt-keycap-error' : '',
          flash === action ? 'pt-keycap-flash' : '',
        ]
          .filter(Boolean)
          .join(' ')}
        title="点击录制新快捷键"
        aria-label={`${ACTION_META[action].label}快捷键：${tokens.join(' + ')}${binding.kind === 'double' ? '（双击）' : ''}，点击修改`}
        onClick={() => {
          setRowError(undefined);
          setRecording(action);
        }}
      >
        {tokens.map((token, index) => (
          <kbd key={index}>{token}</kbd>
        ))}
        {binding.kind === 'double' && (
          <span className="pt-keycap-double-badge">双击</span>
        )}
      </button>
    );
  };

  return (
    <div className="pt-shortcut-settings">
      <Typography.Paragraph type="secondary" className="options-hint">
        点击键位即可录制新快捷键：支持组合键，也支持连按两次 Alt / Ctrl / Shift。
        改动即时生效，无需刷新页面。
      </Typography.Paragraph>

      {SHORTCUT_GROUPS.map((group) => (
        <section key={group.title} className="pt-shortcut-group">
          <div className="pt-shortcut-group-head">
            <Typography.Text strong className="pt-shortcut-group-title">
              {group.title}
            </Typography.Text>
            <Typography.Text type="secondary" className="pt-shortcut-group-desc">
              {group.description}
            </Typography.Text>
          </div>
          {group.actions.map((action) => {
            const meta = ACTION_META[action];
            const customized = !bindingEquals(value[action], DEFAULT_SHORTCUTS[action]);
            return (
              <div key={action}>
                <div className="pt-shortcut-row">
                  <span className="pt-shortcut-icon" aria-hidden="true">
                    {meta.icon}
                  </span>
                  <span className="pt-shortcut-meta">
                    <span className="pt-shortcut-name">{meta.label}</span>
                    <span className="pt-shortcut-desc" title={meta.description}>
                      {meta.description}
                    </span>
                  </span>
                  {renderKeycap(action)}
                  <Tooltip title="恢复默认键位">
                    <Button
                      size="small"
                      type="text"
                      className="pt-shortcut-reset"
                      style={{ visibility: customized ? 'visible' : 'hidden' }}
                      icon={<UndoOutlined />}
                      aria-label={`恢复${meta.label}默认键位`}
                      onClick={() => resetAction(action)}
                    />
                  </Tooltip>
                </div>
                {rowError?.action === action && (
                  <div className="pt-shortcut-error" role="alert">
                    {rowError.message}
                  </div>
                )}
              </div>
            );
          })}
        </section>
      ))}

      <div className="pt-shortcut-footer">
        <Button icon={<UndoOutlined />} onClick={resetAll}>
          全部恢复默认
        </Button>
      </div>

      <div className="pt-shortcut-auto">
        <span className="pt-shortcut-meta">
          <span className="pt-shortcut-name">收录后自动 AI 整理</span>
          <span className="pt-shortcut-desc">
            一键收录成功后自动生成摘要与标签；未配置 API Key 时自动跳过，不影响保存
          </span>
        </span>
        <Switch
          checked={autoAnalyze}
          onChange={onAutoAnalyzeChange}
          aria-label="收录后自动 AI 整理"
        />
      </div>

      <div className="pt-shortcut-browser">
        <div className="pt-shortcut-group-head">
          <Typography.Text strong className="pt-shortcut-group-title">
            <KeyOutlined style={{ marginRight: 6 }} />
            浏览器备用键
          </Typography.Text>
        </div>
        <div className="pt-shortcut-row">
          <span className="pt-shortcut-icon" aria-hidden="true">
            <LayoutOutlined />
          </span>
          <span className="pt-shortcut-meta">
            <span className="pt-shortcut-name">打开侧边栏（浏览器级）</span>
            <span className="pt-shortcut-desc">
              网页内监听失效时（浏览器内部页、PDF、DevTools 聚焦）仍然可用
            </span>
          </span>
          <span className="pt-keycap pt-keycap-static">
            {browserKey === undefined ? (
              <kbd>…</kbd>
            ) : browserKey ? (
              bindingTokens(
                { kind: 'combo', keys: normalizeBrowserShortcut(browserKey) },
                mac,
              ).map((token, index) => <kbd key={index}>{token}</kbd>)
            ) : (
              <kbd>未设置</kbd>
            )}
          </span>
        </div>
        <Typography.Paragraph
          type="secondary"
          className="options-hint"
          style={{ marginTop: 8 }}
        >
          备用键可在浏览器快捷键页修改：
          <Typography.Text
            code
            copyable={{
              text: 'chrome://extensions/shortcuts',
              tooltips: ['复制地址', '已复制'],
            }}
          >
            chrome://extensions/shortcuts
          </Typography.Text>
          <br />
          「双击 Alt」等自定义键位由拾页在网页内监听，不占用浏览器键位。
        </Typography.Paragraph>
      </div>
    </div>
  );
}
