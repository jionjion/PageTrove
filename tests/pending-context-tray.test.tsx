// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PendingContextTray } from '@/components/PendingContextTray';
import type { CapturedImage } from '@/services/screenshot-capture';

// vitest 未开启 globals，需手动清理挂载的 DOM
afterEach(cleanup);

const image: CapturedImage = {
  dataUrl: 'data:image/png;base64,xxx',
  width: 320,
  height: 200,
};

describe('PendingContextTray（BUG-002 回归）', () => {
  it('无任何内容时不渲染', () => {
    const { container } = render(<PendingContextTray />);
    expect(container.firstChild).toBeNull();
  });

  it('仅引用时渲染单卡片与字数', () => {
    render(<PendingContextTray quote="引用文字" />);
    expect(screen.getByText('引用')).toBeTruthy();
    expect(screen.getByText('4 字')).toBeTruthy();
    expect(screen.getByText('引用文字')).toBeTruthy();
    expect(screen.queryByText('页面文字')).toBeNull();
    expect(screen.queryByText('截图')).toBeNull();
  });

  it('仅页面文字时渲染单卡片', () => {
    render(<PendingContextTray pickedText="选中的段落" />);
    expect(screen.getByText('页面文字')).toBeTruthy();
    expect(screen.getByText('5 字')).toBeTruthy();
  });

  it('仅截图时渲染缩略图与尺寸', () => {
    render(<PendingContextTray image={image} />);
    expect(screen.getByText('截图')).toBeTruthy();
    expect(screen.getByText('320×200')).toBeTruthy();
    const img = screen.getByAltText('待发送截图') as HTMLImageElement;
    expect(img.src).toBe(image.dataUrl);
  });

  it('三者同时存在时渲染三张卡片（组合不割裂）', () => {
    render(
      <PendingContextTray quote="甲段引文" pickedText="乙段文字" image={image} />,
    );
    expect(screen.getByText('引用')).toBeTruthy();
    expect(screen.getByText('页面文字')).toBeTruthy();
    expect(screen.getByText('截图')).toBeTruthy();
    expect(document.querySelectorAll('.pending-item')).toHaveLength(3);
  });

  it('每张卡片的移除按钮触发对应回调', () => {
    const onRemoveQuote = vi.fn();
    const onRemovePicked = vi.fn();
    const onRemoveImage = vi.fn();
    render(
      <PendingContextTray
        quote="甲段引文"
        pickedText="乙段文字"
        image={image}
        onRemoveQuote={onRemoveQuote}
        onRemovePicked={onRemovePicked}
        onRemoveImage={onRemoveImage}
      />,
    );

    fireEvent.click(screen.getByLabelText('移除引用'));
    expect(onRemoveQuote).toHaveBeenCalledTimes(1);
    expect(onRemovePicked).not.toHaveBeenCalled();

    fireEvent.click(screen.getByLabelText('移除页面文字'));
    expect(onRemovePicked).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByLabelText('移除截图'));
    expect(onRemoveImage).toHaveBeenCalledTimes(1);
  });
});
