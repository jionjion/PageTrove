import { useState } from 'react';
import { browser } from 'wxt/browser';
import { Button, Tabs, Typography } from 'antd';
import { SettingOutlined } from '@ant-design/icons';
import { CurrentPageView } from '@/components/CurrentPageView';
import { ClipListView } from '@/components/ClipListView';
import { ChatView } from '@/components/ChatView';

export default function App() {
  const [tab, setTab] = useState('current');
  const [chatClipId, setChatClipId] = useState<string>();
  const [chatNonce, setChatNonce] = useState(0);

  const openChatForClip = (clipId: string) => {
    setChatClipId(clipId);
    setChatNonce((n) => n + 1);
    setTab('chat');
  };

  return (
    <div className="app">
      <header className="app-header">
        <Typography.Title level={5} style={{ margin: 0 }}>
          拾页 PageTrove
        </Typography.Title>
        <Button
          type="text"
          title="设置"
          icon={<SettingOutlined />}
          onClick={() => void browser.runtime.openOptionsPage()}
        />
      </header>

      <Tabs
        activeKey={tab}
        onChange={setTab}
        centered
        size="small"
        className="app-tabs"
        items={[
          { key: 'current', label: '当前网页', children: <CurrentPageView /> },
          {
            key: 'clips',
            label: '我的收藏',
            children: <ClipListView onChat={openChatForClip} />,
          },
          {
            key: 'chat',
            label: '对话',
            children: (
              <ChatView pendingClipId={chatClipId} pendingNonce={chatNonce} />
            ),
          },
        ]}
      />
    </div>
  );
}
