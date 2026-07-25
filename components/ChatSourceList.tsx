import { useState } from 'react';
import {
  CaretDownOutlined,
  CaretRightOutlined,
  GlobalOutlined,
} from '@ant-design/icons';
import type { ChatScope } from '@/types/chat';

/** 来源 favicon；加载失败或缺失时回退为地球占位图标。 */
function SourceFavicon({ src }: { src?: string }) {
  const [broken, setBroken] = useState(false);
  if (!src || broken) {
    return <GlobalOutlined className="chat-source-favicon-fallback" />;
  }
  return (
    <img
      className="chat-source-favicon"
      src={src}
      alt=""
      onError={() => setBroken(true)}
    />
  );
}

/** 多来源会话在输入区上方展示的可折叠来源条。 */
export function ChatSourceList({ scope }: { scope: ChatScope }) {
  const [expanded, setExpanded] = useState(false);
  if (scope.sources.length === 0) return null;

  return (
    <div className="chat-source-list">
      <button
        type="button"
        className="chat-source-header"
        onClick={() => setExpanded((current) => !current)}
      >
        {expanded ? <CaretDownOutlined /> : <CaretRightOutlined />}
        <span>资料来源（{scope.sources.length}）</span>
      </button>
      {expanded &&
        scope.sources.map((source, index) => (
          <div className="chat-source-item" key={source.id}>
            <span className="chat-source-citation">S{index + 1}: </span>
            <a
              className="chat-source-title"
              href={source.url}
              target="_blank"
              rel="noopener noreferrer"
              title={source.url}
            >
              {source.title || source.url}
            </a>
            <SourceFavicon src={source.faviconUrl} />
          </div>
        ))}
    </div>
  );
}
