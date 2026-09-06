import { cn } from '@/lib/utils';

/**
 * Pulse 脉测 品牌标志（docs/BRAND.md 规范内联渲染）
 * variant:
 *  - tile   深色方砖主标志（渐变青脉冲）
 *  - mono   单色自适应（currentColor，跟随文字颜色）
 * loading=true 时波形变为流动信号（stroke-dash 动画）
 */

export function PulseMark({
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
      aria-label="Pulse 脉测"
      className={cn('shrink-0', className)}
    >
      {!mono && (
        <defs>
          <linearGradient id="pl-tile" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#232329" />
            <stop offset="1" stopColor="#0A0A0C" />
          </linearGradient>
          <linearGradient id="pl-wave" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="#5EEAD4" />
            <stop offset=".5" stopColor="#22D3EE" />
            <stop offset="1" stopColor="#38BDF8" />
          </linearGradient>
          <radialGradient id="pl-glow" cx="0.5" cy="0.5" r="0.5">
            <stop offset="0" stopColor="#22D3EE" stopOpacity="0.4" />
            <stop offset="1" stopColor="#22D3EE" stopOpacity="0" />
          </radialGradient>
        </defs>
      )}
      {!mono && <rect x="4" y="4" width="120" height="120" rx="30" fill="url(#pl-tile)" stroke="#2E2E33" strokeWidth="1.5" />}
      {!mono && <circle cx="102" cy="74" r="17" fill="url(#pl-glow)" />}
      <polyline
        points="26,74 50,74 60,44 70,90 80,58 90,74 102,74"
        fill="none"
        stroke={mono ? 'currentColor' : 'url(#pl-wave)'}
        strokeWidth="7"
        strokeLinecap="round"
        strokeLinejoin="round"
        className={loading ? 'animate-pulse-dash' : undefined}
        strokeDasharray={loading ? '26 30' : undefined}
      />
      <circle cx="26" cy="74" r="6.5" fill={mono ? 'currentColor' : '#67E8F9'} />
      <circle cx="102" cy="74" r="8" fill={mono ? 'currentColor' : '#22D3EE'} className={loading ? 'animate-pulse-glow' : undefined} />
    </svg>
  );
}

/** 页头横排组合：标志 + 中英文字标 */
export function BrandLockup({ loading = false, className }: { loading?: boolean; className?: string }) {
  return (
    <div className={cn('flex items-center gap-2.5', className)}>
      <PulseMark size={34} loading={loading} />
      <div className="flex flex-col leading-none">
        <span className="text-lg font-bold tracking-tight">
          Pulse <span className="brand-gradient-text">脉测</span>
        </span>
        <span className="mt-1 text-[11px] text-muted-foreground">IP/CDN 网络优选平台</span>
      </div>
    </div>
  );
}
