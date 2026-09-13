import { useState } from 'react';
import { Activity, ArrowRightLeft, ChevronDown, FileSearch, Globe, Layers, Network, Play, Route, Settings2, Server } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { NodePicker } from '@/components/NodePicker';
import { isPureLineSpec, MODES, PROVIDERS, type Mode, type NodesResponse, type ProviderValue, type TestRequest } from '@/lib/api';
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

const PROVIDER_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  auto: Server,
  itdog: Server,
};

export function TestForm({
  running,
  nodesData,
  refreshingNodes,
  provider,
  onProviderChange,
  onRefreshNodes,
  onSubmit,
}: {
  running: boolean;
  nodesData: NodesResponse | null;
  refreshingNodes: boolean;
  provider: ProviderValue;
  onProviderChange: (p: ProviderValue) => void;
  onRefreshNodes: () => void;
  onSubmit: (req: TestRequest) => void;
}) {
  const [mode, setMode] = useState<Mode>('ping');
  const [singleTarget, setSingleTarget] = useState('www.baidu.com');
  const [batchTargets, setBatchTargets] = useState('1.1.1.1\n8.8.8.8');
  const [nodes, setNodes] = useState('all');
  const [port, setPort] = useState('443');
  const [timeoutSec, setTimeoutSec] = useState('90');
  const [checkMode, setCheckMode] = useState<'fast' | 'slow'>('fast');
  const [httpVersion, setHttpVersion] = useState('auto');
  const [method, setMethod] = useState<'get' | 'post'>('get');
  const [referer, setReferer] = useState('');
  const [httpUa, setHttpUa] = useState('');
  const [cookie, setCookie] = useState('');
  const [redirects, setRedirects] = useState('5');
  const [resolveTo, setResolveTo] = useState('');
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [dnsMode, setDnsMode] = useState<'isp' | 'custom'>('isp');
  const [dnsType, setDnsType] = useState('a');
  const [dnsServer, setDnsServer] = useState('');
  const [sort, setSort] = useState<'latency' | 'loss'>('latency');
  const [idleTimeout, setIdleTimeout] = useState('12');
  const [top, setTop] = useState('5');
  const [retry, setRetry] = useState('2');

  const modeDef = MODES.find((m) => m.value === mode)!;
  const isBatch = modeDef.batch;
  const targets: string[] = (isBatch ? batchTargets : singleTarget)
    .split('\n')
    .map((t) => t.trim())
    .filter(Boolean);

  /** ping/tcping/http/dns 四种模式支持指定解析 DNS（与官方页一致） */
  const supportsDns = mode === 'ping' || mode === 'tcping' || mode === 'http' || mode === 'dns';

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (targets.length === 0) return;
    const req: TestRequest = {
      mode,
      targets,
      nodes,
      provider,
      port: Number.parseInt(port, 10) || 443,
      timeoutSec: Number.parseInt(timeoutSec, 10) || 90,
      sort,
      checkMode,
      httpVersion,
      dnsType,
      dnsServer: dnsMode === 'custom' ? dnsServer.trim() : '',
    };
    // 通用高级参数（透传，后端会夹取）
    req.idleTimeoutSec = Number.parseInt(idleTimeout, 10) || 12;
    req.top = Number.parseInt(top, 10) || 5;
    req.retry = Number.parseInt(retry, 10) || 2;
    if (mode === 'http') {
      req.method = method;
      req.referer = referer.trim();
      req.cookie = cookie.trim();
      req.httpUa = httpUa.trim();
      req.resolveTo = resolveTo.trim();
      req.redirects = Number.parseInt(redirects, 10) || 5;
    }
    onSubmit(req);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">新建测试</CardTitle>
        <CardDescription>{modeDef.hint}</CardDescription>
      </CardHeader>
      <CardContent>
        <form className="space-y-5" onSubmit={submit}>
          {/* ① 测速上游 */}
          <div className="space-y-1.5">
            <Label>测速上游</Label>
            <div className="grid grid-cols-2 gap-1.5">
              {PROVIDERS.map((p) => {
                const Icon = PROVIDER_ICONS[p.value] ?? Server;
                const active = provider === p.value;
                return (
                  <button
                    key={p.value}
                    type="button"
                    onClick={() => onProviderChange(p.value as ProviderValue)}
                    aria-pressed={active}
                    title={p.hint}
                    className={cn(
                      'inline-flex flex-col items-start gap-0.5 rounded-md border px-2.5 py-2 text-left text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                      active
                        ? 'border-primary bg-primary/10 text-primary'
                        : 'border-input text-muted-foreground hover:bg-accent',
                    )}
                  >
                    <span className="inline-flex items-center gap-1 font-medium">
                      <Icon className="h-3.5 w-3.5" />
                      {p.label}
                    </span>
                    <span className="w-full truncate text-[10px] opacity-70">{p.hint}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* ② 模式选择 */}
          <div className="space-y-1.5">
            <Label>测速模式</Label>
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="测速模式">
              {MODES.map((m) => {
                const Icon = MODE_ICONS[m.value];
                return (
                  <button
                    key={m.value}
                    type="button"
                    onClick={() => setMode(m.value)}
                    aria-pressed={mode === m.value}
                    className={cn(
                      'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
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
          </div>

          {/* ③ 目标 */}
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

          {/* ④ 模式专属选项 */}
          {(mode === 'tcping' || mode === 'batch-tcping') && (
            <div className="space-y-1.5">
              <Label htmlFor="port">端口</Label>
              <Input id="port" value={port} onChange={(e) => setPort(e.target.value)} className="num" />
            </div>
          )}
          {mode === 'http' && (
            <div className="space-y-2.5">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>检测模式</Label>
                  <Select value={checkMode} onValueChange={(v) => setCheckMode(v as 'fast' | 'slow')}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="fast">快速测试</SelectItem>
                      <SelectItem value="slow">缓慢测试（更精细）</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>HTTP 协议</Label>
                  <Select value={httpVersion} onValueChange={setHttpVersion}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="auto">默认 http2（向下兼容）</SelectItem>
                      <SelectItem value="http_1_1">强制 http1.1</SelectItem>
                      <SelectItem value="http_2">强制 http2（目标需 https）</SelectItem>
                      <SelectItem value="http_3">强制 http3（目标需 https）</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* 高级选项（对齐 itdog 网站测速面板） */}
              <div>
                <button
                  type="button"
                  onClick={() => setAdvancedOpen((v) => !v)}
                  aria-expanded={advancedOpen}
                  className="inline-flex cursor-pointer items-center gap-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <Settings2 className="h-3.5 w-3.5" />
                  高级选项
                  <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', advancedOpen && 'rotate-180')} />
                </button>
                {advancedOpen && (
                  <div className="mt-2 grid gap-3 rounded-lg border bg-muted/30 p-3 sm:grid-cols-2">
                    <div className="space-y-1.5 sm:col-span-2">
                      <Label htmlFor="resolveTo">指定解析</Label>
                      <Input
                        id="resolveTo"
                        value={resolveTo}
                        onChange={(e) => setResolveTo(e.target.value)}
                        placeholder="强制解析此内容，可指定 IPv4、域名，如 1.1.1.1"
                        className="num h-8 text-xs"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label>method</Label>
                      <div className="flex gap-1.5">
                        {(['get', 'post'] as const).map((m) => (
                          <button
                            key={m}
                            type="button"
                            onClick={() => setMethod(m)}
                            aria-pressed={method === m}
                            className={cn(
                              'rounded-md px-3 py-1.5 text-xs font-medium uppercase transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                              method === m
                                ? 'bg-primary text-primary-foreground'
                                : 'border border-input text-muted-foreground hover:bg-accent',
                            )}
                          >
                            {m}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="redirects">重定向次数（0~10）</Label>
                      <Input id="redirects" value={redirects} onChange={(e) => setRedirects(e.target.value)} className="num h-8" />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="referer">referer</Label>
                      <Input id="referer" value={referer} onChange={(e) => setReferer(e.target.value)} placeholder="例：https://www.baidu.com" className="num h-8 text-xs" />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="cookie">cookie</Label>
                      <Input id="cookie" value={cookie} onChange={(e) => setCookie(e.target.value)} placeholder="例：key=123;page=123" className="num h-8 text-xs" />
                    </div>
                    <div className="space-y-1.5 sm:col-span-2">
                      <Label htmlFor="http-ua">user-agent</Label>
                      <Input id="http-ua" value={httpUa} onChange={(e) => setHttpUa(e.target.value)} placeholder="留空使用默认（监测节点请求目标时携带）" className="num h-8 text-xs" />
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
          {mode === 'dns' && (
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
          )}

          {/* DNS 解析（对齐官方页底部 运营商DNS / 指定DNS） */}
          {supportsDns && (
            <div className="space-y-1.5">
              <Label>DNS 解析</Label>
              <div className="flex items-center gap-2">
                <div className="flex gap-1.5">
                  {([
                    { key: 'isp', label: '运营商DNS' },
                    { key: 'custom', label: '指定DNS' },
                  ] as const).map((o) => (
                    <button
                      key={o.key}
                      type="button"
                      onClick={() => setDnsMode(o.key)}
                      aria-pressed={dnsMode === o.key}
                      className={cn(
                        'rounded-full border px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                        dnsMode === o.key
                          ? 'border-primary bg-primary/10 text-primary'
                          : 'border-input text-muted-foreground hover:bg-accent',
                      )}
                    >
                      {o.label}
                    </button>
                  ))}
                </div>
                {dnsMode === 'custom' && (
                  <Input value={dnsServer} onChange={(e) => setDnsServer(e.target.value)} placeholder="例如：223.5.5.5" className="num h-8 flex-1" />
                )}
              </div>
              {/* 互斥约束：批量端点无 DNS 参数，指定 DNS 时精确节点选择回退为线路过滤 */}
              {(mode === 'ping' || mode === 'tcping') && dnsMode === 'custom' && dnsServer.trim() !== '' && !isPureLineSpec(nodes) && (
                <p className="text-[11px] leading-relaxed grade-mid">
                  ⚠ 指定 DNS 与精确节点选择互斥：本次将回退为按线路测试
                </p>
              )}
            </div>
          )}

          {/* ⑤ 节点选择（含来源徽标） */}
          <div className="space-y-1.5">
            <Label>
              节点选择
              {nodesData?.provider && (
                <span className="ml-1.5 rounded grade-fine-bg px-1.5 py-0.5 text-[10px]">itdog.cn</span>
              )}
            </Label>
            <NodePicker
              spec={nodes}
              onSpecChange={setNodes}
              nodesData={nodesData}
              mode={mode}
              onRefresh={onRefreshNodes}
              refreshing={refreshingNodes}
            />
          </div>

          {/* ⑥ 通用自定义设置 */}
          <div className="space-y-2.5">
            <Label>通用设置</Label>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="timeout">整体超时（秒）</Label>
                <Input id="timeout" value={timeoutSec} onChange={(e) => setTimeoutSec(e.target.value)} className="num" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="idle-timeout">空闲超时（秒）</Label>
                <Input id="idle-timeout" value={idleTimeout} onChange={(e) => setIdleTimeout(e.target.value)} className="num" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="top">最快 Top N</Label>
                <Input id="top" value={top} onChange={(e) => setTop(e.target.value)} className="num" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="retry">创建重试次数</Label>
                <Input id="retry" value={retry} onChange={(e) => setRetry(e.target.value)} className="num" />
              </div>
              <div className="space-y-1.5 col-span-2">
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
          </div>

          <Button
            type="submit"
            disabled={running || targets.length === 0}
            className="w-full font-semibold shadow-sm transition-transform active:scale-[0.99]"
          >
            <Play className="h-4 w-4" />
            {running ? '测试进行中…' : `开始测速（${targets.length} 个目标）`}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
