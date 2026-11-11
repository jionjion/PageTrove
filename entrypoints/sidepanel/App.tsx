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

  const navigation = [
    { key: 'chat', label: '对话', icon: <MessageOutlined /> },
    { key: 'current', label: '收录', icon: <StarOutlined /> },
    { key: 'clips', label: '收藏', icon: <FolderOpenOutlined /> },
    { key: 'research', label: '探究', icon: <FileSearchOutlined /> },
    { key: 'history', label: '历史', icon: <HistoryOutlined /> },
  ] as const;

  return (
    <div className="app">
      <header className="app-header">
        <div className="app-brand-row">
          <div className="app-brand">
            拾页 <span>PageTrove</span>
          </div>
          <div className="app-header-actions">
            <Tooltip title="新对话（针对当前网页）">
              <Button
                type="text"
                aria-label="新对话（针对当前网页）"
                icon={<PlusOutlined />}
                onClick={() => dispatchChat({ kind: 'new' })}
              />
            </Tooltip>
            <Tooltip title="设置">
              <Button
                type="text"
                aria-label="设置"
                icon={<SettingOutlined />}
                onClick={() => void browser.runtime.openOptionsPage()}
              />
            </Tooltip>
          </div>
        </div>
        <nav className="app-nav" aria-label="主要导航">
          {navigation.map((item) => (
            <button
              key={item.key}
              type="button"
              className="app-nav-item"
              aria-current={view === item.key ? 'page' : undefined}
              onClick={() => setView(item.key)}
            >
              {item.icon}
              <span>{item.label}</span>
            </button>
          ))}
        </nav>
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
        />
      </div>
    </div>
  );
}
