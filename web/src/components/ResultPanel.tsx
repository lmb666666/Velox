import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { AlertTriangle, CheckCircle2, Clock3, Download, Gauge, MapPin, Timer, XCircle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { VeloxMark } from '@/components/BrandLogo';
import { ChinaMap } from '@/components/ChinaMap';
import type { Frame, Mode, NodeStat, RunResult } from '@/lib/api';
import { cn } from '@/lib/utils';

function fmtMs(v: number | undefined | null): string {
  return v === undefined || v === null || Number.isNaN(v) ? '-' : `${v} ms`;
}

/** 质量四级（品牌规范）：优 ≤50 / 良 ≤150 / 中 ≤300 / 差 >300，等级字标保证无障碍 */
function gradeOf(ms: number): { label: string; cls: string } {
  if (ms <= 50) return { label: '优', cls: 'grade-ok' };
  if (ms <= 150) return { label: '良', cls: 'grade-fine' };
  if (ms <= 300) return { label: '中', cls: 'grade-mid' };
  return { label: '差', cls: 'grade-bad' };
}
function latencyClass(ms: number): string {
  return gradeOf(ms).cls;
}

function frameOk(f: Frame): boolean {
  if (f.type !== undefined && f.type !== 'success') return false;
  if (f.ip === 'Not Found' || f.ip === '0.0.0.0') return false;
  if (f.http_code !== undefined) return f.http_code > 0;
  const n = typeof f.result === 'number' ? f.result : Number.parseFloat(String(f.result ?? ''));
  return Number.isFinite(n) && n >= 0;
}

export type ResultPhase = 'idle' | 'running' | 'done' | 'error';

export function ResultPanel({
  phase,
  frames,
  statusLines,
  result,
  error,
  taskId,
}: {
  phase: ResultPhase;
  frames: Frame[];
  statusLines: string[];
  result: RunResult | null;
  error?: string;
  taskId?: string;
}) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (phase !== 'running') return;
    setElapsed(0);
    const timer = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(timer);
  }, [phase]);

  // 地图省份筛选：任务切换时自动清空
  const [mapFilter, setMapFilter] = useState<string | null>(null);
  useEffect(() => {
    setMapFilter(null);
  }, [result, taskId]);

  if (phase === 'idle') {
    const steps = [
      { n: '1', title: '输入目标', desc: 'IP / 域名 / CIDR 网段' },
      { n: '2', title: '选择节点', desc: '全国 290+ 监测点，三网与海外' },
      { n: '3', title: '实时看结果', desc: '逐帧推送，汇总排序，一键导出' },
    ];
    return (
      <Card className="flex min-h-80 items-center justify-center border-dashed">
        <div className="flex flex-col items-center gap-6 px-6 py-10 text-center">
          <VeloxMark size={52} variant="mono" className="opacity-40" />
          <div className="grid gap-3 sm:grid-cols-3">
            {steps.map((s) => (
              <div key={s.n} className="w-44 rounded-lg border bg-card/50 p-3">
                <div className="num mb-1 text-xs font-bold text-primary">{s.n}</div>
                <div className="text-sm font-medium">{s.title}</div>
                <div className="mt-0.5 text-xs text-muted-foreground">{s.desc}</div>
              </div>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">每一次探测，都是脉搏</p>
        </div>
      </Card>
    );
  }

  if (phase === 'error') {
    return (
      <Card className="border-destructive/40">
        <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
          <XCircle className="h-8 w-8 text-red-500" />
          <p className="text-sm font-medium">测试失败</p>
          <p className="max-w-md text-sm text-muted-foreground">{error}</p>
        </CardContent>
      </Card>
    );
  }

  const running = phase === 'running';
  const summary = result?.summary;

  return (
    <div className="flex flex-1 flex-col space-y-4">
      {/* 运行中：状态卡 */}
      {running && (
        <Card>
          <CardContent className="flex min-h-[7.5rem] items-center gap-4 px-5 py-5">
            <VeloxMark size={44} loading className="shrink-0" />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 text-sm font-medium">
                测试进行中
                <Badge variant="secondary" className="num">{frames.length} 帧</Badge>
              </div>
              <div className="num mt-1 text-xs text-muted-foreground">
                已运行 {elapsed}s｜{statusLines[statusLines.length - 1] ?? '正在排队…'}
              </div>
            </div>
            <div className="hidden gap-2 sm:flex">
              <Badge variant="success" className="num">{frames.filter(frameOk).length} 成功</Badge>
              <Badge variant="danger" className="num">{frames.filter((f) => !frameOk(f)).length} 失败</Badge>
            </div>
          </CardContent>
        </Card>
      )}

      {/* 任务元信息 */}
      {summary && (
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline">{summary.mode}</Badge>
          <span className="num text-sm font-medium">{summary.targets.join(', ')}</span>
          {result!.finished ? (
            <Badge variant="success">已完成</Badge>
          ) : (
            <Badge className="bg-amber-500/15 text-amber-500 hover:bg-amber-500/15">部分结果</Badge>
          )}
        </div>
      )}

      {/* 汇总指标卡 */}
      {summary && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[
            { icon: Gauge, label: '平均延迟', value: fmtMs(summary.overallAvg), tint: 'bg-primary/10 text-primary' },
            { icon: Timer, label: '最快', value: fmtMs(summary.overallMin), tint: 'bg-emerald-500/10 text-emerald-500' },
            { icon: Clock3, label: '最慢', value: fmtMs(summary.overallMax), tint: 'bg-amber-500/10 text-amber-500' },
            {
              icon: CheckCircle2,
              label: '成功率',
              value: summary.totalNodes > 0 ? `${Math.round((summary.okNodes / summary.totalNodes) * 100)}%` : '-',
              tint: 'bg-sky-500/10 text-sky-500',
              sub: `${summary.okNodes}/${summary.totalNodes} 节点`,
            },
          ].map((c, i) => (
            <motion.div
              key={c.label}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.06, duration: 0.25 }}
            >
              <Card className="transition-all hover:-translate-y-0.5 hover:shadow-md">
                <CardContent className="flex flex-col gap-3 p-5">
                  <div className={cn('flex h-10 w-10 items-center justify-center rounded-xl', c.tint)}>
                    <c.icon className="h-5 w-5" />
                  </div>
                  <div className="min-w-0">
                    <div className="text-xs text-muted-foreground">{c.label}</div>
                    <div className="num mt-1.5 truncate text-[1.65rem] font-semibold leading-none">{c.value}</div>
                    <div className="num mt-1.5 h-4 text-[11px] text-muted-foreground">{c.sub ?? ''}</div>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          ))}
        </div>
      )}

      {/* 中国地图（itdog 风格省份着色） */}
      {summary && summary.mode !== 'traceroute' && summary.stats.some((s) => s.province !== '未知' && s.province !== '境外') && (
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <MapPin className="h-4 w-4 text-muted-foreground" />
              节点分布地图
            </CardTitle>
            {mapFilter && (
              <button type="button" onClick={() => setMapFilter(null)} className="cursor-pointer">
                <Badge variant="default">筛选: {mapFilter} ✕</Badge>
              </button>
            )}
          </CardHeader>
          <CardContent>
            <ChinaMap stats={summary.stats} filter={mapFilter} onFilterChange={setMapFilter} />
          </CardContent>
        </Card>
      )}

      {/* 分线路条形 */}
      {summary && summary.carriers.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">分线路平均延迟</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2.5">
            {summary.carriers.map((c) => {
              const maxAvg = Math.max(...summary.carriers.map((x) => x.avg || 0), 1);
              const width = Math.max(4, Math.round(((c.avg || 0) / maxAvg) * 100));
              return (
                <div key={c.carrier} className="flex items-center gap-3 text-xs">
                  <span className="w-12 shrink-0 font-medium">{c.carrier}</span>
                  <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-muted">
                    <motion.div
                      className="h-full rounded-full bg-gradient-to-r from-teal-400 to-sky-500"
                      initial={{ width: 0 }}
                      animate={{ width: `${width}%` }}
                      transition={{ duration: 0.5, ease: 'easeOut' }}
                    />
                  </div>
                  <span className="num w-28 shrink-0 text-right text-muted-foreground">
                    {c.ok}/{c.nodes} · {Number.isNaN(c.avg) ? '-' : `${c.avg} ms`}
                  </span>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      {/* TopN */}
      {summary && summary.top.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">最快节点 Top {summary.top.length}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {summary.top.map((t, i) => (
              <span
                key={t.nodeId + String(i)}
                className={cn(
                  'num inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium',
                  i === 0 && 'border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400',
                  i === 1 && 'border-zinc-400/40 bg-zinc-400/10 text-zinc-600 dark:text-zinc-300',
                  i === 2 && 'border-orange-400/40 bg-orange-400/10 text-orange-600 dark:text-orange-400',
                  i >= 3 && 'border-input text-muted-foreground',
                )}
              >
                <span className="opacity-70">#{i + 1}</span>
                {t.name}
                <span className={latencyClass(t.latencyMs ?? 0)}>{t.latencyMs}ms</span>
              </span>
            ))}
          </CardContent>
        </Card>
      )}

      {/* 明细表 */}
      {summary && summary.stats.length > 0 && (
        <Card className="flex flex-1 flex-col">
          <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm">
              节点明细 <span className="num text-muted-foreground">({summary.stats.length})</span>
            </CardTitle>
            <div className="flex gap-2">
              {summary.targets.length === 1 && /[a-zA-Z]/.test(summary.targets[0]) && (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 gap-1 text-xs"
                  onClick={() => downloadHosts(summary)}
                  title="生成 hosts 优选文件（按实测延迟排序）"
                >
                  <Download className="h-3 w-3" /> Hosts
                </Button>
              )}
              <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => downloadCsv(summary)}>
                <Download className="h-3 w-3" /> CSV
              </Button>
              <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => downloadJson(result!)}>
                <Download className="h-3 w-3" /> JSON
              </Button>
            </div>
          </CardHeader>
          <CardContent className="min-h-0 flex-1 overflow-y-auto">
            {!result!.finished && (
              <div className="mb-2 flex items-center gap-1.5 text-xs text-amber-500">
                <AlertTriangle className="h-3.5 w-3.5" />
                未收到完成信号（{result!.reason}），以下为已收到的部分结果
              </div>
            )}
            {summary.mode === 'traceroute' ? (
              <TracerouteView stats={summary.stats} />
            ) : (
              <StatsTable
                mode={summary.mode}
                stats={mapFilter ? summary.stats.filter((s) => s.province === mapFilter) : summary.stats}
              />
            )}
          </CardContent>
        </Card>
      )}

      {/* 实时帧表（运行中且尚无汇总时也可见） */}
      {running && frames.length > 0 && (
        <Card className="flex flex-1 flex-col">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">实时结果流</CardTitle>
          </CardHeader>
          <CardContent className="min-h-0 flex-1 overflow-y-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12">#</TableHead>
                  <TableHead>节点</TableHead>
                  <TableHead>IP</TableHead>
                  <TableHead className="text-right">结果</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {frames.slice(-120).reverse().map((f, i) => {
                  const n = typeof f.result === 'number' ? f.result : Number.parseFloat(String(f.result ?? ''));
                  return (
                    <motion.tr
                      key={String(f.node_id ?? '') + i + String(f.ip)}
                      initial={{ opacity: 0, y: 4 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.2 }}
                      className="border-b text-xs"
                    >
                      <td className="num px-2 py-1.5 text-muted-foreground">{frames.length - frames.slice(-120).length + i + 1}</td>
                      <td className="px-2 py-1.5">{String(f.name ?? '')}</td>
                      <td className="num px-2 py-1.5">{String(f.ip ?? '')}</td>
                      <td className={cn('num px-2 py-1.5 text-right', frameOk(f) && Number.isFinite(n) ? latencyClass(n) : 'text-red-400')}>
                        {f.result !== undefined ? `${f.result} ms` : f.all_time !== undefined ? `${f.all_time} ms` : '失败'}
                      </td>
                    </motion.tr>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* 页脚元信息 */}
      {result && taskId && <div className="num text-right text-[11px] text-muted-foreground">任务 {taskId}</div>}
    </div>
  );
}

function StatsTable({ mode, stats }: { mode: Mode; stats: NodeStat[] }) {
  const isHttp = mode === 'http';
  const isDns = mode === 'dns';
  return (
    <div className="max-h-[28rem] overflow-y-auto">
      <Table>
        <TableHeader className="sticky top-0 z-10 bg-card">
          <TableRow>
            <TableHead className="w-12">#</TableHead>
            <TableHead>节点</TableHead>
            <TableHead className="hidden sm:table-cell">运营商</TableHead>
            {!isHttp && !isDns && <TableHead className="hidden md:table-cell">省份/区域</TableHead>}
            <TableHead>响应IP</TableHead>
            {!isDns && <TableHead className="text-right">延迟</TableHead>}
            {isHttp && <TableHead className="text-right">状态码</TableHead>}
            {isHttp && <TableHead className="hidden lg:table-cell text-right">DNS</TableHead>}
            {isHttp && <TableHead className="hidden lg:table-cell text-right">连接</TableHead>}
            {isHttp && <TableHead className="hidden lg:table-cell text-right">SSL</TableHead>}
            {isHttp && <TableHead className="hidden lg:table-cell text-right">下载</TableHead>}
            <TableHead className="hidden lg:table-cell">归属</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {stats.map((s, i) => (
            <motion.tr
              key={`${s.nodeId}|${s.ip}|${i}`}
              initial={{ opacity: 0, y: 3 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.18, delay: Math.min(i * 0.008, 0.4) }}
              className="border-b text-xs"
            >
              <TableCell className="num text-muted-foreground">{i + 1}</TableCell>
              <TableCell className="max-w-36 truncate font-medium">{s.name}</TableCell>
              <TableCell className="hidden sm:table-cell">{s.carrier}</TableCell>
              {!isHttp && !isDns && <TableCell className="hidden md:table-cell text-muted-foreground">{s.province}/{s.region}</TableCell>}
              <TableCell className="num">{s.ip}</TableCell>
              {!isDns && (
                <TableCell className={cn('num text-right', s.ok && s.latencyMs !== undefined ? latencyClass(s.latencyMs) : 'text-red-400')}>
                  {s.ok ? (
                    <>
                      {fmtMs(s.latencyMs)}
                      <span className="ml-1 text-[10px] opacity-75">{gradeOf(s.latencyMs!).label}</span>
                    </>
                  ) : (
                    `失败(${s.failReason ?? '?'})`
                  )}
                </TableCell>
              )}
              {isHttp && <TableCell className="num text-right">{s.detail?.httpCode ?? '-'}</TableCell>}
              {isHttp && <TableCell className="num hidden lg:table-cell text-right">{fmtMs(s.detail?.dnsTime)}</TableCell>}
              {isHttp && <TableCell className="num hidden lg:table-cell text-right">{fmtMs(s.detail?.connectTime)}</TableCell>}
              {isHttp && <TableCell className="num hidden lg:table-cell text-right">{fmtMs(s.detail?.sslTime)}</TableCell>}
              {isHttp && <TableCell className="num hidden lg:table-cell text-right">{fmtMs(s.detail?.downloadTime)}</TableCell>}
              <TableCell className="hidden lg:table-cell max-w-40 truncate text-muted-foreground">{s.address ?? ''}</TableCell>
            </motion.tr>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function TracerouteView({ stats }: { stats: NodeStat[] }) {
  return (
    <div className="space-y-4">
      {stats.map((s) => (
        <div key={s.nodeId} className="rounded-lg border p-3">
          <div className="mb-2 flex items-center gap-2 text-sm font-medium">
            {s.name}
            <Badge variant="secondary">{s.address ?? '0 跳'}</Badge>
            {!s.ok && <Badge variant="danger">{s.failReason ?? '无数据'}</Badge>}
          </div>
          <div className="num space-y-1 text-xs">
            {(s.hops ?? []).map((h) => (
              <div key={h.ttl} className="flex gap-3">
                <span className="w-8 shrink-0 text-right text-muted-foreground">{h.ttl}</span>
                <span className="w-36 shrink-0">{h.ip || '*'}</span>
                <span className={cn('w-20 shrink-0', h.latencyMs !== undefined ? latencyClass(h.latencyMs) : '')}>
                  {h.latencyMs !== undefined ? `${h.latencyMs} ms` : '-'}
                </span>
                <span className="truncate text-muted-foreground">
                  {[h.address, h.asnInfo, h.ptr ? `PTR:${h.ptr}` : ''].filter(Boolean).join(' ｜ ')}
                </span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function download(name: string, mime: string, content: string): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

function downloadCsv(summary: RunResult['summary']): void {
  const esc = (v: unknown) => {
    const s = String(v ?? '');
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const header = ['node_id', 'name', 'carrier', 'province', 'region', 'ip', 'ok', 'latency_ms', 'address', 'fail_reason'];
  const rows = summary.stats.map((s) =>
    [s.nodeId, s.name, s.carrier, s.province, s.region, s.ip, s.ok, s.latencyMs ?? '', s.address ?? '', s.failReason ?? '']
      .map(esc)
      .join(','),
  );
  download(`velox-${summary.mode}-${Date.now()}.csv`, 'text/csv', [header.join(','), ...rows].join('\n') + '\n');
}

function downloadHosts(summary: RunResult['summary']): void {
  const target = summary.targets[0] ?? '';
  const lines: string[] = [
    '# Velox IP 优选结果（Inspect. Select. Accelerate.）',
    `# 目标: ${target} · 实测节点: ${summary.stats.length} · 生成时间: ${new Date().toLocaleString('zh-CN')}`,
    '#',
  ];
  const seen = new Set<string>();
  for (const s of summary.stats) {
    if (!s.ok || !s.ip || seen.has(s.ip)) continue;
    seen.add(s.ip);
    lines.push(`${s.ip.padEnd(16)}  ${target}   # ${s.name} · ${s.latencyMs}ms`);
    if (seen.size >= 10) break;
  }
  download(`velox-hosts-${target}-${Date.now()}.txt`, 'text/plain', lines.join('\n') + '\n');
}

function downloadJson(result: RunResult): void {
  download(
    `velox-${result.summary.mode}-${Date.now()}.json`,
    'application/json',
    JSON.stringify({ meta: { brand: 'Velox', generatedAt: new Date().toISOString() }, ...result }, null, 2),
  );
}
