import { describe, expect, it } from 'vitest';
import {
  buildChatMessages,
  buildChatSystemPrompt,
  MAX_HISTORY_MESSAGES,
} from '@/services/ai/prompt-builder';
import type { ChatContext } from '@/services/ai/provider';

const pageCtx: ChatContext = {
  title: '页面标题',
  url: 'https://example.com',
  content: '页面正文',
};

const scopeCtx: ChatContext = {
  title: '探究',
  url: '',
  content: '',
  sources: [
    {
      id: 'a',
      citation: 'S1',
      title: '来源甲',
      url: 'https://a.example.com',
      content: '正文甲',
    },
  ],
};

describe('buildChatSystemPrompt', () => {
  it('单页模式嵌入标题/地址/正文', () => {
    const prompt = buildChatSystemPrompt(pageCtx);
    expect(prompt).toContain('网页标题：页面标题');
    expect(prompt).toContain('页面正文');
  });

  it('多来源模式按编号嵌入资料块', () => {
    const prompt = buildChatSystemPrompt(scopeCtx);
    expect(prompt).toContain('[S1]');
    expect(prompt).toContain('标题：来源甲');
    expect(prompt).not.toContain('已失效');
  });

  it('存在失效来源时追加提示', () => {
    const prompt = buildChatSystemPrompt({
      ...scopeCtx,
      unavailableSources: ['收藏乙（收藏已删除）'],
    });
    expect(prompt).toContain('以下来源已失效');
    expect(prompt).toContain('收藏乙（收藏已删除）');
  });
});

describe('buildChatMessages', () => {
  it('system + 历史,历史超限时只保留最近若干条', () => {
    const history = Array.from({ length: 20 }, (_, i) => ({
      role: (i % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
      content: `msg-${i}`,
    }));
    const messages = buildChatMessages(pageCtx, history);
    expect(messages[0].role).toBe('system');
    expect(messages).toHaveLength(1 + MAX_HISTORY_MESSAGES);
    expect(messages[1]).toMatchObject({ content: `msg-${20 - MAX_HISTORY_MESSAGES}` });
  });

  it('有截图时挂到最后一条 user 消息', () => {
    const messages = buildChatMessages(
      pageCtx,
      [
        { role: 'user', content: '第一问' },
        { role: 'assistant', content: '答' },
        { role: 'user', content: '第二问' },
      ],
      'data:image/png;base64,xxx',
    );
    const last = messages[messages.length - 1];
    expect(last.role).toBe('user');
    expect(last.content).toEqual([
      { type: 'text', text: '第二问' },
      {
        type: 'image_url',
        image_url: { url: 'data:image/png;base64,xxx', detail: 'high' },
      },
    ]);
    // 前面的 user 消息不受影响
    expect(messages[1]).toMatchObject({ content: '第一问' });
  });

  it('无截图时消息保持纯文本', () => {
    const messages = buildChatMessages(pageCtx, [
      { role: 'user', content: '问' },
    ]);
    expect(messages[1].content).toBe('问');
  });
});
