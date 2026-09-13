import * as React from 'react';
import * as ProgressPrimitive from '@radix-ui/react-progress';
import { cn } from '@/lib/utils';

/** 进度条：value 未定义时进入 indeterminate 模式（跑马灯动画，用于总节点数未知的运行中态） */
const Progress = React.forwardRef<
  React.ElementRef<typeof ProgressPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof ProgressPrimitive.Root>
>(({ className, value, ...props }, ref) => {
  const indeterminate = value === undefined;
  return (
    <ProgressPrimitive.Root
      ref={ref}
      className={cn('relative h-2 w-full overflow-hidden rounded-full bg-primary/15', className)}
      {...props}
    >
      {indeterminate ? (
        <div className="absolute inset-y-0 w-1/3 animate-progress-slide rounded-full bg-primary/70" />
      ) : (
        <ProgressPrimitive.Indicator
          className="h-full w-full flex-1 bg-primary transition-all duration-500"
          style={{ transform: `translateX(-${100 - (value ?? 0)}%)` }}
        />
      )}
    </ProgressPrimitive.Root>
  );
});
Progress.displayName = ProgressPrimitive.Root.displayName;

export { Progress };
