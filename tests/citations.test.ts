import { describe, expect, it } from 'vitest';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkStringify from 'remark-stringify';
import { remarkCitations, toCitationRefs } from '@/services/citations';
import type { CitationRef } from '@/types/chat';

const refs: CitationRef[] = [
  { citation: 'S1', sourceId: 'a', title: '来源甲', url: 'https://a.example.com' },
  { citation: 'S2', sourceId: 'b', title: '', url: 'https://b.example.com' },
];

/** 用与 react-markdown 同源的 unified 管线跑插件,返回序列化 Markdown。 */
function run(markdown: string, citationRefs: CitationRef[] | undefined): string {
  return unified()
    .use(remarkParse)
    .use(() => remarkCitations(citationRefs))
    .use(remarkStringify)
    .processSync(markdown)
    .toString()
    .trimEnd();
}

describe('remarkCitations', () => {
  it('将 [S1] 替换为对应来源链接(带 title)', () => {
    expect(run('见 [S1] 与 [S2]。', refs)).toBe(
      '见 [S1](https://a.example.com "来源甲") 与 [S2](https://b.example.com)。',
    );
  });

  it('refs 为空或 undefined 时不改写', () => {
    expect(run('见 [S1]。', undefined)).toBe('见 \\[S1]。');
    expect(run('见 [S1]。', [])).toBe('见 \\[S1]。');
  });

  it('代码块中的 [S1] 不被改写', () => {
    expect(run('```\n[S1]\n```', refs)).toBe('```\n[S1]\n```');
  });

  it('行内代码中的 [S1] 不被改写', () => {
    expect(run('看 `[S1]` 这里', refs)).toBe('看 `[S1]` 这里');
  });

  it('已是链接形式的不重复处理', () => {
    expect(run('[S1](https://a.example.com)', refs)).toBe(
      '[S1](https://a.example.com)',
    );
  });

  it('越界编号保持原样', () => {
    expect(run('见 [S99]。', refs)).toBe('见 \\[S99]。');
  });

  it('同一编号多次出现均替换', () => {
    expect(run('[S1] 和 [S1]', refs)).toBe(
      '[S1](https://a.example.com "来源甲") 和 [S1](https://a.example.com "来源甲")',
    );
  });

  it('同一文本节点混合命中与越界编号', () => {
    expect(run('[S1] 然后 [S99] 再 [S2]', refs)).toBe(
      '[S1](https://a.example.com "来源甲") 然后 \\[S99] 再 [S2](https://b.example.com)',
    );
  });
});

describe('toCitationRefs', () => {
  it('从上下文来源提取映射', () => {
    expect(
      toCitationRefs({
        title: 't',
        url: '',
        content: '',
        sources: [
          {
            id: 'a',
            citation: 'S1',
            title: '来源甲',
            url: 'https://a.example.com',
            content: '正文',
          },
        ],
      }),
    ).toEqual([
      { citation: 'S1', sourceId: 'a', title: '来源甲', url: 'https://a.example.com' },
    ]);
  });

  it('无来源时返回 undefined', () => {
    expect(toCitationRefs({ title: 't', url: '', content: '' })).toBeUndefined();
    expect(
      toCitationRefs({ title: 't', url: '', content: '', sources: [] }),
    ).toBeUndefined();
  });
});
