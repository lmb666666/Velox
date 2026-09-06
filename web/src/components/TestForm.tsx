import { useState } from 'react';
import { Activity, ArrowRightLeft, FileSearch, Globe, Layers, Network, Play, Route } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { NodePicker } from '@/components/NodePicker';
import { MODES, type Mode, type NodesResponse, type TestRequest } from '@/lib/api';
import { cn } from '@/lib/utils';

const MODE_ICONS: Record<Mode, React.ComponentType<{ className?: string }>> = {
  ping: Activity,
  tcping: Network,
  http: Globe,
  dns: FileSearch,
  traceroute: Route,
  'batch-ping': Layers,
  'batch-tcping': ArrowRightLeft,
};

export function TestForm({
  running,
  nodesData,
  refreshingNodes,
  onRefreshNodes,
  onSubmit,
}: {
  running: boolean;
  nodesData: NodesResponse | null;
  refreshingNodes: boolean;
  onRefreshNodes: () => void;
  onSubmit: (req: TestRequest) => void;
}) {
  const [mode, setMode] = useState<Mode>('ping');
  const [singleTarget, setSingleTarget] = useState('www.baidu.com');
  const [batchTargets, setBatchTargets] = useState('1.1.1.1\n8.8.8.8');
  const [nodes, setNodes] = useState('all');
  const [port, setPort] = useState('443');
  const [timeoutSec, setTimeoutSec] = useState('90');
  const [checkMode, setCheckMode] = useState<'fast' | 'detail'>('fast');
  const [httpVersion, setHttpVersion] = useState('auto');
  const [dnsType, setDnsType] = useState('a');
  const [dnsServer, setDnsServer] = useState('');
  const [sort, setSort] = useState<'latency' | 'loss'>('latency');

  const modeDef = MODES.find((m) => m.value === mode)!;
  const isBatch = modeDef.batch;
  const targets: string[] = (isBatch ? batchTargets : singleTarget)
    .split('\n')
    .map((t) => t.trim())
    .filter(Boolean);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (targets.length === 0) return;
    onSubmit({
      mode,
      targets,
      nodes,
      port: Number.parseInt(port, 10) || 443,
      timeoutSec: Number.parseInt(timeoutSec, 10) || 90,
      sort,
      checkMode,
      httpVersion,
      dnsType,
      dnsServer,
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">新建测试</CardTitle>
        <CardDescription>{modeDef.hint}</CardDescription>
      </CardHeader>
      <CardContent>
        <form className="space-y-4" onSubmit={submit}>
        {/* 模式选择 */}
        <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="测速模式">
          {MODES.map((m) => {
            const Icon = MODE_ICONS[m.value];
            return (
              <button
                key={m.value}
                type="button"
                onClick={() => setMode(m.value)}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
                  mode === m.value
                    ? 'bg-primary text-primary-foreground shadow'
                    : 'border border-input text-muted-foreground hover:bg-accent hover:text-accent-foreground',
                )}
              >
                <Icon className="h-3.5 w-3.5" />
                {m.label}
              </button>
            );
          })}
        </div>

        {/* 目标 */}
        <div className="space-y-1.5">
          <Label htmlFor="targets">{isBatch ? `目标（每行一个，共 ${targets.length} 个）` : '目标'}</Label>
          {isBatch ? (
            <Textarea
              id="targets"
              value={batchTargets}
              onChange={(e) => setBatchTargets(e.target.value)}
              rows={4}
              className="num text-xs"
              placeholder={'每行一个目标，支持 IP / 域名 / CIDR\n1.1.1.1\n8.8.8.8'}
            />
          ) : (
            <Input
              id="targets"
              value={singleTarget}
              onChange={(e) => setSingleTarget(e.target.value)}
              placeholder={mode === 'http' ? 'https://www.example.com' : '域名或 IP'}
              className="num"
            />
          )}
        </div>

        {/* 模式专属选项 */}
        {(mode === 'tcping' || mode === 'batch-tcping') && (
          <div className="space-y-1.5">
            <Label htmlFor="port">端口</Label>
            <Input id="port" value={port} onChange={(e) => setPort(e.target.value)} className="num" />
          </div>
        )}
        {mode === 'http' && (
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>检测模式</Label>
              <Select value={checkMode} onValueChange={(v) => setCheckMode(v as 'fast' | 'detail')}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="fast">fast 快速</SelectItem>
                  <SelectItem value="detail">detail 详细</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>HTTP 版本</Label>
              <Select value={httpVersion} onValueChange={setHttpVersion}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="auto">auto</SelectItem>
                  <SelectItem value="http_1_1">HTTP/1.1</SelectItem>
                  <SelectItem value="http_2">HTTP/2</SelectItem>
                  <SelectItem value="http_3">HTTP/3</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        )}
        {mode === 'dns' && (
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>记录类型</Label>
              <Select value={dnsType} onValueChange={setDnsType}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {['a', 'cname', 'mx', 'aaaa', 'ns', 'txt'].map((t) => (
                    <SelectItem key={t} value={t} className="uppercase">{t}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="dnsServer">自定义 DNS（可选）</Label>
              <Input id="dnsServer" value={dnsServer} onChange={(e) => setDnsServer(e.target.value)} placeholder="如 223.5.5.5" className="num" />
            </div>
          </div>
        )}

        {/* 节点选择 */}
        <div className="space-y-1.5">
          <Label>节点选择</Label>
          <NodePicker
            spec={nodes}
            onSpecChange={setNodes}
            nodesData={nodesData}
            batch={isBatch}
            onRefresh={onRefreshNodes}
            refreshing={refreshingNodes}
          />
        </div>

        {/* 高级 */}
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="timeout">整体超时（秒）</Label>
            <Input id="timeout" value={timeoutSec} onChange={(e) => setTimeoutSec(e.target.value)} className="num" />
          </div>
          <div className="space-y-1.5">
            <Label>结果排序</Label>
            <Select value={sort} onValueChange={(v) => setSort(v as 'latency' | 'loss')}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="latency">按延迟（快在前）</SelectItem>
                <SelectItem value="loss">按失败（排查用）</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <Button
          type="submit"
          disabled={running || targets.length === 0}
          className="w-full bg-gradient-to-r from-teal-400 to-sky-500 font-semibold text-zinc-950 shadow-md transition-transform hover:from-teal-300 hover:to-sky-400 hover:shadow-lg hover:shadow-cyan-500/20 active:scale-[0.99] dark:text-zinc-950"
        >
          <Play className="h-4 w-4" />
          {running ? '测试进行中…' : `开始测速（${targets.length} 个目标）`}
        </Button>
        </form>
      </CardContent>
    </Card>
  );
}
