// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EmptyState } from '@/components/EmptyState';
import type { EmptyStateArt } from '@/components/EmptyState';

afterEach(cleanup);

describe('统一空状态', () => {
  it('渲染标题、说明与可点击的行动按钮', () => {
    const onClick = vi.fn();
    render(
      <EmptyState
        art="history"
        title="还没有对话记录"
        description="围绕网页发起第一场对话吧"
        action={{ label: '发起新对话', onClick }}
      />,
    );
    expect(screen.getByText('还没有对话记录')).toBeTruthy();
    expect(screen.getByText('围绕网页发起第一场对话吧')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '发起新对话' }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('无 action 时不渲染按钮', () => {
    render(
      <EmptyState
        art="blocked"
        title="浏览器内部页面，无法收藏"
        description="切换到普通网页再来吧"
      />,
    );
    expect(screen.queryByRole('button')).toBeNull();
  });

  it.each<EmptyStateArt>(['history', 'clips', 'research', 'blocked', 'search'])(
    '插画 %s 渲染为装饰性 SVG',
    (art) => {
      const { container } = render(
        <EmptyState art={art} title="标题" description="说明" />,
      );
      const svg = container.querySelector('.chat-welcome-hero svg');
      expect(svg).not.toBeNull();
      expect(
        container.querySelector('.chat-welcome-hero')?.getAttribute('aria-hidden'),
      ).toBe('true');
    },
  );
});
