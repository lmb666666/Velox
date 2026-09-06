import { History, RefreshCw } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { HistoryItem } from '@/lib/api';
import { relativeTime } from '@/lib/utils';

export function HistoryPanel({
  items,
  onOpen,
  onRefresh,
  activeId,
}: {
  items: HistoryItem[];
  onOpen: (id: string) => void;
  onRefresh: () => void;
  activeId?: string;
}) {
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0 pb-3">
        <CardTitle className="flex items-center gap-2 text-sm">
          <History className="h-4 w-4 text-muted-foreground" />
          历史记录
          <Badge variant="secondary" className="num">{items.length}</Badge>
        </CardTitle>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onRefresh} aria-label="刷新历史">
          <RefreshCw className="h-3.5 w-3.5" />
        </Button>
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted-foreground">暂无历史记录</p>
        ) : (
          <div className="space-y-1.5">
            {items.map((it) => (
              <button
                key={it.id}
                type="button"
                onClick={() => onOpen(it.id)}
                className={
                  'flex w-full items-center gap-3 rounded-lg border px-3 py-2 text-left text-xs transition-colors hover:bg-accent ' +
                  (activeId === it.id ? 'border-primary bg-primary/5' : 'border-transparent')
                }
              >
                <span className="num w-20 shrink-0 text-muted-foreground" title={new Date(it.createdAt).toLocaleString('zh-CN', { hour12: false })}>
                  {relativeTime(it.createdAt)}
                </span>
                <Badge variant="outline" className="shrink-0">{it.mode}</Badge>
                <span className="num min-w-0 flex-1 truncate">{it.targets.join(', ')}</span>
                {it.error ? (
                  <Badge variant="danger">失败</Badge>
                ) : (
                  <span className="num shrink-0 text-muted-foreground">
                    {it.okNodes}/{it.totalNodes}
                    {it.overallAvg !== undefined ? ` · ${it.overallAvg} ms` : ''}
                  </span>
                )}
              </button>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
