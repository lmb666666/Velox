import { useEffect, useRef, useState } from 'react';
import { History, RefreshCw, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { HistoryItem } from '@/lib/api';
import { cn, relativeTime } from '@/lib/utils';

/**
 * 历史记录面板：点击回看详情，单条删除与一键清空均为二次确认交互。
 */
export function HistoryPanel({
  items,
  onOpen,
  onDelete,
  onClear,
  onRefresh,
  activeId,
}: {
  items: HistoryItem[];
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
  onClear: () => void;
  onRefresh: () => void;
  activeId?: string;
}) {
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const timers = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());

  // 卸载时清理挂起的确认计时器
  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  /** 进入确认态后 2.5s 未二次点击则自动复位 */
  function scheduleReset(reset: () => void) {
    timers.current.add(setTimeout(reset, 2500));
  }

  function handleDelete(id: string) {
    if (confirmId === id) {
      onDelete(id);
      setConfirmId(null);
    } else {
      setConfirmId(id);
      scheduleReset(() => setConfirmId(null));
    }
  }

  function handleClear() {
    if (confirmClear) {
      onClear();
      setConfirmClear(false);
    } else {
      setConfirmClear(true);
      scheduleReset(() => setConfirmClear(false));
    }
  }

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0 pb-3">
        <CardTitle className="flex items-center gap-2 text-sm">
          <History className="h-4 w-4 text-muted-foreground" />
          历史记录
          <Badge variant="secondary" className="num">{items.length}</Badge>
        </CardTitle>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onRefresh} aria-label="刷新历史">
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
          {items.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className={cn('h-7 gap-1 text-xs', confirmClear ? 'bg-red-500/10 text-red-500' : 'text-muted-foreground')}
              onClick={handleClear}
            >
              <Trash2 className="h-3.5 w-3.5" />
              {confirmClear ? '确认清空' : '清空'}
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted-foreground">暂无历史记录</p>
        ) : (
          <div className="max-h-80 space-y-1.5 overflow-y-auto pr-1">
            {items.map((it) => (
              <div
                key={it.id}
                className={cn(
                  'group flex items-center gap-2 rounded-lg border px-3 py-2 text-xs transition-colors',
                  activeId === it.id ? 'border-primary bg-primary/5' : 'border-transparent hover:border-input hover:bg-accent',
                )}
              >
                <button type="button" className="flex min-w-0 flex-1 items-center gap-2 text-left" onClick={() => onOpen(it.id)}>
                  <span className="num w-16 shrink-0 text-muted-foreground" title={new Date(it.createdAt).toLocaleString('zh-CN', { hour12: false })}>
                    {relativeTime(it.createdAt)}
                  </span>
                  <Badge variant="outline" className="shrink-0">{it.mode}</Badge>
                  {it.provider && (
                    <span className="shrink-0 rounded border border-border/70 px-1 py-0.5 text-[10px] text-muted-foreground" title="结果来源上游">
                      {it.provider}
                    </span>
                  )}
                  <span className="num min-w-0 flex-1 truncate">{it.targets.join(', ')}</span>
                  {it.error ? (
                    <Badge variant="danger" className="shrink-0">失败</Badge>
                  ) : (
                    <span className="num shrink-0 text-muted-foreground">
                      {it.okNodes}/{it.totalNodes}
                      {it.overallAvg !== undefined ? ` · ${it.overallAvg} ms` : ''}
                    </span>
                  )}
                </button>
                <Button
                  variant="ghost"
                  size="icon"
                  className={cn(
                    'h-6 w-6 shrink-0 opacity-0 transition-opacity group-hover:opacity-100',
                    confirmId === it.id && 'opacity-100',
                  )}
                  aria-label="删除该记录"
                  onClick={() => handleDelete(it.id)}
                >
                  <Trash2 className={cn('h-3.5 w-3.5', confirmId === it.id ? 'text-red-500' : 'text-muted-foreground')} />
                </Button>
              </div>
            ))}
            {confirmId && (
              <p className="text-center text-[11px] text-muted-foreground">再次点击垃圾桶图标确认删除</p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
