// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChatEmptyState } from '@/components/chat/ChatEmptyState';

afterEach(cleanup);

describe('对话快捷问题', () => {
  it('将所选问题填入当前对话', () => {
    const onPreset = vi.fn();
    render(<ChatEmptyState hasScope={false} onPreset={onPreset} />);
    fireEvent.click(screen.getByRole('button', { name: '概括这篇内容' }));
    expect(onPreset).toHaveBeenCalledWith('概括这篇内容');
  });

  it('多来源会话显示适合比较的问题', () => {
    const onPreset = vi.fn();
    render(<ChatEmptyState hasScope onPreset={onPreset} />);
    fireEvent.click(screen.getByRole('button', { name: '比较这些页面的核心差异' }));
    expect(onPreset).toHaveBeenCalledWith('比较这些页面的核心差异');
    expect(screen.queryByRole('button', { name: '概括这篇内容' })).toBeNull();
  });
});
