import { cn } from '@/lib/utils';

/**
 * Velox 品牌标志（docs/BRAND.md 规范内联渲染）
 * variant:
 *  - tile   深色方砖主标志（电光青上升折线）
 *  - mono   单色自适应（currentColor，跟随文字颜色）
 * loading=true 时折线变为流动信号（stroke-dash 动画）
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
          <linearGradient id="vx-line" x1="0" y1="1" x2="1" y2="0">
            <stop offset="0" stopColor="#00E5C7" />
            <stop offset="1" stopColor="#7C9FFF" />
          </linearGradient>
          <radialGradient id="vx-glow" cx="0.5" cy="0.5" r="0.5">
            <stop offset="0" stopColor="#00E5C7" stopOpacity="0.35" />
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
          rx="26"
          fill="url(#vx-tile)"
          stroke="#FFFFFF"
          strokeOpacity="0.1"
          strokeWidth="1.5"
        />
      )}
      {!mono && <circle cx="106" cy="24" r="17" fill="url(#vx-glow)" />}
      <polyline
        points="22,42 44,90 76,50 106,24"
        fill="none"
        stroke={mono ? 'currentColor' : 'url(#vx-line)'}
        strokeWidth="7"
        strokeLinecap="round"
        strokeLinejoin="round"
        className={loading ? 'animate-pulse-dash' : undefined}
        strokeDasharray={loading ? '26 30' : undefined}
      />
      <circle cx="22" cy="42" r="6" fill={mono ? 'currentColor' : '#9AA7B8'} />
      <circle
        cx="44"
        cy="90"
        r="5"
        fill={mono ? 'currentColor' : '#00E5C7'}
        fillOpacity={mono ? 0.55 : undefined}
      />
      <circle
        cx="106"
        cy="24"
        r="8"
        fill={mono ? 'currentColor' : '#00E5C7'}
        className={loading ? 'animate-pulse-glow' : undefined}
      />
    </svg>
  );
}

/** 页头横排组合：标志 + Velox 字标 + 定位语 */
export function BrandLockup({ loading = false, className }: { loading?: boolean; className?: string }) {
  return (
    <div className={cn('flex items-center gap-2.5', className)}>
      <VeloxMark size={34} loading={loading} />
      <div className="flex flex-col leading-none">
        <span className="text-lg font-bold tracking-tight">
          Velox<span className="brand-gradient-text">.</span>
        </span>
        <span className="mt-1 text-[11px] text-muted-foreground">IP/CDN 网络优选平台</span>
      </div>
    </div>
  );
}
