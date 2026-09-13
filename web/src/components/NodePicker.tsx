import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ListChecks, RefreshCw, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { isPureLineSpec, type Mode, type NodeInfo, type NodesResponse } from '@/lib/api';
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

/** 线路别名 → 展示名（触发条摘要用） */
const LINE_LABELS: Record<string, string> = { telecom: '电信', unicom: '联通', mobile: '移动', overseas: '海外' };

export function NodePicker({
  spec,
  onSpecChange,
  nodesData,
  mode,
  onRefresh,
  refreshing,
}: {
  spec: string;
  onSpecChange: (spec: string) => void;
  nodesData: NodesResponse | null;
  /** 当前测速模式：决定弹窗说明与降级警告文案 */
  mode: Mode;
  onRefresh: () => void;
  refreshing: boolean;
}) {
  const batch = mode === 'batch-ping' || mode === 'batch-tcping';
  const dialogHint = batch
    ? '精确指定监测点，每任务 5 个节点自动分片串行'
    : mode === 'traceroute'
      ? '路由跟踪单任务只使用一个节点；多选时仅第一个生效'
      : '单目标 ping/tcping 将按所选节点精确执行；http/dns 仅支持按线路过滤';

  const [dialogOpen, setDialogOpen] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');

  const categories = nodesData?.categories ?? {};
  const allNodes = useMemo(() => Object.values(categories).flat(), [categories]);

  // 打开弹窗时从 spec 反解析已选集合（消除 picked 与 spec 的状态不同步）
  useEffect(() => {
    if (!dialogOpen) return;
    if (spec === 'all' || spec.trim() === '' || isPureLineSpec(spec)) {
      setPicked(new Set());
      return;
    }
    const keys = spec.split(',').map((s) => s.trim()).filter(Boolean);
    const next = new Set<string>();
    for (const k of keys) {
      for (const n of allNodes) if (n.id === k || n.name.includes(k)) next.add(n.id);
    }
    setPicked(next);
  }, [dialogOpen]); // spec/allNodes 只在打开瞬间取值

  // 触发条摘要：把 spec 翻译成用户可读的选中描述
  const summaryText = useMemo(() => {
    if (!nodesData) return '节点表加载中…';
    const total = nodesData.total;
    if (spec === 'all' || spec.trim() === '' || isPureLineSpec(spec)) {
      const labels = spec
        .split(',')
        .map((p) => LINE_LABELS[p.trim().toLowerCase()] ?? '')
        .filter(Boolean);
      return labels.length > 0 ? `${labels.join(' + ')} 线路节点` : `全部 ${total} 个节点`;
    }
    const keys = spec.split(',').map((s) => s.trim()).filter(Boolean);
    const matched = new Map<string, NodeInfo>();
    for (const k of keys) {
      for (const n of allNodes) if (n.id === k || n.name.includes(k)) matched.set(n.id, n);
    }
    const list = [...matched.values()];
    const head =
      list.length > 0
        ? `已选 ${list.length} 个节点：${list.slice(0, 3).map((n) => n.name).join('、')}${list.length > 3 ? ` 等 ${list.length} 个` : ''}`
        : '未匹配到节点，点击重新选择';
    const chunkNote = batch && list.length > 5 ? ` · 将创建 ${Math.ceil(list.length / 5)} 个子任务` : '';
    return head + chunkNote;
  }, [spec, nodesData, batch, allNodes]);

  const filtered = useMemo<[string, NodeInfo[]][]>(() => {
    const q = search.trim().toLowerCase();
    return Object.entries(categories)
      .map(([cat, list]) => [cat, q ? list.filter((n) => n.name.toLowerCase().includes(q) || n.id.includes(q)) : list] as [string, NodeInfo[]])
      .filter(([, list]) => list.length > 0);
  }, [categories, search]);

  function toggleNode(id: string) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  /** 分组全选/取消全选（作用于当前搜索可见的列表） */
  function toggleAll(list: NodeInfo[]) {
    setPicked((prev) => {
      const next = new Set(prev);
      const allIn = list.every((n) => next.has(n.id));
      for (const n of list) {
        if (allIn) next.delete(n.id);
        else next.add(n.id);
      }
      return next;
    });
  }

  function applyPicked() {
    onSpecChange([...picked].join(','));
    setDialogOpen(false);
  }

  // http/dns 无批量端点：精确选择会被降级为线路过滤，提交前就地明示
  const degradedWarn = (mode === 'http' || mode === 'dns') && !isPureLineSpec(spec);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1.5">
        {PRESETS.map((p) => (
          <button
            key={p.label}
            type="button"
            onClick={() => onSpecChange(p.spec)}
            className={cn(
              'rounded-full border px-3 py-1 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring hover:bg-accent hover:text-accent-foreground',
              spec === p.spec ? 'border-primary bg-primary/10 text-primary' : 'border-input text-muted-foreground',
            )}
          >
            {p.label}
          </button>
        ))}
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="ml-auto h-7 w-7"
          onClick={onRefresh}
          disabled={refreshing}
          title="刷新节点表"
          aria-label="刷新节点表"
        >
          <RefreshCw className={cn('h-3.5 w-3.5', refreshing && 'animate-spin')} />
        </Button>
      </div>

      {/* 全宽选择器触发条：状态摘要 + 弹窗入口 */}
      <button
        type="button"
        onClick={() => setDialogOpen(true)}
        aria-haspopup="dialog"
        className="flex h-11 w-full items-center gap-2.5 rounded-lg border bg-card px-3 text-left text-sm transition-colors hover:border-primary/50 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ListChecks className="h-4 w-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate">{summaryText}</span>
        <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
      </button>

      {degradedWarn && (
        <p className="text-[11px] leading-relaxed grade-mid">
          ⚠ {mode === 'http' ? 'HTTP' : 'DNS'} 模式仅支持按线路测试：所选节点将按所属线路过滤执行，结果会包含线路上的全部节点
        </p>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>逐节点选择</DialogTitle>
            <DialogDescription>{dialogHint}</DialogDescription>
          </DialogHeader>
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="搜索节点" className="pl-8 h-8" />
          </div>
          <div className="max-h-80 space-y-4 overflow-y-auto pr-1">
            {filtered.map(([cat, list]) => {
              const allIn = list.every((n) => picked.has(n.id));
              return (
                <div key={cat}>
                  <div className="mb-1.5 flex items-center justify-between">
                    <span className="text-xs font-semibold text-muted-foreground">{cat}</span>
                    <button
                      type="button"
                      onClick={() => toggleAll(list)}
                      className="text-[10px] text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {allIn ? '取消全选' : '全选'}
                    </button>
                  </div>
                  <div className="grid grid-cols-2 gap-1.5">
                    {list.map((n) => (
                      <button
                        key={n.id}
                        type="button"
                        onClick={() => toggleNode(n.id)}
                        className={cn(
                          'flex items-center gap-2 rounded-md border px-2 py-1.5 text-left text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                          picked.has(n.id) ? 'border-primary bg-primary/10' : 'border-input hover:bg-accent',
                        )}
                      >
                        <span className="truncate">{n.name}</span>
                        <span className="num ml-auto text-[10px] text-muted-foreground">{n.id.slice(0, 4)}</span>
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
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
