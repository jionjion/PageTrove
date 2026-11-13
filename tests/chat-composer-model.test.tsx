// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { ChatComposer } from '@/components/chat/ChatComposer';
import type { ModelOptionGroup } from '@/hooks/useChatController';

afterEach(cleanup);

beforeAll(() => {
  // antd 浮层所需的 jsdom 补丁(与 current-page-view 测试同源)
  Object.defineProperty(globalThis, 'ResizeObserver', {
    writable: true,
    value: class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  });
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
});

const modelOptions: ModelOptionGroup[] = [
  {
    label: 'OpenAI',
    title: 'OpenAI',
    options: [
      { value: 'openai::gpt-5', label: 'gpt-5' },
      { value: 'openai::gpt-5-mini', label: 'gpt-5-mini' },
    ],
  },
  {
    label: '智谱',
    title: '智谱',
    options: [{ value: 'zhipu::glm-5.2', label: 'glm-5.2' }],
  },
];

function renderComposer(model = 'openai::gpt-5') {
  const onModelChange = vi.fn();
  render(
    <ChatComposer
      input=""
      busy={false}
      picking={false}
      capturing={false}
      visionEnabled
      model={model}
      modelOptions={modelOptions}
      awayFromBottom={false}
      canRefreshPage={false}
      refreshPagePending={false}
      onInputChange={() => {}}
      onSend={() => {}}
      onStop={() => {}}
      onPick={() => {}}
      onCapture={() => {}}
      onModelChange={onModelChange}
      onScrollToBottom={() => {}}
      onToggleRefreshPage={() => {}}
    />,
  );
  return { onModelChange };
}

/** 打开级联面板(BaseSelect 由 mouseDown 触发)。 */
async function openCascader() {
  fireEvent.mouseDown(screen.getByRole('combobox'));
  await screen.findByText('智谱');
}

describe('ChatComposer 模型两级选择', () => {
  it('触发器只显示当前模型名', () => {
    renderComposer();
    expect(screen.getByText('gpt-5')).toBeTruthy();
    expect(screen.queryByText('openai::gpt-5')).toBeNull();
  });

  it('一级为供应商,悬停后二级模型列出现在右侧', async () => {
    renderComposer();
    await openCascader();

    fireEvent.mouseOver(screen.getByText('智谱'));
    await waitFor(() => {
      const columns = document.querySelectorAll('.ant-cascader-menu');
      expect(columns).toHaveLength(2);
      // 第二列(右侧)只包含该供应商的模型
      expect(columns[1].textContent).toContain('glm-5.2');
      expect(columns[1].textContent).not.toContain('gpt-5');
    });
  });

  it('切换供应商时替换右侧模型列', async () => {
    renderComposer();
    await openCascader();

    fireEvent.mouseOver(screen.getByText('智谱'));
    await screen.findByText('glm-5.2');

    fireEvent.mouseOver(screen.getByText('OpenAI'));
    await waitFor(() => {
      const columns = document.querySelectorAll('.ant-cascader-menu');
      expect(columns).toHaveLength(2);
      expect(columns[1].textContent).toContain('gpt-5-mini');
      expect(columns[1].textContent).not.toContain('glm-5.2');
    });
  });

  it('点击二级模型回传完整 provider::model 键', async () => {
    const { onModelChange } = renderComposer();
    await openCascader();

    fireEvent.mouseOver(screen.getByText('智谱'));
    fireEvent.click(await screen.findByText('glm-5.2'));
    expect(onModelChange).toHaveBeenCalledWith('zhipu::glm-5.2');
  });
});
