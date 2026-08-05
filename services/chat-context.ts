import { browser } from 'wxt/browser';
import type { ChatScope } from '@/types/chat';
import type { QuoteChatIntent } from '@/types/chat-intent';
import type { ExtensionSettings } from '@/types/settings';
import type { ChatContext, ResolvedChatSource } from '@/services/ai/provider';
import { getClip } from '@/services/clip-store';
import { selectRelevantExcerpt, sourceBudget } from '@/services/content-excerpts';
import { extractPage } from '@/services/page-extractor';
import { AppError } from '@/utils/errors';

/** 上下文解析结果;notice 为需要展示给用户的提示(undefined 表示应清除现有提示)。 */
export interface ResolvedContextResult {
  context: ChatContext;
  notice?: string;
}

interface ScopeContextDeps {
  getClip: typeof getClip;
}

const defaultScopeDeps: ScopeContextDeps = { getClip };

export function scopeTitle(scope: ChatScope): string {
  return scope.mode === 'tabs'
    ? `探究 · ${scope.sources.length} 个网页`
    : `探究 · ${scope.sources.length} 条收藏`;
}

/** 将 scope 解析为多来源上下文;clip 来源实时读取正文,缺失时按回退链处理。 */
export async function resolveScopeContext(
  scope: ChatScope,
  question: string,
  deps: ScopeContextDeps = defaultScopeDeps,
): Promise<ResolvedContextResult> {
  const skipped: string[] = [];
  const resolved: ResolvedChatSource[] = [];

  for (const source of scope.sources) {
    if (source.type === 'page') {
      resolved.push({
        id: source.id,
        citation: '',
        title: source.title,
        url: source.url,
        content: source.content,
      });
      continue;
    }
    const clip = await deps.getClip(source.clipId);
    if (!clip) {
      skipped.push(`${source.title}（收藏已删除）`);
      continue;
    }
    const content =
      clip.extractedText ||
      clip.selectedText ||
      clip.description ||
      clip.summary ||
      clip.userNote ||
      '';
    if (!content.trim()) {
      skipped.push(`${clip.title}（没有可用于问答的正文）`);
      continue;
    }
    resolved.push({
      id: source.id,
      citation: '',
      title: clip.title,
      url: clip.url,
      content,
    });
  }

  if (resolved.length === 0) {
    throw new AppError('AI_ANALYZE_FAILED', '选中的收藏已被删除或没有可用正文');
  }

  const budget = sourceBudget(resolved.length);
  const sources = resolved.map((source, index) => ({
    ...source,
    citation: `S${index + 1}`,
    content: selectRelevantExcerpt(source.content, question, budget),
  }));

  return {
    context: {
      title: scopeTitle(scope),
      url: '',
      content: '',
      sources,
      unavailableSources: skipped.length > 0 ? skipped : undefined,
    },
    notice:
      skipped.length > 0 ? `已跳过不可用来源：${skipped.join('、')}` : undefined,
  };
}

/**
 * 解析会话上下文。scope 路径的结果 notice 需无条件应用(含清除);
 * page/clipId 路径不涉及 notice。
 */
export async function resolveChatContext(
  value: {
    clipId?: string;
    page?: ChatContext;
    scope?: ChatScope;
  },
  question: string,
  deps: ScopeContextDeps = defaultScopeDeps,
): Promise<ResolvedContextResult> {
  if (value.scope) return resolveScopeContext(value.scope, question, deps);
  if (value.page) return { context: value.page };
  if (value.clipId) {
    const clip = await deps.getClip(value.clipId);
    if (!clip) {
      throw new AppError('SAVE_FAILED', '关联的收藏已被删除，无法继续对话');
    }
    return {
      context: {
        title: clip.title,
        url: clip.url,
        content:
          clip.extractedText ||
          [clip.description, clip.summary, clip.userNote]
            .filter(Boolean)
            .join('\n'),
      },
    };
  }
  throw new AppError('AI_ANALYZE_FAILED', '会话缺少网页上下文');
}

interface QuoteContextDeps {
  getTab: (tabId: number) => Promise<{ url?: string }>;
  extractPage: typeof extractPage;
}

const defaultQuoteDeps: QuoteContextDeps = {
  getTab: (tabId) => browser.tabs.get(tabId),
  extractPage,
};

/**
 * 为右键引用会话构建页面上下文：优先采集原标签页；
 * 标签页已关闭、已导航或无法采集时，回退为"标题 + URL + 引用文字"。
 * 结果 notice 仅在回退时存在,调用方只在有值时展示。
 */
export async function buildQuotePageContext(
  quote: QuoteChatIntent,
  settings: ExtensionSettings,
  deps: QuoteContextDeps = defaultQuoteDeps,
): Promise<ResolvedContextResult> {
  const fallback: ChatContext = {
    title: quote.title || '引用内容',
    url: quote.url,
    content: quote.text,
  };
  try {
    const tab = await deps.getTab(quote.tabId);
    if (!tab.url || tab.url !== quote.url) {
      // 标签页已导航到其他地址：不读取新页面。
      return {
        context: fallback,
        notice: '原网页已关闭或已跳转，将只根据引用文字回答',
      };
    }
    const snapshot = await deps.extractPage(
      {
        maxContentLength: settings.maxContentLength,
        includeSelectedText: false,
      },
      quote.tabId,
    );
    return {
      context: {
        title: snapshot.title,
        url: snapshot.url,
        content: [snapshot.description, snapshot.mainText]
          .filter(Boolean)
          .join('\n'),
      },
    };
  } catch {
    return { context: fallback, notice: '原网页已关闭，将只根据引用文字回答' };
  }
}

/** 拼接用户消息正文:截图占位 + 页面选取 + 引用块 + 问题。 */
export function buildUserMessageContent(input: {
  question: string;
  hasImage: boolean;
  picked?: string;
  quoteText?: string;
}): string {
  return [
    input.hasImage ? '[截图]' : undefined,
    input.picked ? `【页面选取内容】\n${input.picked}` : undefined,
    input.quoteText
      ? input.quoteText
          .split('\n')
          .map((line) => `> ${line}`)
          .join('\n')
      : undefined,
    input.question,
  ]
    .filter(Boolean)
    .join('\n\n');
}
