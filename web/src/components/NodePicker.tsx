import { useMemo, useState } from 'react';
import { ListChecks, RefreshCw, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import type { NodesResponse } from '@/lib/api';
import { cn } from '@/lib/utils';

const PRESETS: { label: string; spec: string }[] = [
  { label: '全部', spec: 'all' },
  { label: '三网', spec: 'telecom,unicom,mobile' },
  { label: '电信', spec: 'telecom' },
  { label: '联通', spec: 'unicom' },
  { label: '移动', spec: 'mobile' },
  { label: '海外', spec: 'overseas' },
  { label: '京沪广深', spec: '北京,上海,广州,深圳' },
];

export function NodePicker({
  spec,
  onSpecChange,
  nodesData,
  batch,
  onRefresh,
  refreshing,
}: {
  spec: string;
  onSpecChange: (spec: string) => void;
  nodesData: NodesResponse | null;
  batch: boolean;
  onRefresh: () => void;
  refreshing: boolean;
}) {
  const [keyword, setKeyword] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');

  const selectedCount = useMemo(() => {
    if (!nodesData) return null;
    if (spec === 'all' || spec === '') return nodesData.total;
    // 按逗号段尝试解析为节点 ID / 关键词，估算命中数量
    const all = Object.values(nodesData.categories).flat();
    const keys = spec.split(',').map((s) => s.trim()).filter(Boolean);
    const hit = new Set<string>();
    for (const k of keys) {
      for (const n of all) {
        if (n.id === k || n.name.includes(k)) hit.add(n.id);
      }
    }
    return keys.length > 0 ? hit.size : null;
  }, [spec, nodesData]);

  function addKeyword() {
    const kw = keyword.trim();
    if (!kw) return;
    setSpecInternal(spec === 'all' || spec === '' ? kw : `${spec},${kw}`);
    setKeyword('');
  }

  function setSpecInternal(next: string) {
    onSpecChange(next);
  }

  const categories = nodesData?.categories ?? {};
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return Object.entries(categories)
      .map(([cat, list]) => [cat, q ? list.filter((n) => n.name.toLowerCase().includes(q) || n.id.includes(q)) : list] as const)
      .filter(([, list]) => list.length > 0) as [string, { id: string; name: string }[]][];
  }, [categories, search]);

  function toggleNode(id: string) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function applyPicked() {
    setSpecInternal([...picked].join(','));
    setDialogOpen(false);
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1.5">
        {PRESETS.map((p) => (
          <button
            key={p.label}
            type="button"
            onClick={() => setSpecInternal(p.spec)}
            className={cn(
              'rounded-full border px-3 py-1 text-xs transition-colors hover:bg-accent hover:text-accent-foreground',
              spec === p.spec ? 'border-primary bg-primary/10 text-primary' : 'border-input text-muted-foreground',
            )}
          >
            {p.label}
          </button>
        ))}
      </div>
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addKeyword())}
            placeholder="节点关键词（回车添加，如 上海/济南）"
            className="pl-8 h-8 text-xs"
          />
        </div>
        {batch && (
          <Button type="button" variant="outline" size="sm" className="h-8" onClick={() => setDialogOpen(true)}>
            <ListChecks className="h-3.5 w-3.5" />
            逐节点选择
          </Button>
        )}
        <Button type="button" variant="ghost" size="sm" className="h-8" onClick={onRefresh} disabled={refreshing} title="刷新节点表">
          <RefreshCw className={cn('h-3.5 w-3.5', refreshing && 'animate-spin')} />
        </Button>
      </div>
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span className="num">节点选择: {spec === 'all' ? '全部' : spec}</span>
        {selectedCount !== null && <Badge variant="secondary" className="num">{selectedCount} 个节点</Badge>}
        {spec === 'all' && <span className="hidden sm:inline">（批量模式建议缩小范围以缩短耗时）</span>}
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>逐节点选择</DialogTitle>
            <DialogDescription>批量模式支持精确指定监测点（每任务 5 个节点，自动分片）</DialogDescription>
          </DialogHeader>
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="搜索节点" className="pl-8 h-8" />
          </div>
          <div className="max-h-80 space-y-4 overflow-y-auto pr-1">
            {filtered.map(([cat, list]) => (
              <div key={cat}>
                <div className="mb-1.5 text-xs font-semibold text-muted-foreground">{cat}</div>
                <div className="grid grid-cols-2 gap-1.5">
                  {list.map((n) => (
                    <button
                      key={n.id}
                      type="button"
                      onClick={() => toggleNode(n.id)}
                      className={cn(
                        'flex items-center gap-2 rounded-md border px-2 py-1.5 text-left text-xs transition-colors',
                        picked.has(n.id) ? 'border-primary bg-primary/10' : 'border-input hover:bg-accent',
                      )}
                    >
                      <span className="truncate">{n.name}</span>
                      <span className="num ml-auto text-[10px] text-muted-foreground">{n.id.slice(0, 4)}</span>
                    </button>
                  ))}
                </div>
              </div>
            ))}
            {filtered.length === 0 && <div className="py-8 text-center text-sm text-muted-foreground">无匹配节点</div>}
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">已选 <span className="num">{picked.size}</span> 个节点</span>
            <div className="flex gap-2">
              <Button type="button" variant="ghost" size="sm" onClick={() => setPicked(new Set())}>清空</Button>
              <Button type="button" size="sm" onClick={applyPicked} disabled={picked.size === 0}>
                应用（{picked.size}）
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
