import { useEffect, useRef, useState } from 'react';
import { browser } from 'wxt/browser';
import { Button, Typography } from 'antd';
import {
  ExperimentOutlined,
  FolderOpenOutlined,
  HistoryOutlined,
  PlusOutlined,
  SettingOutlined,
  StarOutlined,
} from '@ant-design/icons';
import { CurrentPageView } from '@/components/CurrentPageView';
import { ClipListView } from '@/components/ClipListView';
import { ChatView, type ChatCommand } from '@/components/ChatView';
import { ChatHistoryView } from '@/components/ChatHistoryView';
import { ResearchSetupView } from '@/components/ResearchSetupView';
import {
  onQuoteIntentChanged,
  takeNextQuoteIntent,
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

  const dispatchChat = (command: ChatCommand) => {
    setChatCommand(command);
    setChatNonce((n) => n + 1);
    setView('chat');
  };

  /** 消费右键引用意图队列，逐条下发新会话。 */
  const consumeQuoteIntents = async () => {
    for (;;) {
      const intent = await takeNextQuoteIntent();
      if (!intent) return;
      if (consumedIntentIds.current.has(intent.id)) continue;
      consumedIntentIds.current.add(intent.id);
      dispatchChat({ kind: 'new', quote: intent });
    }
  };

  useEffect(() => {
    void consumeQuoteIntents();
    return onQuoteIntentChanged(() => void consumeQuoteIntents());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** 点击图标切换视图；再点一次已激活的图标则回到对话 */
  const toggleView = (target: View) => {
    setView((v) => (v === target ? 'chat' : target));
  };

  const iconStyle = (target: View) =>
    view === target ? { color: '#1677ff' } : undefined;

  return (
    <div className="app">
      <header className="app-header">
        <Typography.Title
          level={5}
          style={{ margin: 0, flex: 1, minWidth: 0 }}
          ellipsis={{ tooltip: chatTitle }}
        >
          {chatTitle}
        </Typography.Title>
        <div className="app-header-actions">
          <Button
            type="text"
            title="新对话（针对当前网页）"
            icon={<PlusOutlined />}
            onClick={() => dispatchChat({ kind: 'new' })}
          />
          <Button
            type="text"
            title="探究多个网页"
            style={iconStyle('research')}
            icon={<ExperimentOutlined />}
            onClick={() => toggleView('research')}
          />
          <Button
            type="text"
            title="历史对话"
            style={iconStyle('history')}
            icon={<HistoryOutlined />}
            onClick={() => toggleView('history')}
          />
          <Button
            type="text"
            title="收藏当前网页"
            style={iconStyle('current')}
            icon={<StarOutlined />}
            onClick={() => toggleView('current')}
          />
          <Button
            type="text"
            title="我的收藏"
            style={iconStyle('clips')}
            icon={<FolderOpenOutlined />}
            onClick={() => toggleView('clips')}
          />
          <Button
            type="text"
            title="设置"
            icon={<SettingOutlined />}
            onClick={() => void browser.runtime.openOptionsPage()}
          />
        </div>
      </header>

      {/* 各视图保持挂载以保留状态，仅切换显示 */}
      <div className="app-body" style={view === 'chat' ? undefined : { display: 'none' }}>
        <ChatView command={chatCommand} nonce={chatNonce} onTitleChange={setChatTitle} />
      </div>
      <div className="app-body" style={view === 'research' ? undefined : { display: 'none' }}>
        <ResearchSetupView
          active={view === 'research'}
          onStart={(scope) => dispatchChat({ kind: 'new-scope', scope })}
        />
      </div>
      <div className="app-body" style={view === 'history' ? undefined : { display: 'none' }}>
        <ChatHistoryView
          active={view === 'history'}
          onOpen={(sessionId) => dispatchChat({ kind: 'open', sessionId })}
        />
      </div>
      <div className="app-body" style={view === 'current' ? undefined : { display: 'none' }}>
        <CurrentPageView />
      </div>
      <div className="app-body" style={view === 'clips' ? undefined : { display: 'none' }}>
        <ClipListView
          active={view === 'clips'}
          onChat={(clipId) => dispatchChat({ kind: 'new', clipId })}
          onResearch={(scope) => dispatchChat({ kind: 'new-scope', scope })}
        />
      </div>
    </div>
  );
}
