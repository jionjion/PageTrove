// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { App as AntApp } from 'antd';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SHORTCUTS, type ShortcutMap } from '@/types/shortcuts';
import { ShortcutSettings } from '@/components/ShortcutSettings';

afterEach(cleanup);

function setup(value: ShortcutMap = DEFAULT_SHORTCUTS) {
  const onChange = vi.fn();
  render(
    <AntApp>
      <ShortcutSettings value={value} onChange={onChange} />
    </AntApp>,
  );
  return { onChange };
}

function keycap(label: RegExp): HTMLElement {
  return screen.getByRole('button', { name: label });
}

describe('ShortcutSettings', () => {
  it('展示全部动作键位', () => {
    setup();
    expect(keycap(/一键收录快捷键/)).toBeTruthy();
    expect(keycap(/唤起侧边栏快捷键/)).toBeTruthy();
    expect(keycap(/收藏快捷键/)).toBeTruthy();
    // 双击绑定带「双击」标注
    expect(keycap(/唤起侧边栏快捷键/).textContent).toContain('双击');
  });

  it('点击键位进入录制,按下组合键即提交', () => {
    const { onChange } = setup();
    fireEvent.click(keycap(/一键收录快捷键/));
    expect(screen.getByText('按下快捷键…')).toBeTruthy();

    fireEvent.keyDown(window, { key: 'k', altKey: true });
    expect(onChange).toHaveBeenCalledTimes(1);
    const next = onChange.mock.calls[0][0] as ShortcutMap;
    expect(next['quick-save']).toEqual({ kind: 'combo', keys: 'Alt+K' });
    expect(screen.queryByText('按下快捷键…')).toBeNull();
  });

  it('与其他动作冲突时拒绝并提示,录制继续', () => {
    const { onChange } = setup();
    fireEvent.click(keycap(/一键收录快捷键/));
    fireEvent.keyDown(window, { key: 'n', altKey: true });
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toContain('与「新对话」冲突');

    // 换一个合法键位仍可提交
    fireEvent.keyDown(window, { key: 'k', altKey: true });
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('Shift 单独搭配被拒绝', () => {
    const { onChange } = setup();
    fireEvent.click(keycap(/一键收录快捷键/));
    fireEvent.keyDown(window, { key: 'k', shiftKey: true });
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toContain('Ctrl');
  });

  it('Esc 取消录制', () => {
    const { onChange } = setup();
    fireEvent.click(keycap(/一键收录快捷键/));
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.queryByText('按下快捷键…')).toBeNull();
  });

  it('录制双击修饰键', () => {
    const { onChange } = setup();
    fireEvent.click(keycap(/唤起侧边栏快捷键/));
    fireEvent.keyDown(window, { key: 'Control' });
    fireEvent.keyUp(window, { key: 'Control' });
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.keyDown(window, { key: 'Control' });
    fireEvent.keyUp(window, { key: 'Control' });
    expect(onChange).toHaveBeenCalledTimes(1);
    const next = onChange.mock.calls[0][0] as ShortcutMap;
    expect(next['open-panel']).toEqual({ kind: 'double', keys: 'Control' });
  });

  it('全部恢复默认', () => {
    const custom: ShortcutMap = {
      ...DEFAULT_SHORTCUTS,
      'quick-save': { kind: 'combo', keys: 'Alt+K' },
    };
    const { onChange } = setup(custom);
    fireEvent.click(screen.getByRole('button', { name: /全部恢复默认/ }));
    expect(onChange).toHaveBeenCalledWith(DEFAULT_SHORTCUTS);
  });
});
