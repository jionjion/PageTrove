import { useState } from 'react';
import { browser } from 'wxt/browser';
import { Button, Typography } from 'antd';
import {
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

type View = 'chat' | 'history' | 'current' | 'clips';

export default function App() {
  const [view, setView] = useState<View>('chat');
  const [chatCommand, setChatCommand] = useState<ChatCommand>();
  const [chatNonce, setChatNonce] = useState(0);
  /** 当前会话的上下文标题，显示在头部 */
  const [chatTitle, setChatTitle] = useState('当前网页');

  const dispatchChat = (command: ChatCommand) => {
    setChatCommand(command);
    setChatNonce((n) => n + 1);
    setView('chat');
  };

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
        />
      </div>
    </div>
  );
}
