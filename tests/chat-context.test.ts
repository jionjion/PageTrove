import { describe, expect, it } from 'vitest';
import {
  buildQuotePageContext,
  buildUserMessageContent,
  resolveChatContext,
  resolveScopeContext,
  scopeTitle,
} from '@/services/chat-context';
import type { ChatScope } from '@/types/chat';
import type { WebClip } from '@/types/clip';
import { AppError } from '@/utils/errors';

function makeClip(overrides: Partial<WebClip>): WebClip {
  return {
    id: 'clip-1',
    url: 'https://example.com/a',
    normalizedUrl: 'https://example.com/a',
    domain: 'example.com',
    title: '收藏甲',
    tags: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

const clipScope: ChatScope = {
  mode: 'clips',
  sources: [
    { id: 's1', type: 'clip', clipId: 'c1', title: '收藏甲', url: 'https://example.com/a' },
    { id: 's2', type: 'clip', clipId: 'c2', title: '收藏乙', url: 'https://example.com/b' },
  ],
};

describe('scopeTitle', () => {
  it('按模式区分文案', () => {
    expect(scopeTitle({ mode: 'tabs', sources: [] })).toBe('探究 · 0 个网页');
    expect(scopeTitle(clipScope)).toBe('探究 · 2 条收藏');
  });
});

describe('resolveScopeContext', () => {
  it('正常来源按顺序编号 S1..Sn', async () => {
    const clips: Record<string, WebClip> = {
      c1: makeClip({ id: 'c1', title: '收藏甲', extractedText: '正文甲' }),
      c2: makeClip({ id: 'c2', title: '收藏乙', url: 'https://example.com/b', extractedText: '正文乙' }),
    };
    const result = await resolveScopeContext(clipScope, '问题', {
      getClip: async (id) => clips[id],
    });
    expect(result.context.sources?.map((s) => s.citation)).toEqual(['S1', 'S2']);
    expect(result.notice).toBeUndefined();
    expect(result.context.unavailableSources).toBeUndefined();
  });

  it('失效来源被跳过并重新编号,notice 与 unavailableSources 记录', async () => {
    const clips: Record<string, WebClip> = {
      c2: makeClip({ id: 'c2', title: '收藏乙', url: 'https://example.com/b', extractedText: '正文乙' }),
    };
    const result = await resolveScopeContext(clipScope, '问题', {
      getClip: async (id) => clips[id],
    });
    expect(result.context.sources).toHaveLength(1);
    expect(result.context.sources?.[0].citation).toBe('S1');
    expect(result.context.sources?.[0].title).toBe('收藏乙');
    expect(result.notice).toBe('已跳过不可用来源：收藏甲（收藏已删除）');
    expect(result.context.unavailableSources).toEqual(['收藏甲（收藏已删除）']);
  });

  it('无正文的收藏也被跳过', async () => {
    const clips: Record<string, WebClip> = {
      c1: makeClip({ id: 'c1', title: '空收藏' }),
      c2: makeClip({ id: 'c2', title: '收藏乙', extractedText: '正文乙' }),
    };
    const result = await resolveScopeContext(clipScope, '问题', {
      getClip: async (id) => clips[id],
    });
    expect(result.notice).toContain('空收藏（没有可用于问答的正文）');
  });

  it('全部失效时抛错', async () => {
    await expect(
      resolveScopeContext(clipScope, '问题', { getClip: async () => undefined }),
    ).rejects.toThrow(AppError);
  });

  it('page 来源直接使用固化正文', async () => {
    const scope: ChatScope = {
      mode: 'tabs',
      sources: [
        {
          id: 'p1',
          type: 'page',
          title: '页面甲',
          url: 'https://example.com/p',
          content: '页面正文',
          capturedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    };
    const result = await resolveScopeContext(scope, '问题', {
      getClip: async () => undefined,
    });
    expect(result.context.sources?.[0]).toMatchObject({
      citation: 'S1',
      title: '页面甲',
      content: '页面正文',
    });
  });
});

describe('resolveChatContext', () => {
  it('page 路径直接返回,不带 notice', async () => {
    const page = { title: 't', url: 'u', content: 'c' };
    const result = await resolveChatContext({ page }, '问题');
    expect(result.context).toBe(page);
    expect(result.notice).toBeUndefined();
  });

  it('clipId 路径按回退链取正文', async () => {
    const clip = makeClip({
      description: '描述',
      summary: '摘要',
      userNote: '备注',
    });
    const result = await resolveChatContext({ clipId: 'c1' }, '问题', {
      getClip: async () => clip,
    });
    expect(result.context.content).toBe('描述\n摘要\n备注');
  });

  it('clipId 已删除时抛错', async () => {
    await expect(
      resolveChatContext({ clipId: 'gone' }, '问题', {
        getClip: async () => undefined,
      }),
    ).rejects.toThrow('关联的收藏已被删除，无法继续对话');
  });

  it('无任何上下文时抛错', async () => {
    await expect(resolveChatContext({}, '问题')).rejects.toThrow(
      '会话缺少网页上下文',
    );
  });
});

describe('buildQuotePageContext', () => {
  const quote = {
    id: 'q1',
    kind: 'quote-chat',
    createdAt: '2026-01-01T00:00:00.000Z',
    tabId: 1,
    url: 'https://example.com/q',
    title: '引用页',
    text: '被引用的文字',
  } as never;
  const quoteUrl = 'https://example.com/q';
  const settings = { maxContentLength: 1000 } as never;

  it('标签页仍在原地址时采集页面', async () => {
    const result = await buildQuotePageContext(quote, settings, {
      getTab: async () => ({ url: quoteUrl }),
      extractPage: async () =>
        ({
          title: '引用页',
          url: quoteUrl,
          description: '描述',
          mainText: '正文',
        }) as never,
    });
    expect(result.context.content).toBe('描述\n正文');
    expect(result.notice).toBeUndefined();
  });

  it('标签页已跳转时回退并提示', async () => {
    const result = await buildQuotePageContext(quote, settings, {
      getTab: async () => ({ url: 'https://other.example.com' }),
      extractPage: async () => {
        throw new Error('不应被调用');
      },
    });
    expect(result.context.content).toBe('被引用的文字');
    expect(result.notice).toBe('原网页已关闭或已跳转，将只根据引用文字回答');
  });

  it('标签页已关闭(getTab 抛错)时回退并提示', async () => {
    const result = await buildQuotePageContext(quote, settings, {
      getTab: async () => {
        throw new Error('no tab');
      },
      extractPage: async () => {
        throw new Error('不应被调用');
      },
    });
    expect(result.context.title).toBe('引用页');
    expect(result.notice).toBe('原网页已关闭，将只根据引用文字回答');
  });
});

describe('buildUserMessageContent', () => {
  it('全部要素齐备时按顺序拼接', () => {
    expect(
      buildUserMessageContent({
        question: '问题',
        hasImage: true,
        picked: '选取文字',
        quoteText: '第一行\n第二行',
      }),
    ).toBe('[截图]\n\n【页面选取内容】\n选取文字\n\n> 第一行\n> 第二行\n\n问题');
  });

  it('只有问题时原样返回', () => {
    expect(
      buildUserMessageContent({ question: '问题', hasImage: false }),
    ).toBe('问题');
  });
});
