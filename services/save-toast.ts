import { browser } from 'wxt/browser';

/**
 * 快捷键收录的页面内反馈:Shadow DOM 品牌提示条。
 * 侧边栏可能没有打开,反馈必须落在当前网页上;注入失败(内部页、PDF 等)
 * 降级为扩展图标 badge 短闪。
 */

export type SaveToastState = 'saving' | 'success' | 'duplicate' | 'error';

export interface SaveToastPayload {
  state: SaveToastState;
  /** 主文案,如「已收录 · 标题」 */
  title: string;
  /** 次文案,如「AI 整理中…」 */
  sub?: string;
}

/**
 * 注入页面执行的渲染函数。必须完全自包含:
 * executeScript 会序列化函数体,不能引用模块作用域的任何常量。
 */
function renderSaveToast(payload: SaveToastPayload): void {
  const HOST_ID = 'pagetrove-save-toast';
  const doc = document;
  const root = doc.body ?? doc.documentElement;
  if (!root) return;

  let host = doc.getElementById(HOST_ID) as
    (HTMLElement & { __ptHide?: number; __ptSafety?: number }) | null;
  if (!host) {
    host = doc.createElement('div') as HTMLElement & {
      __ptHide?: number;
      __ptSafety?: number;
    };
    host.id = HOST_ID;
    host.style.cssText =
      'position:fixed;right:20px;bottom:20px;z-index:2147483647;pointer-events:none;';
    host.attachShadow({ mode: 'open' });
    root.appendChild(host);
  }
  const shadow = host.shadowRoot;
  if (!shadow) return;

  if (host.__ptHide !== undefined) window.clearTimeout(host.__ptHide);
  if (host.__ptSafety !== undefined) window.clearTimeout(host.__ptSafety);

  const reduced =
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const gradients: Record<string, string> = {
    saving: 'linear-gradient(135deg,#0e7490,#0f766e 55%,#047857)',
    success: 'linear-gradient(135deg,#0e7490,#0f766e 55%,#047857)',
    duplicate: 'linear-gradient(135deg,#faad14,#fa8c16)',
    error: 'linear-gradient(135deg,#ff7875,#ff4d4f)',
  };
  const icons: Record<string, string> = {
    // 书签(收录中)
    saving:
      '<path d="M6 3.5h8a1 1 0 0 1 1 1V17l-5-3.2L5 17V4.5a1 1 0 0 1 1-1z" fill="none" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/>',
    // 对勾(已收录)
    success:
      '<path class="pt-check" d="M4.5 10.5l3.2 3.2 7.8-7.8" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
    // 实心书签(已在收藏中,鎏金)
    duplicate:
      '<path d="M6 3.5h8a1 1 0 0 1 1 1V17l-5-3.2L5 17V4.5a1 1 0 0 1 1-1z" fill="#fff"/>',
    // 感叹号(失败)
    error:
      '<path d="M10 4.5v7" stroke="#fff" stroke-width="2" stroke-linecap="round"/><circle cx="10" cy="15" r="1.2" fill="#fff"/>',
  };

  const anim = reduced
    ? ''
    : `
    @keyframes pt-in{from{opacity:0;transform:translateY(10px) scale(.97)}to{opacity:1;transform:none}}
    @keyframes pt-out{to{opacity:0;transform:translateY(6px) scale(.98)}}
    @keyframes pt-pulse{0%,100%{transform:scale(1)}50%{transform:scale(1.07)}}
    @keyframes pt-draw{from{stroke-dashoffset:22}to{stroke-dashoffset:0}}
    .pt-card{animation:pt-in .18s cubic-bezier(.2,.8,.3,1)}
    .pt-card.pt-leaving{animation:pt-out .16s ease forwards}
    .pt-chip.pt-saving{animation:pt-pulse 1.2s ease-in-out infinite}
    .pt-check{stroke-dasharray:22;animation:pt-draw .35s .1s ease backwards}
  `;

  const sub = payload.sub
    ? `<div style="font-size:11px;line-height:1.5;color:#8c8c8c;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeText(payload.sub)}</div>`
    : '';

  shadow.innerHTML = `
    <style>${anim}</style>
    <div class="pt-card" style="display:flex;align-items:center;gap:10px;min-width:200px;max-width:340px;padding:10px 14px 10px 10px;background:#fff;border:1px solid #ccfbf1;border-radius:12px;box-shadow:0 8px 24px rgba(15,118,110,.16),0 2px 6px rgba(15,118,110,.08);font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'PingFang SC','Hiragino Sans GB','Microsoft YaHei',sans-serif;">
      <div class="pt-chip ${payload.state === 'saving' ? 'pt-saving' : ''}" style="flex:none;width:32px;height:32px;border-radius:9px;display:grid;place-items:center;background:${gradients[payload.state] ?? gradients.success};">
        <svg width="19" height="19" viewBox="0 0 20 20" aria-hidden="true">${icons[payload.state] ?? icons.success}</svg>
      </div>
      <div style="min-width:0;">
        <div style="font-size:13px;font-weight:600;line-height:1.5;color:#262626;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeText(payload.title)}</div>
        ${sub}
      </div>
    </div>`;

  const card = shadow.querySelector('.pt-card') as HTMLElement | null;
  const dismiss = () => {
    if (!host || !host.isConnected) return;
    if (card && !reduced) {
      card.classList.add('pt-leaving');
      host.__ptHide = window.setTimeout(() => host?.remove(), 170);
    } else {
      host.remove();
    }
  };

  if (payload.state === 'saving') {
    // 兜底:若后续状态因异常没有到达,10s 后自行消失
    host.__ptSafety = window.setTimeout(dismiss, 10_000);
  } else {
    host.__ptHide = window.setTimeout(dismiss, payload.state === 'error' ? 3_600 : 2_600);
  }

  function escapeText(value: string): string {
    const div = doc.createElement('div');
    div.textContent = value;
    return div.innerHTML;
  }
}

const BADGE_TEXT: Record<SaveToastState, string> = {
  saving: '…',
  success: '✓',
  duplicate: '✓',
  error: '!',
};

const BADGE_COLOR: Record<SaveToastState, string> = {
  saving: '#0d9488',
  success: '#0f766e',
  duplicate: '#fa8c16',
  error: '#ff4d4f',
};

async function flashBadge(tabId: number, state: SaveToastState): Promise<void> {
  try {
    await browser.action.setBadgeBackgroundColor({ color: BADGE_COLOR[state], tabId });
    await browser.action.setBadgeText({ text: BADGE_TEXT[state], tabId });
    setTimeout(() => {
      void browser.action.setBadgeText({ text: '', tabId }).catch(() => {});
    }, 1_600);
  } catch {
    // badge 也失败时静默:收录结果本身不受反馈影响
  }
}

/** 在指定标签页展示收录反馈;注入失败自动降级 badge。 */
export async function showSaveToast(
  tabId: number,
  payload: SaveToastPayload,
): Promise<void> {
  try {
    await browser.scripting.executeScript({
      target: { tabId },
      func: renderSaveToast,
      args: [payload],
    });
  } catch {
    await flashBadge(tabId, payload.state);
  }
}
