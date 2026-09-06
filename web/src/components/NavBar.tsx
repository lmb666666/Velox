import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Moon, Sun } from 'lucide-react';
import { VeloxMark } from '@/components/BrandLogo';
import { cn } from '@/lib/utils';

/**
 * 顶部导航（仿 DeepSeek Harness）：
 * 页面顶部时完全透明悬浮；滚动后浮出为一条全圆角毛玻璃胶囊。
 * 左：标志 + 字标 + 定位徽章；右：运行状态胶囊 + 深浅色分段控件。
 */
export function NavBar({ running, nodesTotal }: { running: boolean; nodesTotal?: number }) {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <div className="fixed inset-x-0 top-0 z-50 px-3 pt-3 sm:px-5 sm:pt-4">
      <div
        className={cn(
          'mx-auto flex h-14 max-w-7xl items-center justify-between rounded-full border pl-5 pr-2.5 transition-all duration-300 sm:pl-6 sm:pr-3',
          scrolled
            ? 'border-border/60 bg-background/70 shadow-lg shadow-black/[0.04] backdrop-blur-xl'
            : 'border-transparent bg-transparent',
        )}
      >
        {/* 左：标志 + 字标 + 徽章（点击回顶部） */}
        <button
          type="button"
          onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
          className="flex min-w-0 cursor-pointer items-center gap-2.5 rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <VeloxMark size={28} loading={running} />
          <span className="text-[17px] font-bold tracking-tight">Velox</span>
          <span className="hidden rounded-full border border-border/80 px-2.5 py-0.5 text-[11px] font-medium text-muted-foreground md:inline-block">
            全网实测 · IP 优选
          </span>
        </button>

        {/* 右：状态 + 主题分段 */}
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 rounded-full border border-border/70 bg-muted/40 px-3 py-1.5 text-xs text-muted-foreground">
            <span className="relative flex h-2 w-2">
              <span
                className={cn(
                  'absolute inline-flex h-full w-full animate-ping rounded-full opacity-60',
                  running ? 'bg-primary' : 'bg-emerald-500',
                )}
                style={{ animationDuration: '2.4s' }}
              />
              <span className={cn('relative inline-flex h-2 w-2 rounded-full', running ? 'bg-primary' : 'bg-emerald-500')} />
            </span>
            {running ? (
              <span>测试进行中</span>
            ) : (
              <span className="whitespace-nowrap">
                <span className="num">{nodesTotal ?? '…'}</span> 监测点在线
              </span>
            )}
          </div>
          <ThemeSegmented />
        </div>
      </div>
    </div>
  );
}

/** 深浅色分段控件（class 策略 + localStorage，index.html 已做初始化防闪屏） */
function ThemeSegmented() {
  const [dark, setDark] = useState<boolean>(() => document.documentElement.classList.contains('dark'));

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
    localStorage.setItem('velox-theme', dark ? 'dark' : 'light');
  }, [dark]);

  const options = [
    { key: 'light', icon: Sun, label: '浅色模式' },
    { key: 'dark', icon: Moon, label: '深色模式' },
  ] as const;

  return (
    <div
      role="radiogroup"
      aria-label="深浅色切换"
      className="inline-flex items-center rounded-full border border-border/70 bg-muted/40 p-0.5"
    >
      {options.map((o) => {
        const active = dark === (o.key === 'dark');
        return (
          <button
            key={o.key}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={o.label}
            onClick={() => setDark(o.key === 'dark')}
            className={cn(
              'relative rounded-full p-1.5 transition-colors',
              active ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {active && (
              <motion.span
                layoutId="theme-thumb"
                className="absolute inset-0 rounded-full border border-border/60 bg-background shadow-sm"
                transition={{ type: 'spring', bounce: 0.18, duration: 0.45 }}
              />
            )}
            <o.icon className="relative z-10 h-3.5 w-3.5" />
          </button>
        );
      })}
    </div>
  );
}
