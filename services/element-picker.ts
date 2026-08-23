import { browser } from 'wxt/browser';
import { AppError } from '@/utils/errors';
import { isUnsupportedUrl } from '@/services/url-utils';
import {
  captureCurrentTabRegion,
  type CaptureTarget,
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

interface PickExecutionResult {
  beforeUrl: string;
  afterUrl: string;
  picked: RawPickedElement | null;
}

const PAGE_CHANGED_MESSAGE = '页面已发生变化，请重试';

function pageChangedError(): AppError {
  return new AppError('PAGE_EXTRACT_FAILED', PAGE_CHANGED_MESSAGE);
}

function toCaptureTarget(tab: Browser.tabs.Tab | undefined): CaptureTarget {
  if (typeof tab?.id !== 'number' || typeof tab.windowId !== 'number' || !tab.url) {
    throw new AppError('PAGE_EXTRACT_FAILED', '无法获取当前网页');
  }
  if (isUnsupportedUrl(tab.url)) {
    throw new AppError('UNSUPPORTED_PAGE');
  }
  if (tab.pendingUrl) {
    throw pageChangedError();
  }
  return { tabId: tab.id, windowId: tab.windowId, url: tab.url };
}

async function assertExpectedTab(target: CaptureTarget): Promise<void> {
  let tab: Browser.tabs.Tab;
  try {
    tab = await browser.tabs.get(target.tabId);
  } catch {
    throw pageChangedError();
  }
  if (
    tab.id !== target.tabId ||
    tab.windowId !== target.windowId ||
    tab.url !== target.url ||
    tab.pendingUrl ||
    !tab.active ||
    isUnsupportedUrl(target.url)
  ) {
    throw pageChangedError();
  }
}

function isViewportRegion(value: unknown): value is ViewportRegion {
  if (typeof value !== 'object' || value === null) return false;
  const region = value as Partial<ViewportRegion>;
  return (
    [
      region.left,
      region.top,
      region.width,
      region.height,
      region.viewportWidth,
      region.viewportHeight,
    ].every((part) => typeof part === 'number' && Number.isFinite(part)) &&
    (region.width ?? 0) > 0 &&
    (region.height ?? 0) > 0 &&
    (region.viewportWidth ?? 0) > 0 &&
    (region.viewportHeight ?? 0) > 0
  );
}

function readPickExecutionResult(
  value: unknown,
  expectedUrl: string,
): RawPickedElement | null {
  if (typeof value !== 'object' || value === null) {
    throw new AppError('PAGE_EXTRACT_FAILED');
  }
  const result = value as Partial<PickExecutionResult>;
  if (result.beforeUrl !== expectedUrl || result.afterUrl !== expectedUrl) {
    throw pageChangedError();
  }
  if (result.picked === null) return null;
  const picked = result.picked;
  if (
    !picked ||
    (picked.text !== undefined && typeof picked.text !== 'string') ||
    typeof picked.hasVisual !== 'boolean' ||
    !isViewportRegion(picked.region)
  ) {
    throw new AppError('PAGE_EXTRACT_FAILED');
  }
  return picked;
}

/**
 * 在当前标签页开启元素选取模式。提取可见文字；模型支持识图时，
 * 选中元素包含图片、图表或其他视觉内容会同时裁剪元素区域截图。
 */
export async function pickPageElement(
  maxLength: number,
  includeVisual: boolean,
  signal?: AbortSignal,
): Promise<PickedPageElement | null> {
  signal?.throwIfAborted();
  let tab: Browser.tabs.Tab | undefined;
  try {
    [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  } catch {
    throw new AppError('PAGE_EXTRACT_FAILED', '无法获取当前网页');
  }
  const target = toCaptureTarget(tab);
  await assertExpectedTab(target);
  signal?.throwIfAborted();

  const onAbort = () => {
    void cancelPageElementPick(target.tabId);
  };
  signal?.addEventListener('abort', onAbort, { once: true });

  let results: { result?: unknown }[];
  try {
    results = await browser.scripting.executeScript({
      target: { tabId: target.tabId },
      func: pickElementOnPage,
      args: [maxLength, target.url],
    });
  } catch {
    if (signal?.aborted) throw signal.reason;
    throw new AppError('PAGE_EXTRACT_FAILED');
  } finally {
    signal?.removeEventListener('abort', onAbort);
  }

  signal?.throwIfAborted();
  await assertExpectedTab(target);
  const picked = readPickExecutionResult(results[0]?.result, target.url);
  if (!picked) return null;

  return {
    text: picked.text,
    hasVisual: picked.hasVisual,
    image:
      includeVisual && picked.hasVisual
        ? await captureCurrentTabRegion(picked.region, target, signal)
        : undefined,
  };
}

async function cancelPageElementPick(tabId: number): Promise<void> {
  try {
    await browser.scripting.executeScript({
      target: { tabId },
      func: cancelElementPickOnPage,
    });
  } catch {
    // 页面已关闭/导航时 overlay 也已不再可见。
  }
}

function cancelElementPickOnPage(): void {
  const pageWindow = window as unknown as { __pagetroveCancelPicking?: () => void };
  pageWindow.__pagetroveCancelPicking?.();
}

function pickElementOnPage(
  maxLength: number,
  expectedUrl: string,
): Promise<PickExecutionResult> {
  const beforeUrl = location.href;
  if (beforeUrl !== expectedUrl) {
    return Promise.resolve({
      beforeUrl,
      afterUrl: location.href,
      picked: null,
    });
  }

  return new Promise((resolve) => {
    const finish = (picked: RawPickedElement | null) => {
      resolve({ beforeUrl, afterUrl: location.href, picked });
    };
    const pageWindow = window as unknown as {
      __pagetrovePicking?: boolean;
      __pagetroveCancelPicking?: () => void;
    };
    if (pageWindow.__pagetrovePicking) {
      finish(null);
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
      delete pageWindow.__pagetroveCancelPicking;
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
      if ([...element.querySelectorAll(visualSelector)].slice(0, 200).some(isVisible)) {
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
        finish(null);
        return;
      }

      const rect = element.getBoundingClientRect();
      const textSource =
        element instanceof HTMLElement ? element.innerText : (element.textContent ?? '');
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
      finish(result);
    };

    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      cleanup();
      finish(null);
    };

    pageWindow.__pagetroveCancelPicking = () => {
      cleanup();
      finish(null);
    };

    document.addEventListener('mousemove', onMove, true);
    document.addEventListener('click', onClick, true);
    document.addEventListener('mousedown', onSwallow, true);
    document.addEventListener('mouseup', onSwallow, true);
    document.addEventListener('keydown', onKey, true);
  });
}
