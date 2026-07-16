import { browser } from 'wxt/browser';
import { AppError } from '@/utils/errors';
import { isUnsupportedUrl } from '@/services/url-utils';

/**
 * 在当前标签页开启"元素选取"模式（类似 F12 的选择元素）。
 * 用户悬停高亮、点击选中某个元素，返回其可见文本；按 Esc 取消返回 null。
 */
export async function pickPageElement(
  maxLength: number,
): Promise<string | null> {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });

  if (!tab?.id || !tab.url) {
    throw new AppError('PAGE_EXTRACT_FAILED', '无法获取当前网页');
  }
  if (isUnsupportedUrl(tab.url)) {
    throw new AppError('UNSUPPORTED_PAGE');
  }

  let results: { result?: unknown }[];
  try {
    results = await browser.scripting.executeScript({
      target: { tabId: tab.id },
      func: pickElementOnPage,
      args: [maxLength],
    });
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    throw new AppError(
      'PAGE_EXTRACT_FAILED',
      `页面脚本注入失败，请刷新页面后重试（${detail}）`,
    );
  }

  const picked = results[0]?.result as { text: string } | null | undefined;
  return picked?.text ?? null;
}

/**
 * 在页面上下文中执行：高亮悬停元素，点击选中后返回其文本。
 * executeScript 会等待返回的 Promise 完成。
 */
function pickElementOnPage(maxLength: number): Promise<{ text: string } | null> {
  return new Promise((resolve) => {
    const w = window as unknown as { __pagetrovePicking?: boolean };
    if (w.__pagetrovePicking) {
      resolve(null);
      return;
    }
    w.__pagetrovePicking = true;

    // 高亮遮罩：pointer-events:none，不影响 elementFromPoint
    const overlay = document.createElement('div');
    overlay.style.cssText = [
      'position:fixed',
      'z-index:2147483647',
      'pointer-events:none',
      'background:rgba(22,119,255,.12)',
      'outline:2px solid #1677ff',
      'border-radius:2px',
      'display:none',
      'transition:all .05s ease-out',
    ].join(';');
    document.documentElement.appendChild(overlay);

    let current: Element | null = null;

    const onMove = (e: MouseEvent) => {
      const el = document.elementFromPoint(e.clientX, e.clientY);
      if (!el || el === current) return;
      current = el;
      const rect = el.getBoundingClientRect();
      overlay.style.display = 'block';
      overlay.style.left = `${rect.left}px`;
      overlay.style.top = `${rect.top}px`;
      overlay.style.width = `${rect.width}px`;
      overlay.style.height = `${rect.height}px`;
    };

    const cleanup = () => {
      document.removeEventListener('mousemove', onMove, true);
      document.removeEventListener('click', onClick, true);
      document.removeEventListener('mousedown', onSwallow, true);
      document.removeEventListener('mouseup', onSwallow, true);
      document.removeEventListener('keydown', onKey, true);
      overlay.remove();
      w.__pagetrovePicking = false;
    };

    // 阻止选取时误触发页面自身的按下/抬起行为
    const onSwallow = (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
    };

    const onClick = (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const el = current;
      cleanup();
      const text = ((el as HTMLElement | null)?.innerText ?? '')
        .replace(/\s+\n/g, '\n')
        .trim()
        .slice(0, maxLength);
      resolve(text ? { text } : null);
    };

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        cleanup();
        resolve(null);
      }
    };

    document.addEventListener('mousemove', onMove, true);
    document.addEventListener('click', onClick, true);
    document.addEventListener('mousedown', onSwallow, true);
    document.addEventListener('mouseup', onSwallow, true);
    document.addEventListener('keydown', onKey, true);
  });
}
