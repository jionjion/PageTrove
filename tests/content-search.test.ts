import { describe, expect, it } from 'vitest';
import { parseQueryTerms, searchClipContents } from '@/services/content-search';
import type { WebClip } from '@/types/clip';

function makeClip(overrides: Partial<WebClip>): WebClip {
  return {
    id: 'id-1',
    url: 'https://example.com',
    normalizedUrl: 'https://example.com',
    domain: 'example.com',
    title: '默认标题',
    tags: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('parseQueryTerms', () => {
  it('按空白切分并小写化', () => {
    expect(parseQueryTerms('  Hello 世界  ')).toEqual(['hello', '世界']);
  });

  it('空查询返回空数组', () => {
    expect(parseQueryTerms('   ')).toEqual([]);
  });
});

describe('searchClipContents', () => {
  it('空查询返回空结果', () => {
    expect(searchClipContents([makeClip({})], '')).toEqual([]);
  });

  it('标题命中权重高于正文命中', () => {
    const titleHit = makeClip({ id: 'title', title: '量子计算入门' });
    const bodyHit = makeClip({
      id: 'body',
      title: '别的',
      extractedText: '正文提到量子计算。',
    });
    const hits = searchClipContents([bodyHit, titleHit], '量子计算');
    expect(hits.map((hit) => hit.id)).toEqual(['title', 'body']);
  });

  it('多词为 AND 关系', () => {
    const both = makeClip({ id: 'both', title: '量子 计算' });
    const onlyOne = makeClip({ id: 'one', title: '量子' });
    const hits = searchClipContents([both, onlyOne], '量子 计算');
    expect(hits.map((hit) => hit.id)).toEqual(['both']);
  });

  it('正文命中时返回附近片段', () => {
    const clip = makeClip({
      extractedText: `${'前置内容。'.repeat(30)}这里出现关键词量子纠缠。${'后续内容。'.repeat(30)}`,
    });
    const [hit] = searchClipContents([clip], '量子纠缠');
    expect(hit.excerpt).toContain('量子纠缠');
    expect(hit.excerpt!.length).toBeLessThan(200);
  });

  it('同分时按收藏时间倒序', () => {
    const older = makeClip({
      id: 'older',
      title: '相同标题',
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    const newer = makeClip({
      id: 'newer',
      title: '相同标题',
      createdAt: '2026-02-01T00:00:00.000Z',
    });
    const hits = searchClipContents([older, newer], '相同标题');
    expect(hits.map((hit) => hit.id)).toEqual(['newer', 'older']);
  });
});
