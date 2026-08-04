/** 引用来源的最小形状：linkify 只需要 url。 */
interface CitationSource {
  url: string;
}

/**
 * 将回答中的 [S1] 引用标注替换为指向对应来源的 Markdown 链接；
 * 已是链接形式（[S1](…)）的不重复处理，超出来源数的编号保持原样。
 */
export function linkifyCitations(
  markdown: string,
  sources: readonly CitationSource[] | undefined,
): string {
  if (!sources || sources.length === 0) return markdown;
  return markdown.replace(/\[S(\d+)\](?!\()/g, (matched, num: string) => {
    const source = sources[Number(num) - 1];
    return source ? `[S${num}](${source.url})` : matched;
  });
}
