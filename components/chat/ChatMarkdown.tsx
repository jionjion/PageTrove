import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { CitationRef } from '@/types/chat';
import { remarkCitations } from '@/services/citations';

/** 引用链接（S1、S2…）渲染为上标小徽标，悬停显示来源标题；其余链接新标签页打开。 */
const markdownComponents = {
  a: ({
    href,
    title,
    children,
  }: {
    href?: string;
    title?: string;
    children?: React.ReactNode;
  }) => {
    const isCitation = typeof children === 'string' && /^S\d+$/.test(children);
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className={isCitation ? 'citation-link' : undefined}
        title={isCitation ? title || href : href}
      >
        {children}
      </a>
    );
  },
};

/** 聊天消息 Markdown 渲染:GFM + 消息级引用替换。 */
export function ChatMarkdown({
  content,
  refs,
}: {
  content: string;
  refs?: CitationRef[];
}) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm, [remarkCitations, refs]]}
      components={markdownComponents}
    >
      {content}
    </ReactMarkdown>
  );
}
