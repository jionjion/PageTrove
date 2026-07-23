import { browser } from 'wxt/browser';
import { AppError } from '@/utils/errors';
import { isUnsupportedUrl } from '@/services/url-utils';
import {
  captureCurrentTabRegion,
  type CapturedImage,
  type ViewportRegion,
} from '@/services/screenshot-capture';

export interface PickedPageElement {
  text?: string;
  hasVisual: boolean;
  image?: CapturedImage;
}

interface RawPickedElement {
  text?: string;
  hasVisual: boolean;
  region: ViewportRegion;
}

/**
 * 在当前标签页开启元素选取模式。提取可见文字；模型支持识图时，
 * 选中元素包含图片、图表或其他视觉内容会同时裁剪元素区域截图。
 */
export async function pickPageElement(
  maxLength: number,
  includeVisual: boolean,
): Promise<PickedPageElement | null> {
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
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new AppError(
      'PAGE_EXTRACT_FAILED',
      `页面脚本注入失败，请刷新页面后重试（${detail}）`,
    );
  }

  const picked = results[0]?.result as RawPickedElement | null | undefined;
  if (!picked) return null;

  return {
    text: picked.text,
    hasVisual: picked.hasVisual,
    image:
      includeVisual && picked.hasVisual
        ? await captureCurrentTabRegion(picked.region)
        : undefined,
  };
}

function pickElementOnPage(maxLength: number): Promise<RawPickedElement | null> {
  return new Promise((resolve) => {
    const pageWindow = window as unknown as { __pagetrovePicking?: boolean };
    if (pageWindow.__pagetrovePicking) {
      resolve(null);
      return;
    }
    pageWindow.__pagetrovePicking = true;

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

    const onMove = (event: MouseEvent) => {
      const element = document.elementFromPoint(event.clientX, event.clientY);
      if (!element || element === current || element === overlay) return;
      current = element;
      const rect = element.getBoundingClientRect();
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
      pageWindow.__pagetrovePicking = false;
    };

    const onSwallow = (event: MouseEvent) => {
      event.preventDefault();
      event.stopPropagation();
    };

    const isVisible = (element: Element): boolean => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return (
        rect.width >= 2 &&
        rect.height >= 2 &&
        style.display !== 'none' &&
        style.visibility !== 'hidden' &&
        Number(style.opacity || '1') > 0
      );
    };

    const containsVisualContent = (element: Element): boolean => {
      const visualSelector = 'img,picture,canvas,svg,video';
      if (element.matches(visualSelector) && isVisible(element)) return true;
      if (
        [...element.querySelectorAll(visualSelector)]
          .slice(0, 200)
          .some(isVisible)
      ) {
        return true;
      }

      const candidates = [element, ...element.querySelectorAll('*')].slice(0, 300);
      return candidates.some((candidate) => {
        if (!isVisible(candidate)) return false;
        return getComputedStyle(candidate).backgroundImage !== 'none';
      });
    };

    const onClick = (event: MouseEvent) => {
      event.preventDefault();
      event.stopPropagation();
      const element = current;
      if (!element) {
        cleanup();
        resolve(null);
        return;
      }

      const rect = element.getBoundingClientRect();
      const textSource =
        element instanceof HTMLElement ? element.innerText : element.textContent ?? '';
      const text = textSource
        .replace(/[ \t]+/g, ' ')
        .replace(/\n{3,}/g, '\n\n')
        .trim()
        .slice(0, maxLength);
      const left = Math.max(0, rect.left);
      const top = Math.max(0, rect.top);
      const right = Math.min(innerWidth, rect.right);
      const bottom = Math.min(innerHeight, rect.bottom);
      const result: RawPickedElement = {
        text: text || undefined,
        hasVisual: containsVisualContent(element),
        region: {
          left,
          top,
          width: Math.max(1, right - left),
          height: Math.max(1, bottom - top),
          viewportWidth: innerWidth,
          viewportHeight: innerHeight,
        },
      };
      cleanup();
      resolve(result);
    };

    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      cleanup();
      resolve(null);
    };

    document.addEventListener('mousemove', onMove, true);
    document.addEventListener('click', onClick, true);
    document.addEventListener('mousedown', onSwallow, true);
    document.addEventListener('mouseup', onSwallow, true);
    document.addEventListener('keydown', onKey, true);
  });
}