import {
  AimOutlined,
  ArrowRightOutlined,
  BulbOutlined,
  DiffOutlined,
  EyeOutlined,
  FileTextOutlined,
  ProfileOutlined,
  ScissorOutlined,
} from '@ant-design/icons';
import type { CSSProperties, ReactNode } from 'react';

interface Preset {
  text: string;
  desc: string;
  icon: ReactNode;
  /** 图标与悬停强调色。 */
  tint: string;
  /** 图标底色。 */
  tintBg: string;
  /** 悬停边框色。 */
  border: string;
}

const PAGE_PRESETS: Preset[] = [
  {
    text: '概括这篇内容',
    desc: '快速提炼全文主旨与脉络',
    icon: <FileTextOutlined />,
    tint: '#0d9488',
    tintBg: '#f0fdfa',
    border: '#5eead4',
  },
  {
    text: '列出核心观点',
    desc: '抓住作者的关键论点',
    icon: <BulbOutlined />,
    tint: '#059669',
    tintBg: '#ecfdf5',
    border: '#6ee7b7',
  },
  {
    text: '有哪些值得注意的细节',
    desc: '发现容易被忽略的信息',
    icon: <EyeOutlined />,
    tint: '#08979c',
    tintBg: '#e6fffb',
    border: '#87e8de',
  },
];

const SCOPE_PRESETS: Preset[] = [
  {
    text: '比较这些页面的核心差异',
    desc: '对照来源之间的异同与联系',
    icon: <DiffOutlined />,
    tint: '#d48806',
    tintBg: '#fffbe6',
    border: '#ffe58f',
  },
  {
    text: '整理成一份结构化报告',
    desc: '汇总成可保存的要点文档',
    icon: <ProfileOutlined />,
    tint: '#389e0d',
    tintBg: '#f6ffed',
    border: '#b7eb8f',
  },
];

/** 品牌插画:被"拾起"的层叠书页 + 书签与 AI 徽标,缓慢浮动、星光闪烁。 */
function WelcomeArt() {
  return (
    <svg viewBox="0 0 200 150" role="presentation" focusable="false">
      <defs>
        <radialGradient id="ptw-halo" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#0d9488" stopOpacity="0.14" />
          <stop offset="100%" stopColor="#0d9488" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="ptw-shadow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#0f766e" stopOpacity="0.18" />
          <stop offset="100%" stopColor="#0f766e" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="ptw-title" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#0d9488" />
          <stop offset="100%" stopColor="#059669" />
        </linearGradient>
        <linearGradient id="ptw-bookmark" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#ffd666" />
          <stop offset="100%" stopColor="#fa8c16" />
        </linearGradient>
        <linearGradient id="ptw-badge" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#0d9488" />
          <stop offset="100%" stopColor="#059669" />
        </linearGradient>
        <linearGradient id="ptw-scan" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#0d9488" stopOpacity="0" />
          <stop offset="50%" stopColor="#0d9488" stopOpacity="0.13" />
          <stop offset="100%" stopColor="#0d9488" stopOpacity="0" />
        </linearGradient>
        <clipPath id="ptw-page-clip">
          <rect x="62" y="20" width="80" height="108" rx="9" />
        </clipPath>
        <filter id="ptw-soft" x="-30%" y="-30%" width="160%" height="160%">
          <feDropShadow
            dx="0"
            dy="3"
            stdDeviation="5"
            floodColor="#0f766e"
            floodOpacity="0.12"
          />
        </filter>
      </defs>

      {/* 光晕与投影 */}
      <circle cx="100" cy="72" r="62" fill="url(#ptw-halo)" />
      <ellipse cx="100" cy="133" rx="58" ry="9" fill="url(#ptw-shadow)" />

      {/* 层叠的书页 */}
      <g transform="rotate(-10 100 75)">
        <rect
          x="58"
          y="24"
          width="84"
          height="104"
          rx="9"
          fill="#ffffff"
          stroke="#ccfbf1"
        />
      </g>
      <g transform="rotate(6 100 75)">
        <rect
          x="60"
          y="22"
          width="84"
          height="106"
          rx="9"
          fill="#f0fdfa"
          stroke="#ccfbf1"
        />
      </g>
      <g filter="url(#ptw-soft)">
        <rect
          x="62"
          y="20"
          width="80"
          height="108"
          rx="9"
          fill="#ffffff"
          stroke="#99f6e4"
          strokeWidth="1.2"
        />
        <circle cx="78" cy="34" r="3" fill="#0d9488" opacity="0.9" />
        <rect x="85" y="31" width="34" height="6" rx="3" fill="url(#ptw-title)" />
        <rect x="74" y="46" width="56" height="4" rx="2" fill="#d5efe9" />
        <rect x="74" y="54" width="48" height="4" rx="2" fill="#d5efe9" />
        <rect x="74" y="62" width="53" height="4" rx="2" fill="#d5efe9" />
        <rect x="74" y="72" width="56" height="16" rx="4" fill="#f0fdfa" />
        <rect x="74" y="72" width="3" height="16" rx="1.5" fill="url(#ptw-title)" />
        <rect x="81" y="77" width="42" height="3" rx="1.5" fill="#5eead4" />
        <rect x="81" y="83" width="34" height="3" rx="1.5" fill="#99f6e4" />
        <rect x="74" y="96" width="56" height="4" rx="2" fill="#d5efe9" />
        <rect x="74" y="104" width="44" height="4" rx="2" fill="#d5efe9" />
        {/* AI 阅读扫描光带 */}
        <g clipPath="url(#ptw-page-clip)">
          <rect
            className="chat-welcome-scan"
            x="62"
            y="0"
            width="80"
            height="26"
            fill="url(#ptw-scan)"
          />
        </g>
      </g>

      {/* 书签 */}
      <path d="M120 16h16v30l-8-7-8 7Z" fill="url(#ptw-bookmark)" />

      {/* AI 徽标 */}
      <circle
        cx="141"
        cy="121"
        r="14"
        fill="url(#ptw-badge)"
        stroke="#ffffff"
        strokeWidth="2.5"
      />
      <path
        d="M141 113.5l2.2 5.3 5.3 2.2-5.3 2.2-2.2 5.3-2.2-5.3-5.3-2.2 5.3-2.2Z"
        fill="#ffffff"
      />
      <circle cx="147.5" cy="114.5" r="1.3" fill="#ffffff" opacity="0.9" />

      {/* 星光点缀 */}
      <g transform="translate(36 40)">
        <path
          className="chat-welcome-spark"
          d="M0 -7C0.8 -2.5 2.5 -0.8 7 0C2.5 0.8 0.8 2.5 0 7C-0.8 2.5 -2.5 0.8 -7 0C-2.5 -0.8 -0.8 -2.5 0 -7Z"
          fill="#059669"
        />
      </g>
      <g transform="translate(170 44) scale(0.8)">
        <path
          className="chat-welcome-spark"
          style={{ animationDelay: '0.7s' }}
          d="M0 -7C0.8 -2.5 2.5 -0.8 7 0C2.5 0.8 0.8 2.5 0 7C-0.8 2.5 -2.5 0.8 -7 0C-2.5 -0.8 -0.8 -2.5 0 -7Z"
          fill="#faad14"
        />
      </g>
      <g transform="translate(176 98) scale(0.6)">
        <path
          className="chat-welcome-spark"
          style={{ animationDelay: '1.3s' }}
          d="M0 -7C0.8 -2.5 2.5 -0.8 7 0C2.5 0.8 0.8 2.5 0 7C-0.8 2.5 -2.5 0.8 -7 0C-2.5 -0.8 -0.8 -2.5 0 -7Z"
          fill="#13c2c2"
        />
      </g>
      <g transform="translate(28 96) scale(0.55)">
        <path
          className="chat-welcome-spark"
          style={{ animationDelay: '1.9s' }}
          d="M0 -7C0.8 -2.5 2.5 -0.8 7 0C2.5 0.8 0.8 2.5 0 7C-0.8 2.5 -2.5 0.8 -7 0C-2.5 -0.8 -0.8 -2.5 0 -7Z"
          fill="#0d9488"
        />
      </g>
      <circle cx="160" cy="24" r="2" fill="#5eead4" />
      <circle cx="44" cy="118" r="2" fill="#6ee7b7" />
    </svg>
  );
}

/** 空会话占位:scope 会话展示快捷问题,普通会话展示品牌提示。 */
export function ChatEmptyState({
  hasScope,
  onPreset,
}: {
  hasScope: boolean;
  onPreset: (text: string) => void;
}) {
  const presets = hasScope ? SCOPE_PRESETS : PAGE_PRESETS;
  return (
    <div className="chat-welcome">
      <div className="chat-welcome-hero" aria-hidden="true">
        <WelcomeArt />
      </div>
      <div className="chat-welcome-copy">
        <h1>{hasScope ? '从这些来源开始探究' : '从阅读到理解'}</h1>
        <p>
          {hasScope
            ? '围绕所选来源提问，比较和整理内容'
            : '围绕网页内容提问，整理值得保留的想法'}
        </p>
      </div>
      <div className="chat-welcome-prompts">
        <div className="chat-welcome-label">试着问</div>
        {presets.map((preset) => (
          <button
            key={preset.text}
            type="button"
            className="chat-welcome-card"
            aria-label={preset.text}
            style={
              {
                '--card-tint': preset.tint,
                '--card-tint-bg': preset.tintBg,
                '--card-border': preset.border,
              } as CSSProperties
            }
            onClick={() => onPreset(preset.text)}
          >
            <span className="chat-welcome-card-icon" aria-hidden="true">
              {preset.icon}
            </span>
            <span className="chat-welcome-card-text">
              <span className="chat-welcome-card-title">{preset.text}</span>
              <span className="chat-welcome-card-desc">{preset.desc}</span>
            </span>
            <ArrowRightOutlined className="chat-welcome-card-arrow" aria-hidden="true" />
          </button>
        ))}
      </div>
      <p className="chat-welcome-tip">
        试试 <AimOutlined /> 选取元素或 <ScissorOutlined /> 框选截图，让回答更聚焦
      </p>
    </div>
  );
}
