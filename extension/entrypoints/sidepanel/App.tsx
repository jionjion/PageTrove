import { useState } from 'react';
import { browser } from 'wxt/browser';
import { Button, Tabs, Typography } from 'antd';
import { SettingOutlined } from '@ant-design/icons';
import { CurrentPageView } from '@/components/CurrentPageView';
import { ClipListView } from '@/components/ClipListView';

export default function App() {
  const [tab, setTab] = useState('current');

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
          { key: 'clips', label: '我的收藏', children: <ClipListView /> },
        ]}
      />
    </div>
  );
}
