import { cn } from '@/lib/utils';

/**
 * Velox 品牌标志（docs/BRAND.md 规范内联渲染）
 * 两笔式 V：左臂石墨下沉（测量），右臂电光青上扬（测速结论）。
 * variant:
 *  - tile   深色方砖主标志
 *  - mono   单色自适应（currentColor，跟随文字颜色）
 * loading=true 时上扬臂变为流动信号（stroke-dash 动画）
 * 与 assets/brand/logo.svg / favicon.svg 保持同一几何。
 */

export function VeloxMark({
  size = 32,
  variant = 'tile',
  loading = false,
  className,
}: {
  size?: number;
  variant?: 'tile' | 'mono';
  loading?: boolean;
  className?: string;
}) {
  const mono = variant === 'mono';
  return (
    <svg
      viewBox="0 0 128 128"
      width={size}
      height={size}
      role="img"
      aria-label="Velox"
      className={cn('shrink-0', className)}
    >
      {!mono && (
        <defs>
          <linearGradient id="vx-tile" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#12161F" />
            <stop offset="1" stopColor="#0A0E14" />
          </linearGradient>
          <linearGradient id="vx-rise" x1="0" y1="1" x2="1" y2="0">
            <stop offset="0" stopColor="#00E5C7" />
            <stop offset="1" stopColor="#7C9FFF" />
          </linearGradient>
          <radialGradient id="vx-glow" cx="0.5" cy="0.5" r="0.5">
            <stop offset="0" stopColor="#00E5C7" stopOpacity="0.4" />
            <stop offset="1" stopColor="#00E5C7" stopOpacity="0" />
          </radialGradient>
        </defs>
      )}
      {!mono && (
        <rect
          x="4"
          y="4"
          width="120"
          height="120"
          rx="28"
          fill="url(#vx-tile)"
          stroke="#FFFFFF"
          strokeOpacity="0.1"
          strokeWidth="1.5"
        />
      )}
      {!mono && <circle cx="106" cy="24" r="19" fill="url(#vx-glow)" />}
      {/* 左臂：石墨下沉（测量） */}
      <polyline
        points="32,32 60,94"
        fill="none"
        stroke={mono ? 'currentColor' : '#8A94A6'}
        strokeOpacity={mono ? 0.5 : undefined}
        strokeWidth="11"
        strokeLinecap="round"
        strokeDasharray={loading ? '30 24' : undefined}
      />
      {/* 右臂：电光青上扬（测速结论） */}
      <polyline
        points="60,94 106,24"
        fill="none"
        stroke={mono ? 'currentColor' : 'url(#vx-rise)'}
        strokeWidth="11"
        strokeLinecap="round"
        className={loading ? 'animate-pulse-dash' : undefined}
        strokeDasharray={loading ? '30 24' : undefined}
      />
      <circle cx="32" cy="32" r="7" fill={mono ? 'currentColor' : '#B9C2CF'} fillOpacity={mono ? 0.5 : undefined} />
      <circle
        cx="106"
        cy="24"
        r="9"
        fill={mono ? 'currentColor' : '#00E5C7'}
        className={loading ? 'animate-pulse-glow' : undefined}
      />
    </svg>
  );
}
