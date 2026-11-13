import type { ReactNode } from 'react';

/**
 * 空状态品牌插画集:与对话欢迎页(ChatEmptyState)同一视觉语言——
 * 光晕 + 投影 + 层叠纸页 + 青碧→翡翠渐变 + 鎏金点缀 + 闪烁星光。
 * 各视图常驻挂载(仅切换显示),渐变/滤镜 id 必须按插画独立前缀,避免跨 SVG 引用冲突。
 */

const SPARK_PATH =
  'M0 -7C0.8 -2.5 2.5 -0.8 7 0C2.5 0.8 0.8 2.5 0 7C-0.8 2.5 -2.5 0.8 -7 0C-2.5 -0.8 -0.8 -2.5 0 -7Z';

/** 四角星光,错峰闪烁。 */
function Sparkle({
  x,
  y,
  s = 1,
  color,
  delay = 0,
}: {
  x: number;
  y: number;
  s?: number;
  color: string;
  delay?: number;
}) {
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`}>
      <path
        className="empty-state-spark"
        style={delay ? { animationDelay: `${delay}s` } : undefined}
        d={SPARK_PATH}
        fill={color}
      />
    </g>
  );
}

/** 统一画框:光晕、地面投影与柔和阴影滤镜。 */
function ArtFrame({ prefix, children }: { prefix: string; children: ReactNode }) {
  return (
    <svg viewBox="0 0 200 150" role="presentation" focusable="false">
      <defs>
        <radialGradient id={`${prefix}-halo`} cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#0d9488" stopOpacity="0.14" />
          <stop offset="100%" stopColor="#0d9488" stopOpacity="0" />
        </radialGradient>
        <radialGradient id={`${prefix}-shadow`} cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#0f766e" stopOpacity="0.18" />
          <stop offset="100%" stopColor="#0f766e" stopOpacity="0" />
        </radialGradient>
        <filter id={`${prefix}-soft`} x="-30%" y="-30%" width="160%" height="160%">
          <feDropShadow
            dx="0"
            dy="3"
            stdDeviation="5"
            floodColor="#0f766e"
            floodOpacity="0.12"
          />
        </filter>
      </defs>
      <circle cx="100" cy="72" r="62" fill={`url(#${prefix}-halo)`} />
      <ellipse cx="100" cy="133" rx="58" ry="9" fill={`url(#${prefix}-shadow)`} />
      {children}
    </svg>
  );
}

/** 历史:层叠对话气泡 + 时钟徽标。 */
export function HistoryArt() {
  return (
    <ArtFrame prefix="pth">
      <defs>
        <linearGradient id="pth-user" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#0d9488" />
          <stop offset="100%" stopColor="#059669" />
        </linearGradient>
        <linearGradient id="pth-badge" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#0d9488" />
          <stop offset="100%" stopColor="#059669" />
        </linearGradient>
      </defs>

      {/* 底层记录页 */}
      <g transform="rotate(-7 100 75)">
        <rect
          x="58"
          y="28"
          width="84"
          height="100"
          rx="9"
          fill="#ffffff"
          stroke="#ccfbf1"
        />
        <rect x="70" y="40" width="40" height="5" rx="2.5" fill="#d5efe9" />
        <rect x="70" y="50" width="60" height="5" rx="2.5" fill="#d5efe9" />
      </g>

      {/* 助手气泡 */}
      <g filter="url(#pth-soft)">
        <rect
          x="64"
          y="44"
          width="64"
          height="28"
          rx="9"
          fill="#f0fdfa"
          stroke="#ccfbf1"
        />
        <path
          d="M74 72l-6 8 12-3Z"
          fill="#f0fdfa"
          stroke="#ccfbf1"
          strokeLinejoin="round"
        />
        <rect x="72" y="52" width="44" height="4" rx="2" fill="#5eead4" />
        <rect x="72" y="60" width="32" height="4" rx="2" fill="#99f6e4" />
      </g>

      {/* 用户气泡 */}
      <g filter="url(#pth-soft)">
        <rect x="86" y="80" width="56" height="24" rx="9" fill="url(#pth-user)" />
        <path d="M132 104l7 7-1-8Z" fill="url(#pth-user)" />
        <rect x="94" y="88" width="40" height="4" rx="2" fill="#ffffff" opacity="0.9" />
        <rect x="94" y="96" width="26" height="4" rx="2" fill="#ffffff" opacity="0.6" />
      </g>

      {/* 时钟徽标 */}
      <circle
        cx="142"
        cy="118"
        r="14"
        fill="url(#pth-badge)"
        stroke="#ffffff"
        strokeWidth="2.5"
      />
      <circle cx="142" cy="118" r="6.5" fill="none" stroke="#ffffff" strokeWidth="1.6" />
      <path
        d="M142 114.5v3.5l2.6 1.8"
        fill="none"
        stroke="#ffffff"
        strokeWidth="1.6"
        strokeLinecap="round"
      />

      <Sparkle x={36} y={40} color="#059669" />
      <Sparkle x={170} y={44} s={0.8} color="#faad14" delay={0.7} />
      <Sparkle x={176} y={96} s={0.6} color="#13c2c2" delay={1.3} />
      <Sparkle x={28} y={96} s={0.55} color="#0d9488" delay={1.9} />
      <circle cx="160" cy="24" r="2" fill="#5eead4" />
      <circle cx="44" cy="118" r="2" fill="#6ee7b7" />
    </ArtFrame>
  );
}

/** 收藏:文件夹里拾起的书页 + 金星。 */
export function ClipsArt() {
  return (
    <ArtFrame prefix="ptc">
      <defs>
        <linearGradient id="ptc-folder" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#5eead4" />
          <stop offset="100%" stopColor="#0d9488" />
        </linearGradient>
        <linearGradient id="ptc-star" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#ffd666" />
          <stop offset="100%" stopColor="#fa8c16" />
        </linearGradient>
        <radialGradient id="ptc-glow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#faad14" stopOpacity="0.35" />
          <stop offset="100%" stopColor="#faad14" stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* 文件夹背板 */}
      <rect x="52" y="62" width="96" height="60" rx="8" fill="#ccfbf1" />
      <path d="M52 70v-4a6 6 0 0 1 6-6h22l8 10Z" fill="#99f6e4" />

      {/* 拾起的书页 */}
      <g transform="rotate(-8 90 66)">
        <rect
          x="64"
          y="36"
          width="52"
          height="64"
          rx="6"
          fill="#ffffff"
          stroke="#ccfbf1"
        />
        <rect x="72" y="46" width="30" height="5" rx="2.5" fill="#5eead4" />
        <rect x="72" y="56" width="36" height="4" rx="2" fill="#d5efe9" />
        <rect x="72" y="64" width="28" height="4" rx="2" fill="#d5efe9" />
      </g>
      <g transform="rotate(6 114 64)" filter="url(#ptc-soft)">
        <rect
          x="88"
          y="32"
          width="52"
          height="66"
          rx="6"
          fill="#ffffff"
          stroke="#99f6e4"
        />
        <rect x="96" y="42" width="28" height="5" rx="2.5" fill="url(#ptc-folder)" />
        <rect x="96" y="52" width="36" height="4" rx="2" fill="#d5efe9" />
        <rect x="96" y="60" width="30" height="4" rx="2" fill="#d5efe9" />
        <rect x="96" y="68" width="34" height="4" rx="2" fill="#d5efe9" />
      </g>

      {/* 文件夹前袋 */}
      <g filter="url(#ptc-soft)">
        <path
          d="M52 84h96l-6 38a8 8 0 0 1-8 7H66a8 8 0 0 1-8-7Z"
          fill="url(#ptc-folder)"
        />
        <path d="M52 84h96l-1.5 9h-93Z" fill="#ffffff" opacity="0.18" />
      </g>

      {/* 金星 */}
      <circle cx="100" cy="26" r="20" fill="url(#ptc-glow)" />
      <g transform="translate(100 26)">
        <path
          className="empty-state-star"
          d="M0 -13L3.2 -4.4 12.4 -4 5.2 1.7 7.6 10.5 0 5.5 -7.6 10.5 -5.2 1.7 -12.4 -4 -3.2 -4.4Z"
          fill="url(#ptc-star)"
          stroke="#ffffff"
          strokeWidth="1.5"
          strokeLinejoin="round"
        />
      </g>

      <Sparkle x={36} y={44} color="#059669" />
      <Sparkle x={172} y={50} s={0.8} color="#0d9488" delay={0.7} />
      <Sparkle x={176} y={100} s={0.6} color="#faad14" delay={1.3} />
      <Sparkle x={28} y={100} s={0.55} color="#13c2c2" delay={1.9} />
      <circle cx="158" cy="26" r="2" fill="#5eead4" />
      <circle cx="42" cy="120" r="2" fill="#6ee7b7" />
    </ArtFrame>
  );
}

/** 探究:多页来源 + 放大镜。 */
export function ResearchArt() {
  return (
    <ArtFrame prefix="ptr">
      <defs>
        <linearGradient id="ptr-rim" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#0d9488" />
          <stop offset="100%" stopColor="#059669" />
        </linearGradient>
        <radialGradient id="ptr-lens" cx="42%" cy="38%" r="70%">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.9" />
          <stop offset="100%" stopColor="#99f6e4" stopOpacity="0.45" />
        </radialGradient>
      </defs>

      {/* 扇形展开的来源页 */}
      <g transform="rotate(-10 76 76)">
        <rect
          x="48"
          y="40"
          width="56"
          height="72"
          rx="7"
          fill="#ffffff"
          stroke="#ccfbf1"
        />
        <rect x="56" y="50" width="30" height="5" rx="2.5" fill="#99f6e4" />
        <rect x="56" y="60" width="40" height="4" rx="2" fill="#d5efe9" />
        <rect x="56" y="68" width="34" height="4" rx="2" fill="#d5efe9" />
      </g>
      <g transform="rotate(10 124 76)">
        <rect
          x="96"
          y="40"
          width="56"
          height="72"
          rx="7"
          fill="#ffffff"
          stroke="#ccfbf1"
        />
        <rect x="104" y="50" width="30" height="5" rx="2.5" fill="#6ee7b7" />
        <rect x="104" y="60" width="40" height="4" rx="2" fill="#d5efe9" />
        <rect x="104" y="68" width="34" height="4" rx="2" fill="#d5efe9" />
      </g>
      <g filter="url(#ptr-soft)">
        <rect
          x="72"
          y="34"
          width="56"
          height="78"
          rx="7"
          fill="#ffffff"
          stroke="#99f6e4"
        />
        <rect x="80" y="44" width="32" height="5" rx="2.5" fill="url(#ptr-rim)" />
        <rect x="80" y="54" width="40" height="4" rx="2" fill="#d5efe9" />
        <rect x="80" y="62" width="34" height="4" rx="2" fill="#d5efe9" />
        <rect x="80" y="70" width="38" height="4" rx="2" fill="#d5efe9" />
      </g>

      {/* 放大镜 */}
      <g filter="url(#ptr-soft)">
        <line
          x1="138"
          y1="106"
          x2="152"
          y2="120"
          stroke="url(#ptr-rim)"
          strokeWidth="7"
          strokeLinecap="round"
        />
        <circle
          cx="120"
          cy="88"
          r="25"
          fill="url(#ptr-lens)"
          stroke="url(#ptr-rim)"
          strokeWidth="5"
        />
        <path
          d="M106 78a18 18 0 0 1 10-8"
          fill="none"
          stroke="#ffffff"
          strokeWidth="3"
          strokeLinecap="round"
          opacity="0.85"
        />
        <path
          d="M113 88l5 5 9-10"
          fill="none"
          stroke="url(#ptr-rim)"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </g>

      <Sparkle x={36} y={36} color="#faad14" />
      <Sparkle x={172} y={40} s={0.8} color="#059669" delay={0.7} />
      <Sparkle x={178} y={92} s={0.6} color="#13c2c2" delay={1.3} />
      <Sparkle x={28} y={92} s={0.55} color="#0d9488" delay={1.9} />
      <circle cx="160" cy="22" r="2" fill="#5eead4" />
      <circle cx="40" cy="116" r="2" fill="#6ee7b7" />
    </ArtFrame>
  );
}

/** 受限:浏览器窗口 + 锁形徽标(内部页面不可收藏)。 */
export function BlockedArt() {
  return (
    <ArtFrame prefix="ptb">
      <defs>
        <linearGradient id="ptb-lock" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#ffd666" />
          <stop offset="100%" stopColor="#fa8c16" />
        </linearGradient>
      </defs>

      {/* 浏览器窗口 */}
      <g filter="url(#ptb-soft)">
        <rect
          x="52"
          y="34"
          width="96"
          height="88"
          rx="10"
          fill="#ffffff"
          stroke="#d9d9d9"
        />
        <path d="M52 44a10 10 0 0 1 10-10h76a10 10 0 0 1 10 10v8H52Z" fill="#f7f6f3" />
        <circle cx="62" cy="43" r="2.5" fill="#ff7875" />
        <circle cx="72" cy="43" r="2.5" fill="#ffc53d" />
        <circle cx="82" cy="43" r="2.5" fill="#95de64" />
        <rect
          x="92"
          y="39"
          width="48"
          height="8"
          rx="4"
          fill="#ffffff"
          stroke="#e8e8e8"
        />
        <rect x="62" y="62" width="76" height="5" rx="2.5" fill="#f0f0f0" />
        <rect x="62" y="72" width="60" height="5" rx="2.5" fill="#f0f0f0" />
        <rect x="62" y="82" width="68" height="5" rx="2.5" fill="#f0f0f0" />
      </g>

      {/* 锁形徽标 */}
      <circle
        cx="100"
        cy="98"
        r="18"
        fill="url(#ptb-lock)"
        stroke="#ffffff"
        strokeWidth="2.5"
      />
      <path
        d="M96 96v-3a4 4 0 0 1 8 0v3"
        fill="none"
        stroke="#ffffff"
        strokeWidth="2.4"
        strokeLinecap="round"
      />
      <rect x="93" y="96" width="14" height="11" rx="2" fill="#ffffff" />
      <circle cx="100" cy="101" r="1.6" fill="#fa8c16" />

      <Sparkle x={36} y={44} s={0.8} color="#0d9488" />
      <Sparkle x={170} y={48} s={0.7} color="#faad14" delay={0.7} />
      <Sparkle x={174} y={104} s={0.55} color="#13c2c2" delay={1.3} />
      <circle cx="160" cy="26" r="2" fill="#5eead4" />
      <circle cx="40" cy="112" r="2" fill="#6ee7b7" />
    </ArtFrame>
  );
}

/** 搜索无果:放大镜里的问号。 */
export function SearchArt() {
  return (
    <ArtFrame prefix="pts">
      <defs>
        <linearGradient id="pts-rim" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#0d9488" />
          <stop offset="100%" stopColor="#059669" />
        </linearGradient>
        <radialGradient id="pts-lens" cx="42%" cy="38%" r="70%">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.92" />
          <stop offset="100%" stopColor="#99f6e4" stopOpacity="0.45" />
        </radialGradient>
      </defs>

      {/* 背景记录页 */}
      <g transform="rotate(-5 100 78)">
        <rect
          x="60"
          y="34"
          width="80"
          height="92"
          rx="9"
          fill="#ffffff"
          stroke="#e8e8e8"
        />
        <rect x="72" y="46" width="40" height="5" rx="2.5" fill="#f0f0f0" />
        <rect x="72" y="56" width="56" height="4" rx="2" fill="#f7f6f3" />
        <rect x="72" y="64" width="48" height="4" rx="2" fill="#f7f6f3" />
        <rect x="72" y="72" width="52" height="4" rx="2" fill="#f7f6f3" />
      </g>

      {/* 放大镜 + 问号 */}
      <g filter="url(#pts-soft)">
        <line
          x1="123"
          y1="101"
          x2="148"
          y2="120"
          stroke="url(#pts-rim)"
          strokeWidth="7"
          strokeLinecap="round"
        />
        <circle
          cx="104"
          cy="82"
          r="27"
          fill="url(#pts-lens)"
          stroke="url(#pts-rim)"
          strokeWidth="5"
        />
        <path
          d="M89 71a19 19 0 0 1 11-8"
          fill="none"
          stroke="#ffffff"
          strokeWidth="3"
          strokeLinecap="round"
          opacity="0.85"
        />
        <path
          d="M99 75.5c0-3 2.2-5 5-5c2.8 0 5 2 5 4.8c0 2.2-1.3 3.2-2.8 4.2c-1.2 .8-2.2 1.6-2.2 3.2"
          fill="none"
          stroke="url(#pts-rim)"
          strokeWidth="2.6"
          strokeLinecap="round"
        />
        <circle cx="104" cy="87.5" r="1.7" fill="url(#pts-rim)" />
      </g>

      <Sparkle x={36} y={40} color="#059669" />
      <Sparkle x={172} y={44} s={0.8} color="#faad14" delay={0.7} />
      <Sparkle x={176} y={98} s={0.6} color="#13c2c2" delay={1.3} />
      <Sparkle x={28} y={98} s={0.55} color="#0d9488" delay={1.9} />
      <circle cx="160" cy="24" r="2" fill="#5eead4" />
      <circle cx="44" cy="118" r="2" fill="#6ee7b7" />
    </ArtFrame>
  );
}
