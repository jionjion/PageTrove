import { useEffect, useRef, useState } from 'react';
import { browser } from 'wxt/browser';
import { Button, Tooltip } from 'antd';
import {
  FileSearchOutlined,
  FolderOpenOutlined,
  HistoryOutlined,
  MessageOutlined,
  PlusOutlined,
  SettingOutlined,
  StarOutlined,
} from '@ant-design/icons';
import { BrandMark } from '@/components/BrandMark';
import { CurrentPageView } from '@/components/CurrentPageView';
import { ClipListView } from '@/components/ClipListView';
import { ChatView } from '@/components/ChatView';
import type { ChatCommand } from '@/hooks/useChatController';
import { ChatHistoryView } from '@/components/ChatHistoryView';
import { ResearchSetupView } from '@/components/ResearchSetupView';
import {
  onQuoteIntentChanged,
  requestNextQuoteIntent,
} from '@/services/chat-intent-store';
import {
  onShortcutIntentChanged,
  takeShortcutIntent,
} from '@/services/shortcut-intent-store';
import { decodeSettings, getSettings } from '@/services/settings-store';
import { runQuickSave } from '@/services/quick-save';
import { bindingText } from '@/services/shortcuts';
import {
  DEFAULT_SHORTCUTS,
  SHORTCUT_VIEW_MAP,
  type ShortcutAction,
  type ShortcutMap,
} from '@/types/shortcuts';
import { useAppShortcuts } from '@/hooks/useAppShortcuts';
import { useCurrentTab } from '@/hooks/useCurrentTab';

type View = 'chat' | 'research' | 'history' | 'current' | 'clips';

export default function App() {
  const [view, setView] = useState<View>('chat');
  const [chatCommand, setChatCommand] = useState<ChatCommand>();
  const [chatNonce, setChatNonce] = useState(0);
  /** 当前会话的上下文标题，显示在头部 */
  const [chatTitle, setChatTitle] = useState('当前网页');
  /** 已消费过的意图 id，防止重复下发 */
  const consumedIntentIds = useRef(new Set<string>());
  /** storage 变化可能密集到达；同一侧边栏只允许一个 drain 循环。 */
  const consumingIntents = useRef(false);
  const consumeAgain = useRef(false);

  const [shortcuts, setShortcuts] = useState<ShortcutMap>(DEFAULT_SHORTCUTS);
  const tab = useCurrentTab();
  const consumedShortcutIds = useRef(new Set<string>());
  const consumingShortcuts = useRef(false);
  const consumeShortcutAgain = useRef(false);

  const dispatchChat = (command: ChatCommand) => {
    setChatCommand(command);
    setChatNonce((n) => n + 1);
    setView('chat');
  };

  /** 消费右键引用意图队列，逐条下发新会话。 */
  const consumeQuoteIntents = async () => {
    if (consumingIntents.current) {
      consumeAgain.current = true;
      return;
    }
    consumingIntents.current = true;
    try {
      do {
        consumeAgain.current = false;
        for (;;) {
          const intent = await requestNextQuoteIntent();
          if (!intent) break;
          if (consumedIntentIds.current.has(intent.id)) continue;
          consumedIntentIds.current.add(intent.id);
          dispatchChat({ kind: 'new', quote: intent });
        }
      } while (consumeAgain.current);
    } catch (error) {
      console.error('读取引用意图失败', error);
    } finally {
      consumingIntents.current = false;
    }
  };

  useEffect(() => {
    queueMicrotask(() => void consumeQuoteIntents());
    return onQuoteIntentChanged(() => void consumeQuoteIntents());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** 消费网页快捷键发来的导航意图(面板未开时由 background 写入)。 */
  const consumeShortcutIntents = async () => {
    if (consumingShortcuts.current) {
      consumeShortcutAgain.current = true;
      return;
    }
    consumingShortcuts.current = true;
    try {
      do {
        consumeShortcutAgain.current = false;
        for (;;) {
          const intent = await takeShortcutIntent();
          if (!intent) break;
          if (consumedShortcutIds.current.has(intent.id)) continue;
          consumedShortcutIds.current.add(intent.id);
          if (intent.newChat) dispatchChat({ kind: 'new' });
          else setView(intent.view);
        }
      } while (consumeShortcutAgain.current);
    } catch (error) {
      console.error('读取快捷键意图失败', error);
    } finally {
      consumingShortcuts.current = false;
    }
  };

  useEffect(() => {
    queueMicrotask(() => void consumeShortcutIntents());
    return onShortcutIntentChanged(() => void consumeShortcutIntents());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 键位设置变化时即时同步(设置页改键无需重开面板)
  useEffect(() => {
    let cancelled = false;
    void getSettings()
      .then((settings) => {
        if (!cancelled) setShortcuts(settings.shortcuts);
      })
      .catch(() => {});
    const listener = (
      changes: Record<string, Browser.storage.StorageChange>,
      areaName: string,
    ) => {
      if (areaName === 'local' && changes.settings) {
        setShortcuts(decodeSettings(changes.settings.newValue).shortcuts);
      }
    };
    browser.storage.onChanged.addListener(listener);
    return () => {
      cancelled = true;
      browser.storage.onChanged.removeListener(listener);
    };
  }, []);

  /** 焦点在侧边栏时的本地快捷键处理。 */
  const handleShortcutAction = (action: ShortcutAction) => {
    const targetView = SHORTCUT_VIEW_MAP[action];
    if (targetView) {
      setView(targetView);
      return;
    }
    if (action === 'new-chat') dispatchChat({ kind: 'new' });
    else if (action === 'open-settings') void browser.runtime.openOptionsPage();
    else if (action === 'quick-save') void runQuickSave(tab.tabId);
    // open-panel:面板已打开,无需动作
  };
  useAppShortcuts(shortcuts, handleShortcutAction);

  const navigation = [
    { key: 'chat', label: '对话', action: 'view-chat', icon: <MessageOutlined /> },
    { key: 'current', label: '收录', action: 'view-current', icon: <StarOutlined /> },
    { key: 'clips', label: '收藏', action: 'view-clips', icon: <FolderOpenOutlined /> },
    {
      key: 'research',
      label: '探究',
      action: 'view-research',
      icon: <FileSearchOutlined />,
    },
    { key: 'history', label: '历史', action: 'view-history', icon: <HistoryOutlined /> },
  ] as const;

  return (
    <div className="app">
      <header className="app-header">
        <div className="app-brand-row">
          <div className="app-brand">
            <BrandMark />
            拾页 <span>PageTrove</span>
          </div>
          <nav className="app-header-actions" aria-label="主要导航">
            <Tooltip
              title={`新对话（针对当前网页） · ${bindingText(shortcuts['new-chat'])}`}
            >
              <Button
                type="text"
                aria-label="新对话（针对当前网页）"
                icon={<PlusOutlined />}
                onClick={() => dispatchChat({ kind: 'new' })}
              />
            </Tooltip>
            <span className="app-header-divider" aria-hidden="true" />
            {navigation.map((item) => (
              <Tooltip
                key={item.key}
                title={`${item.label} · ${bindingText(shortcuts[item.action])}`}
              >
                <Button
                  type="text"
                  aria-label={item.label}
                  aria-current={view === item.key ? 'page' : undefined}
                  icon={item.icon}
                  onClick={() => setView(item.key)}
                />
              </Tooltip>
            ))}
            <span className="app-header-divider" aria-hidden="true" />
            <Tooltip title={`设置 · ${bindingText(shortcuts['open-settings'])}`}>
              <Button
                type="text"
                aria-label="设置"
                icon={<SettingOutlined />}
                onClick={() => void browser.runtime.openOptionsPage()}
              />
            </Tooltip>
          </nav>
        </div>
      </header>

      {/* 各视图保持挂载以保留状态，仅切换显示 */}
      <div className="app-body" style={view === 'chat' ? undefined : { display: 'none' }}>
        <div className="chat-context" title={chatTitle}>
          <span className="chat-context-label">当前对话</span>
          <span className="chat-context-title">{chatTitle}</span>
        </div>
        <ChatView command={chatCommand} nonce={chatNonce} onTitleChange={setChatTitle} />
      </div>
      <div
        className="app-body"
        style={view === 'research' ? undefined : { display: 'none' }}
      >
        <ResearchSetupView
          active={view === 'research'}
          onStart={(scope) => dispatchChat({ kind: 'new-scope', scope })}
        />
      </div>
      <div
        className="app-body"
        style={view === 'history' ? undefined : { display: 'none' }}
      >
        <ChatHistoryView
          active={view === 'history'}
          onOpen={(sessionId) => dispatchChat({ kind: 'open', sessionId })}
          onNew={() => dispatchChat({ kind: 'new' })}
        />
      </div>
      <div
        className="app-body"
        style={view === 'current' ? undefined : { display: 'none' }}
      >
        <CurrentPageView />
      </div>
      <div
        className="app-body"
        style={view === 'clips' ? undefined : { display: 'none' }}
      >
        <ClipListView
          active={view === 'clips'}
          onChat={(clipId) => dispatchChat({ kind: 'new', clipId })}
          onResearch={(scope) => dispatchChat({ kind: 'new-scope', scope })}
          onCollect={() => setView('current')}
        />
      </div>
    </div>
  );
}
