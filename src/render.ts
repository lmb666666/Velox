import type { NodeStat, TestSummary } from './types.js';

/** 终端表格与导出。CJK 字符按 2 列宽计算对齐。 */

export function displayWidth(s: string): number {
  let w = 0;
  for (const ch of s) {
    const code = ch.codePointAt(0)!;
    w += code >= 0x2e80 && (code <= 0xa4cf || (code >= 0xac00 && code <= 0xd7a3) || (code >= 0xf900 && code <= 0xfaff) || (code >= 0xff00 && code <= 0xff60) || (code >= 0xffe0 && code <= 0xffe6)) ? 2 : 1;
  }
  return w;
}

function pad(s: string, width: number, alignRight = false): string {
  const gap = Math.max(0, width - displayWidth(s));
  return alignRight ? ' '.repeat(gap) + s : s + ' '.repeat(gap);
}

export interface Column {
  header: string;
  alignRight?: boolean;
  value: (row: NodeStat, index: number) => string;
}

function statLatency(s: NodeStat): string {
  return s.ok && s.latencyMs !== undefined ? `${s.latencyMs} ms` : `失败(${s.failReason ?? '?'})`;
}

export function columnsFor(mode: string): Column[] {
  if (mode === 'http') {
    return [
      { header: '#', alignRight: true, value: (_, i) => String(i + 1) },
      { header: '节点', value: (s) => s.name },
      { header: '运营商', value: (s) => s.carrier },
      { header: '响应IP', value: (s) => s.ip },
      { header: '状态码', alignRight: true, value: (s) => String(s.detail?.httpCode ?? '-') },
      { header: '总耗时', alignRight: true, value: (s) => fmtMs(s.detail?.allTime) },
      { header: 'DNS', alignRight: true, value: (s) => fmtMs(s.detail?.dnsTime) },
      { header: '连接', alignRight: true, value: (s) => fmtMs(s.detail?.connectTime) },
      { header: 'SSL', alignRight: true, value: (s) => fmtMs(s.detail?.sslTime) },
      { header: '下载', alignRight: true, value: (s) => fmtMs(s.detail?.downloadTime) },
      { header: '归属', value: (s) => s.address ?? '' },
    ];
  }
  if (mode === 'dns') {
    return [
      { header: '#', alignRight: true, value: (_, i) => String(i + 1) },
      { header: '节点', value: (s) => s.name },
      { header: '运营商', value: (s) => s.carrier },
      { header: '耗时', alignRight: true, value: (s) => statLatency(s) },
      { header: '解析结果', value: (s) => String(s.raw.result ?? '').slice(0, 80) },
    ];
  }
  if (mode === 'traceroute') {
    // traceroute 不走表格，由 renderTraceroute 分块渲染
    return [];
  }
  return [
    { header: '#', alignRight: true, value: (_, i) => String(i + 1) },
    { header: '节点', value: (s) => s.name },
    { header: '运营商', value: (s) => s.carrier },
    { header: '省份/区域', value: (s) => `${s.province}/${s.region}` },
    { header: '响应IP', value: (s) => s.ip },
    { header: '延迟', alignRight: true, value: (s) => statLatency(s) },
    { header: '归属', value: (s) => s.address ?? '' },
  ];
}

function fmtMs(v: number | undefined): string {
  return v === undefined || Number.isNaN(v) ? '-' : `${v} ms`;
}

function renderTraceroute(stats: NodeStat[]): string {
  const lines: string[] = [];
  for (const s of stats) {
    lines.push(`节点: ${s.name}（${s.carrier}）｜${s.address ?? '0 跳'}`);
    if (!s.ok) {
      lines.push('  （无数据）');
      continue;
    }
    lines.push('  TTL  IP                延迟        归属');
    for (const h of s.hops ?? []) {
      const lat = h.latencyMs !== undefined ? `${h.latencyMs} ms` : '-     ';
      const desc = [h.address, h.asnInfo, h.ptr ? `PTR:${h.ptr}` : ''].filter(Boolean).join('｜');
      lines.push(`  ${String(h.ttl).padEnd(4)} ${h.ip.padEnd(16)}${lat.padEnd(11)} ${desc}`);
    }
    lines.push('');
  }
  return lines.join('\n').trimEnd();
}

export function renderTable(mode: string, stats: NodeStat[]): string {
  if (mode === 'traceroute') return renderTraceroute(stats);
  const cols = columnsFor(mode);
  const rows = stats.map((s, i) => cols.map((c) => c.value(s, i)));
  const widths = cols.map((c, ci) =>
    Math.max(displayWidth(c.header), ...rows.map((r) => displayWidth(r[ci]))),
  );
  const sep = widths.map((w) => '-'.repeat(w + 2)).join('+');
  const head = '| ' + cols.map((c, ci) => pad(c.header, widths[ci], c.alignRight)).join(' | ') + ' |';
  const lines = [sep, head, sep];
  for (const r of rows) {
    lines.push('| ' + r.map((cell, ci) => pad(cell, widths[ci], cols[ci].alignRight)).join(' | ') + ' |');
  }
  lines.push(sep);
  return lines.join('\n');
}

export function renderSummary(summary: TestSummary, finished: boolean): string {
  const lines: string[] = [];
  const fmt = (v?: number) => (v === undefined ? '-' : `${v} ms`);
  lines.push(`目标: ${summary.targets.join(', ')}｜模式: ${summary.mode}｜结果: ${finished ? '已完成' : '超时截断(部分结果)'}`);
  lines.push(
    `节点: ${summary.totalNodes}｜成功: ${summary.okNodes}｜失败: ${summary.failedNodes}` +
      `｜平均: ${fmt(summary.overallAvg)}｜最快: ${fmt(summary.overallMin)}｜最慢: ${fmt(summary.overallMax)}`,
  );
  if (summary.carriers.length > 0) {
    const parts = summary.carriers.map((c) => {
      const avg = Number.isNaN(c.avg) ? '无数据' : `${c.avg} ms`;
      return `${c.carrier} ${c.ok}/${c.nodes} 均值${avg}`;
    });
    lines.push('分线路: ' + parts.join('｜'));
  }
  if (summary.top.length > 0) {
    const tops = summary.top.map((t) => `${t.name} ${t.latencyMs}ms`).join('、');
    lines.push(`最快 Top${summary.top.length}: ${tops}`);
  }
  return lines.join('\n');
}

export function toCsv(summary: TestSummary): string {
  const escape = (v: unknown) => {
    const s = String(v ?? '');
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const header = ['node_id', 'name', 'carrier', 'province', 'region', 'ip', 'ok', 'latency_ms', 'address', 'fail_reason'];
  const rows = summary.stats.map((s) =>
    [s.nodeId, s.name, s.carrier, s.province, s.region, s.ip, s.ok, s.latencyMs ?? '', s.address ?? '', s.failReason ?? '']
      .map(escape)
      .join(','),
  );
  return [header.join(','), ...rows].join('\n') + '\n';
}

export function toFullJson(summary: TestSummary, frames: unknown[], finished: boolean, reason: string): string {
  return JSON.stringify(
    { summary, finished, reason, frames },
    null,
    2,
  ) + '\n';
}
