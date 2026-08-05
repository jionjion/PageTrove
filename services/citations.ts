import type { Link, Parent, Root, Text } from 'mdast';
import { visit } from 'unist-util-visit';
import type { CitationRef } from '@/types/chat';
import type { ChatContext } from '@/services/ai/provider';

/** 从解析后的上下文提取消息级引用映射;无多来源时返回 undefined。 */
export function toCitationRefs(context: ChatContext): CitationRef[] | undefined {
  if (!context.sources || context.sources.length === 0) return undefined;
  return context.sources.map((source) => ({
    citation: source.citation,
    sourceId: source.id,
    title: source.title,
    url: source.url,
  }));
}

const CITATION_PATTERN = /\[S(\d+)\]/g;

/**
 * remark 插件:将文本节点中的 [S1] 替换为指向对应来源的链接节点。
 * 基于 AST 操作,天然跳过代码块、行内代码与已有链接;
 * 编号不在映射内时保持原文本。
 */
export function remarkCitations(refs: readonly CitationRef[] | undefined) {
  return (tree: Root) => {
    if (!refs || refs.length === 0) return;
    const byCitation = new Map(refs.map((ref) => [ref.citation, ref]));

    visit(tree, 'text', (node: Text, index, parent) => {
      if (index === undefined || !parent) return;
      // 已是链接([S1](url) 解析后 text 的父节点是 link),不重复处理。
      if (parent.type === 'link') return;

      CITATION_PATTERN.lastIndex = 0;
      if (!CITATION_PATTERN.test(node.value)) return;
      CITATION_PATTERN.lastIndex = 0;

      const replacements: (Text | Link)[] = [];
      let cursor = 0;
      for (const match of node.value.matchAll(CITATION_PATTERN)) {
        const ref = byCitation.get(`S${match[1]}`);
        if (!ref) continue; // 越界编号保持原样(留在周围文本里)
        if (match.index > cursor) {
          replacements.push({
            type: 'text',
            value: node.value.slice(cursor, match.index),
          });
        }
        replacements.push({
          type: 'link',
          url: ref.url,
          title: ref.title || null,
          children: [{ type: 'text', value: match[0].slice(1, -1) }],
        });
        cursor = match.index + match[0].length;
      }
      if (replacements.length === 0) return;
      if (cursor < node.value.length) {
        replacements.push({ type: 'text', value: node.value.slice(cursor) });
      }

      (parent as Parent).children.splice(index, 1, ...replacements);
      // 跳过新插入的节点,避免重复访问。
      return index + replacements.length;
    });
  };
}
