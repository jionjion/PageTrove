import { useEffect, useState } from 'react';
import { browser, type Browser } from 'wxt/browser';
import { isUnsupportedUrl } from '@/services/url-utils';

export interface CurrentTabInfo {
  tabId?: number;
  url: string;
  title: string;
  domain: string;
  favIconUrl?: string;
  unsupported: boolean;
}

const EMPTY: CurrentTabInfo = {
  url: '',
  title: '',
  domain: '',
  unsupported: true,
};

function toInfo(tab: Browser.tabs.Tab | undefined): CurrentTabInfo {
  if (!tab?.url) return EMPTY;

  let domain = '';
  try {
    domain = new URL(tab.url).hostname;
  } catch {
    // 忽略无法解析的 URL
  }

  return {
    tabId: tab.id,
    url: tab.url,
    title: tab.title ?? '',
    domain,
    favIconUrl: tab.favIconUrl,
    unsupported: isUnsupportedUrl(tab.url),
  };
}

/** 跟踪当前激活标签页的基础信息，标签切换或页面跳转时自动更新 */
export function useCurrentTab(): CurrentTabInfo {
  const [info, setInfo] = useState<CurrentTabInfo>(EMPTY);

  useEffect(() => {
    let disposed = false;

    const refresh = async () => {
      const [tab] = await browser.tabs.query({
        active: true,
        currentWindow: true,
      });
      if (!disposed) setInfo(toInfo(tab));
    };

    void refresh();

    const onActivated = () => void refresh();
    const onUpdated = (
      _tabId: number,
      changeInfo: Browser.tabs.OnUpdatedInfo,
      tab: Browser.tabs.Tab,
    ) => {
      if (tab.active && (changeInfo.url || changeInfo.title || changeInfo.status)) {
        void refresh();
      }
    };

    browser.tabs.onActivated.addListener(onActivated);
    browser.tabs.onUpdated.addListener(onUpdated);

    return () => {
      disposed = true;
      browser.tabs.onActivated.removeListener(onActivated);
      browser.tabs.onUpdated.removeListener(onUpdated);
    };
  }, []);

  return info;
}
