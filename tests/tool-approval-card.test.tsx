// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ToolApprovalCard } from '@/components/chat/ToolApprovalCard';

Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

afterEach(cleanup);

describe('ToolApprovalCard', () => {
  it('展示风险、脱敏参数和两个明确的一次性操作', () => {
    render(
      <ToolApprovalCard
        request={{
          requestId: 'request-1',
          toolCallId: 'call-1',
          serverId: 'server-1',
          serverName: '<不可信服务>',
          toolName: 'send_email',
          description: '<script>不会作为 HTML 执行</script>',
          argumentsPreview: '{"to":"a@example.com","apiKey":"[已脱敏]"}',
          risk: {
            level: 'high',
            reasons: ['服务未声明工具风险信息'],
            requiresApproval: true,
          },
        }}
        onApprove={vi.fn()}
        onDeny={vi.fn()}
      />,
    );

    expect(screen.getByText('服务未声明工具风险信息')).toBeTruthy();
    expect(screen.getByText('<不可信服务>')).toBeTruthy();
    expect(screen.getByText('<script>不会作为 HTML 执行</script>')).toBeTruthy();
    expect(screen.getByRole('button', { name: '拒绝本次' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '允许本次调用' })).toBeTruthy();
    expect(document.querySelector('script')).toBeNull();
  });

  it('快速重复点击只会提交一次', () => {
    const onApprove = vi.fn();
    render(
      <ToolApprovalCard
        request={{
          requestId: 'request-2',
          toolCallId: 'call-2',
          serverId: 'server-1',
          serverName: '服务',
          toolName: 'read',
          argumentsPreview: '{}',
          risk: {
            level: 'low',
            reasons: ['服务声明为低风险'],
            requiresApproval: true,
          },
        }}
        onApprove={onApprove}
        onDeny={vi.fn()}
      />,
    );
    const button = screen.getByRole('button', { name: '允许本次调用' });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(onApprove).toHaveBeenCalledTimes(1);
  });
});
