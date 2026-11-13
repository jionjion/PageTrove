/**
 * 拾页品牌徽标:与产品图标(public/icon)同一几何——
 * 透明底 + 品牌渐变描边圆角六边形(线条) + 内部渐变书签(色块)。
 * 延续原版"轮廓+渐变实体"结构,无填充背景底,工具栏与白底头部都醒目。
 */
export function BrandMark({ size = 22 }: { size?: number }) {
  return (
    <svg
      className="app-brand-mark"
      width={size}
      height={size}
      viewBox="0 0 128 128"
      role="presentation"
      focusable="false"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="pt-brand-ring" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#0d9488" />
          <stop offset="100%" stopColor="#059669" />
        </linearGradient>
        <linearGradient id="pt-brand-mark" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#2dd4bf" />
          <stop offset="100%" stopColor="#059669" />
        </linearGradient>
      </defs>
      <polygon
        points="64,10 111,37 111,91 64,118 17,91 17,37"
        fill="none"
        stroke="url(#pt-brand-ring)"
        strokeWidth="9"
        strokeLinejoin="round"
      />
      <path
        d="M43 35A5 5 0 0 1 48 30H80A5 5 0 0 1 85 35V98L64 82L43 98Z"
        fill="url(#pt-brand-mark)"
      />
    </svg>
  );
}
