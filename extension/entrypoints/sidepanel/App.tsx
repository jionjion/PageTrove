import { useState } from 'react';
import { browser } from 'wxt/browser';
import { CurrentPageView } from '@/components/CurrentPageView';
import { ClipListView } from '@/components/ClipListView';

type Tab = 'current' | 'clips';

export default function App() {
  const [tab, setTab] = useState<Tab>('current');

  return (
    <div className="app">
      <header className="app-header">
        <h1>拾页 PageTrove</h1>
        <button
          className="icon-btn"
          title="设置"
          onClick={() => void browser.runtime.openOptionsPage()}
        >
          ⚙
        </button>
      </header>

      <nav className="tabs">
        <button
          className={tab === 'current' ? 'tab active' : 'tab'}
          onClick={() => setTab('current')}
        >
          当前网页
        </button>
        <button
          className={tab === 'clips' ? 'tab active' : 'tab'}
          onClick={() => setTab('clips')}
        >
          我的收藏
        </button>
      </nav>

      <main className="app-main">
        {tab === 'current' ? <CurrentPageView /> : <ClipListView />}
      </main>
    </div>
  );
}
