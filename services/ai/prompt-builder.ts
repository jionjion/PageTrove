import type { PageSnapshot } from '@/types/page-snapshot';
import type { ChatContext, OpenAIMessage } from '@/services/ai/provider';

/* ---------- 收藏整理(analyzePage) ---------- */

export const ANALYZE_SYSTEM_PROMPT = `你是一个"有趣网站收藏整理助手"。

你的任务是根据用户提供的网页快照，整理这个网站值得收藏的原因，并输出结构化 json 结果。

要求：

1. 只能依据输入内容，不得虚构网页功能。
2. 如果网页信息不足，应明确体现"信息不足"。
3. 摘要用于让用户快速了解这个收藏：说明网站是什么、有什么内容、为什么值得收藏，控制在100个汉字以内。
4. 标签输出3至5个。
5. 不要复述大段网页原文。
6. 不要输出Markdown。
7. 只输出符合下面结构的 json，不要输出其他内容：

{
  "summary": "摘要",
  "tags": ["标签1", "标签2", "标签3"],
  "confidence": 0.85
}

confidence 为0到1之间的小数。`;

export const ANALYZE_SYSTEM_PROMPT_WITH_CONTENT = `你是一个"有趣网站收藏整理助手"。

你的任务是根据用户提供的网页快照，整理这个网站值得收藏的原因，并输出结构化 json 结果。

要求：

1. 只能依据输入内容，不得虚构网页功能。
2. 如果网页信息不足，应明确体现"信息不足"。
3. 摘要用于让用户快速了解这个收藏：说明网站是什么、有什么内容、为什么值得收藏，控制在100个汉字以内。
4. 标签输出3至5个。
5. content 是必填字段，为清洗整理后的正文，绝对不能省略这个字段：
   - 删掉导航、菜单、广告、推荐位、相关文章、评论、页脚、订阅提示等噪音。
   - 正文的信息要完整保留：所有段落、章节、要点都要输出，不要概括压缩成摘要，也不要只输出开头。原文有多长，content 就应该差不多多长，长输出是预期内的。
   - 用 Markdown 还原文章结构：章节标题用 #/##/### ，列表用 - 或 1. ，表格用 Markdown 表格，代码用 \`\`\` 代码块，段落间空行分隔。
   - 表述尽量沿用原文，不要自己发挥。
   - 仅当正文本身很短或页面没有文章主体时，content 输出空字符串 ""。
6. summary 和 tags 不要输出 Markdown；content 使用 Markdown 格式。
7. 只输出符合下面结构的 json，不要输出其他内容：

{
  "summary": "摘要",
  "tags": ["标签1", "标签2", "标签3"],
  "content": "Markdown 格式的正文",
  "confidence": 0.85
}

confidence 为0到1之间的小数。`;

export function buildAnalyzeUserPrompt(
  snapshot: PageSnapshot,
  note: string,
): string {
  return `请整理下面的网页快照，输出 json。

网页标题：
${snapshot.title || '（无）'}

网页地址：
${snapshot.url}

网页描述：
${snapshot.description || '（无）'}

用户选中的内容：
${snapshot.selectedText || '（无）'}

网页正文：
${snapshot.mainText || '（无）'}

用户备注：
${note || '（无）'}`;
}

/* ---------- 网页对话(streamChat) ---------- */

const MULTI_SOURCE_PROMPT = `你是"拾页"的多来源研究助手。

1. 只根据提供的资料回答；资料不足时明确说明。
2. 每个来自资料的事实或结论，使用 [S1]、[S2] 标明来源。
3. 不得引用没有提供的来源，不得伪造引用。
4. 如果不同来源存在冲突，分别陈述并标明来源。
5. 可以做综合归纳，但要明确说明这是综合判断。
6. 回答使用中文，简洁清晰。
7. MCP 工具得到的新信息不能伪装成页面来源；如使用工具，应单独说明。`;

export function buildChatSystemPrompt(ctx: ChatContext): string {
  if (ctx.sources && ctx.sources.length > 0) {
    const blocks = ctx.sources.map(
      (source) =>
        `[${source.citation}]\n标题：${source.title}\n地址：${source.url}\n内容：\n${source.content || '（内容为空）'}`,
    );
    const unavailable =
      ctx.unavailableSources && ctx.unavailableSources.length > 0
        ? `\n\n注意：以下来源已失效，本次未提供其内容。历史对话中的引用编号可能与本次不同；请仅使用上面资料的编号标注，不要沿用历史回答里的编号，也不要再引用失效来源：${ctx.unavailableSources.join('、')}`
        : '';
    return `${MULTI_SOURCE_PROMPT}\n\n以下是本次可用的资料：\n\n${blocks.join('\n\n')}${unavailable}`;
  }

  return `你是"拾页"的网页问答助手。请基于下面的网页内容回答用户的问题。

要求：

1. 优先依据网页内容回答；网页内容中没有的信息要如实说明，不得编造。
2. 回答使用中文，简洁明了。
3. 可以结合常识做适度延伸，但要区分"网页内容"和"你的补充"。
4. 如果提供了 MCP 工具，可以在确有必要时主动调用；不要为了展示工具而调用。

网页标题：${ctx.title}
网页地址：${ctx.url}

网页内容：
${ctx.content || '（内容为空）'}`;
}

/** 只发送最近的若干轮，避免上下文无限增长。 */
export const MAX_HISTORY_MESSAGES = 12;

/**
 * 组装对话消息:system prompt + 截断后的历史;
 * 有截图时挂到最后一条 user 消息上(仅当次请求,不入库)。
 */
export function buildChatMessages(
  ctx: ChatContext,
  history: { role: 'user' | 'assistant'; content: string }[],
  imageDataUrl?: string,
): OpenAIMessage[] {
  const messages: OpenAIMessage[] = [
    { role: 'system', content: buildChatSystemPrompt(ctx) },
    ...history.slice(-MAX_HISTORY_MESSAGES).map(
      (message): OpenAIMessage => ({
        role: message.role,
        content: message.content,
      }),
    ),
  ];

  if (imageDataUrl) {
    for (let index = messages.length - 1; index >= 0; index--) {
      const message = messages[index];
      if (message.role !== 'user') continue;
      const text = typeof message.content === 'string' ? message.content : '';
      message.content = [
        { type: 'text', text },
        {
          type: 'image_url',
          image_url: { url: imageDataUrl, detail: 'high' },
        },
      ];
      break;
    }
  }

  return messages;
}
