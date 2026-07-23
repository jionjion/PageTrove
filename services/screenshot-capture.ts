import { browser } from 'wxt/browser';
import { AppError } from '@/utils/errors';
import { isUnsupportedUrl } from '@/services/url-utils';

export interface ViewportRegion {
  left: number;
  top: number;
  width: number;
  height: number;
  viewportWidth: number;
  viewportHeight: number;
}

export interface CapturedImage {
  dataUrl: string;
  width: number;
  height: number;
}

async function getActiveTab(): Promise<Browser.tabs.Tab> {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !tab.url) {
    throw new AppError('PAGE_EXTRACT_FAILED', '无法获取当前网页');
  }
  if (isUnsupportedUrl(tab.url)) {
    throw new AppError('UNSUPPORTED_PAGE');
  }
  return tab;
}

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('截图解码失败'));
    image.src = dataUrl;
  });
}

async function cropImage(
  screenshotUrl: string,
  region: ViewportRegion,
): Promise<CapturedImage> {
  const image = await loadImage(screenshotUrl);
  const scaleX = image.naturalWidth / region.viewportWidth;
  const scaleY = image.naturalHeight / region.viewportHeight;

  const sourceX = Math.max(0, Math.round(region.left * scaleX));
  const sourceY = Math.max(0, Math.round(region.top * scaleY));
  const sourceWidth = Math.min(
    image.naturalWidth - sourceX,
    Math.max(1, Math.round(region.width * scaleX)),
  );
  const sourceHeight = Math.min(
    image.naturalHeight - sourceY,
    Math.max(1, Math.round(region.height * scaleY)),
  );

  const maxDimension = 2_048;
  const outputScale = Math.min(
    1,
    maxDimension / Math.max(sourceWidth, sourceHeight),
  );
  const width = Math.max(1, Math.round(sourceWidth * outputScale));
  const height = Math.max(1, Math.round(sourceHeight * outputScale));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('无法创建截图画布');
  context.drawImage(
    image,
    sourceX,
    sourceY,
    sourceWidth,
    sourceHeight,
    0,
    0,
    width,
    height,
  );

  return {
    dataUrl: canvas.toDataURL('image/jpeg', 0.9),
    width,
    height,
  };
}

async function captureTabRegion(
  tab: Browser.tabs.Tab,
  region: ViewportRegion,
): Promise<CapturedImage> {
  const screenshot = await browser.tabs.captureVisibleTab(tab.windowId, {
    format: 'png',
  });
  return cropImage(screenshot, region);
}

export async function captureCurrentTabRegion(
  region: ViewportRegion,
): Promise<CapturedImage> {
  return captureTabRegion(await getActiveTab(), region);
}

/** 让用户在当前页面拖拽选择可见区域，完成后返回裁剪后的临时截图。 */
export async function captureSelectedRegion(): Promise<CapturedImage | null> {
  const tab = await getActiveTab();
  let results: { result?: unknown }[];
  try {
    results = await browser.scripting.executeScript({
      target: { tabId: tab.id! },
      func: selectRegionOnPage,
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new AppError(
      'PAGE_EXTRACT_FAILED',
      `无法开启截图框选，请刷新页面后重试（${detail}）`,
    );
  }

  const region = results[0]?.result as ViewportRegion | null | undefined;
  if (!region) return null;
  return captureTabRegion(tab, region);
}

function selectRegionOnPage(): Promise<ViewportRegion | null> {
  return new Promise((resolve) => {
    const pageWindow = window as unknown as { __pagetroveCropping?: boolean };
    if (pageWindow.__pagetroveCropping) {
      resolve(null);
      return;
    }
    pageWindow.__pagetroveCropping = true;

    const layer = document.createElement('div');
    layer.style.cssText = [
      'position:fixed',
      'inset:0',
      'z-index:2147483647',
      'cursor:crosshair',
      'background:rgba(0,0,0,.18)',
      'user-select:none',
      'touch-action:none',
    ].join(';');

    const selection = document.createElement('div');
    selection.style.cssText = [
      'position:absolute',
      'display:none',
      'border:2px solid #1677ff',
      'background:rgba(22,119,255,.12)',
      'box-shadow:0 0 0 99999px rgba(0,0,0,.18)',
      'pointer-events:none',
    ].join(';');
    layer.appendChild(selection);

    const tip = document.createElement('div');
    tip.textContent = '拖拽框选截图区域，Esc 取消';
    tip.style.cssText = [
      'position:absolute',
      'top:16px',
      'left:50%',
      'transform:translateX(-50%)',
      'padding:6px 12px',
      'border-radius:6px',
      'background:rgba(0,0,0,.75)',
      'color:#fff',
      'font:13px/1.5 system-ui,sans-serif',
      'pointer-events:none',
    ].join(';');
    layer.appendChild(tip);
    document.documentElement.appendChild(layer);

    let startX: number | undefined;
    let startY: number | undefined;
    let currentRegion: ViewportRegion | undefined;

    const cleanup = () => {
      document.removeEventListener('keydown', onKey, true);
      layer.remove();
      pageWindow.__pagetroveCropping = false;
    };

    const render = (x: number, y: number) => {
      if (startX === undefined || startY === undefined) return;
      const left = Math.max(0, Math.min(startX, x));
      const top = Math.max(0, Math.min(startY, y));
      const right = Math.min(innerWidth, Math.max(startX, x));
      const bottom = Math.min(innerHeight, Math.max(startY, y));
      currentRegion = {
        left,
        top,
        width: Math.max(0, right - left),
        height: Math.max(0, bottom - top),
        viewportWidth: innerWidth,
        viewportHeight: innerHeight,
      };
      selection.style.display = 'block';
      selection.style.left = `${left}px`;
      selection.style.top = `${top}px`;
      selection.style.width = `${currentRegion.width}px`;
      selection.style.height = `${currentRegion.height}px`;
    };

    layer.addEventListener(
      'mousedown',
      (event) => {
        event.preventDefault();
        event.stopPropagation();
        startX = event.clientX;
        startY = event.clientY;
        render(event.clientX, event.clientY);
      },
      true,
    );
    layer.addEventListener(
      'mousemove',
      (event) => {
        if (startX === undefined) return;
        event.preventDefault();
        render(event.clientX, event.clientY);
      },
      true,
    );
    layer.addEventListener(
      'mouseup',
      (event) => {
        if (startX === undefined) return;
        event.preventDefault();
        event.stopPropagation();
        render(event.clientX, event.clientY);
        const result = currentRegion;
        cleanup();
        resolve(
          result && result.width >= 8 && result.height >= 8 ? result : null,
        );
      },
      true,
    );

    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      cleanup();
      resolve(null);
    };
    document.addEventListener('keydown', onKey, true);
  });
}