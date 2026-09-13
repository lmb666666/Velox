import { CARRIER_BY_LINE, PROVINCE_BY_CODE, REGION_BY_CODE } from './config.js';
import type { CarrierSummary, Frame, HopInfo, Mode, NodeStat, TestSummary } from './types.js';

/** WS 帧 → 节点统计。失败判定：DNS 解析失败（ip=Not Found）、无 result、非法 IP。 */

function parseLatency(v: unknown): number | undefined {
  if (v === undefined || v === null || v === '') return undefined;
  const n = typeof v === 'number' ? v : Number.parseFloat(String(v));
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

/** itdog http 帧的耗时字段（all/dns/connect/ssl/download）单位是秒，统一转毫秒 */
function secondsToMs(v: unknown): number | undefined {
  const n = parseLatency(v);
  return n === undefined ? undefined : Math.round(n * 1000 * 10) / 10;
}

function validIp(ip: string | undefined): boolean {
  if (!ip) return false;
  return ip !== 'Not Found' && ip !== '0.0.0.0' && ip !== '' && ip !== '127.0.0.1';
}

export function normalizeFrame(frame: Frame, mode: Mode): NodeStat {
  const base: NodeStat = {
    nodeId: String(frame.node_id ?? ''),
    name: String(frame.name ?? '(未知节点)'),
    carrier: CARRIER_BY_LINE[frame.line ?? -1] ?? (frame.line === undefined ? '未知' : `线路${frame.line}`),
    province: PROVINCE_BY_CODE[frame.province ?? -1] ?? '未知',
    region: REGION_BY_CODE[frame.region ?? -1] ?? '未知',
    ip: String(frame.ip ?? ''),
    ok: false,
    address: frame.address ? String(frame.address) : undefined,
    raw: frame,
  };

  if (mode === 'http') {
    const code = typeof frame.http_code === 'number' ? frame.http_code : 0;
    const all = secondsToMs(frame.all_time);
    base.ok = frame.type === 'success' && code > 0 && all !== undefined;
    base.latencyMs = all;
    base.failReason = base.ok ? undefined : code > 0 ? `HTTP ${code}` : String(frame.result ?? frame.type ?? '请求失败');
    base.detail = {
      httpCode: code > 0 ? code : undefined,
      allTime: all,
      dnsTime: secondsToMs(frame.dns_time),
      connectTime: secondsToMs(frame.connect_time),
      sslTime: secondsToMs(frame.ssl_time),
      downloadTime: secondsToMs(frame.download_time),
      redirectTime: secondsToMs(frame.redirect_time),
    };
    return base;
  }

  if (mode === 'dns') {
    const t = parseLatency(frame.time);
    const success = frame.type === 'success' || t !== undefined;
    base.ok = success;
    base.latencyMs = t;
    base.ip = String(frame.ip ?? '');
    base.failReason = success ? undefined : String(frame.result ?? '解析失败');
    return base;
  }

  if (mode === 'traceroute') {
    // 逐跳帧：ok 表示该帧有效，聚合层按 node_id 分组统计跳数
    base.ok = frame.hop !== undefined || frame.ip !== undefined;
    base.failReason = base.ok ? undefined : '无数据';
    return base;
  }

  // ping / tcping / batch-ping / batch-tcping
  const latency = parseLatency(frame.result);
  if (!validIp(base.ip)) {
    base.failReason = base.ip === 'Not Found' ? 'DNS 解析失败' : `IP 无效(${base.ip || '空'})`;
  } else if (latency === undefined) {
    base.failReason = '无延迟数据（可能超时）';
  } else {
    base.ok = true;
    base.latencyMs = latency;
  }
  return base;
}

export function buildSummary(
  mode: Mode,
  targets: string[],
  frames: Frame[],
  finished: boolean,
  topN: number,
  sortBy: 'latency' | 'loss',
): TestSummary {
  if (mode === 'traceroute') return tracerouteSummary(mode, targets, frames, finished);

  const byNode = new Map<string, NodeStat>();
  for (const f of frames) {
    const stat = normalizeFrame(f, mode);
    // 批量模式多目标：同一节点会对每个目标各发一帧，按 节点+响应IP 分组。
    // 局限：两个目标解析到同一 IP（或都解析失败 ip 为空）时会被合并为一行（帧本身不带目标字段）。
    const key = mode.startsWith('batch') ? `${stat.nodeId}|${stat.ip}` : stat.nodeId;
    if (key) byNode.set(key, stat); // 同节点多帧时取最后一帧
  }
  return summarizeStats(mode, targets, [...byNode.values()], topN, sortBy);
}

/** 统计聚合（normalize 之后的通用部分）：各 provider 共用，避免三份重复实现 */
export function summarizeStats(
  mode: Mode,
  targets: string[],
  stats: NodeStat[],
  topN: number,
  sortBy: 'latency' | 'loss',
): TestSummary {
  const ok = stats.filter((s) => s.ok && s.latencyMs !== undefined);
  const failed = stats.filter((s) => !s.ok);

  const lats = ok.map((s) => s.latencyMs!);
  const overallAvg = lats.length ? round(lats.reduce((a, b) => a + b, 0) / lats.length) : undefined;
  const overallMin = lats.length ? Math.min(...lats) : undefined;
  const overallMax = lats.length ? Math.max(...lats) : undefined;

  const carriers = carrierSummary(stats);

  const sortedOk = [...ok].sort((a, b) => a.latencyMs! - b.latencyMs!);
  const statsSorted =
    sortBy === 'loss'
      ? [...failed, ...sortedOk]
      : [...stats].sort(
          (a, b) => (a.latencyMs ?? Number.MAX_SAFE_INTEGER) - (b.latencyMs ?? Number.MAX_SAFE_INTEGER),
        );

  return {
    mode,
    targets,
    totalNodes: stats.length,
    okNodes: ok.length,
    failedNodes: failed.length,
    overallAvg,
    overallMin,
    overallMax,
    carriers,
    top: sortedOk.slice(0, topN),
    stats: statsSorted,
  };
}

function tracerouteSummary(mode: Mode, targets: string[], frames: Frame[], finished: boolean): TestSummary {
  // 每个节点多帧：hop 帧（ip+ttl）与 {type:'success', ttl, ptr} 帧。
  // traceroute 帧通常不带 node_id（单节点任务），用固定键分组。
  const groups = new Map<string, { name: string; frames: Frame[] }>();
  for (const f of frames) {
    const id = String(f.node_id ?? '__task__');
    if (!groups.has(id)) groups.set(id, { name: String(f.name ?? '(所选节点)'), frames: [] });
    groups.get(id)!.frames.push(f);
  }
  const stats: NodeStat[] = [...groups.entries()].map(([id, g]) => {
    const first = g.frames[0];
    const nodeError = g.frames.some((f) => f.type === 'node_error');
    const hops = new Map<number, HopInfo>();
    for (const f of g.frames) {
      const ttl = Number(f.ttl);
      if (!Number.isFinite(ttl)) continue;
      const hop = hops.get(ttl) ?? { ttl, ip: '' };
      const latency = parseLatency(f.result);
      if (f.ip) {
        hop.ip = String(f.ip);
        if (latency !== undefined) hop.latencyMs = latency;
        if (f.address) hop.address = String(f.address);
        if (f.asn) hop.asn = String(f.asn);
        if (f.asn_info) hop.asnInfo = String(f.asn_info);
      }
      if (f.type === 'success' && f.ptr) hop.ptr = String(f.ptr);
      hops.set(ttl, hop);
    }
    const hopList = [...hops.values()].sort((a, b) => a.ttl - b.ttl).filter((h) => h.ip);
    return {
      nodeId: id,
      name: g.name,
      carrier: CARRIER_BY_LINE[first.line ?? -1] ?? '未知',
      province: PROVINCE_BY_CODE[first.province ?? -1] ?? '未知',
      region: REGION_BY_CODE[first.region ?? -1] ?? '未知',
      ip: hopList.length ? hopList[hopList.length - 1].ip : '',
      ok: hopList.length > 0,
      latencyMs: undefined,
      failReason: nodeError && hopList.length === 0 ? '节点不可用(node_error)' : undefined,
      address: `${hopList.length} 跳`,
      hops: hopList,
      raw: Object.assign({}, ...g.frames) as Frame,
    };
  });
  return {
    mode,
    targets,
    totalNodes: stats.length,
    okNodes: stats.filter((s) => s.ok).length,
    failedNodes: stats.filter((s) => !s.ok).length,
    carriers: [],
    top: [],
    stats,
  };
}

function carrierSummary(stats: NodeStat[]): CarrierSummary[] {
  const map = new Map<string, NodeStat[]>();
  for (const s of stats) {
    if (!map.has(s.carrier)) map.set(s.carrier, []);
    map.get(s.carrier)!.push(s);
  }
  const out: CarrierSummary[] = [];
  for (const [carrier, list] of map) {
    const ok = list.filter((s) => s.ok && s.latencyMs !== undefined);
    const lats = ok.map((s) => s.latencyMs!);
    out.push({
      carrier,
      nodes: list.length,
      ok: ok.length,
      avg: lats.length ? round(lats.reduce((a, b) => a + b, 0) / lats.length) : NaN,
      min: lats.length ? Math.min(...lats) : NaN,
      max: lats.length ? Math.max(...lats) : NaN,
    });
  }
  return out.sort((a, b) => b.nodes - a.nodes);
}

function round(n: number): number {
  return Math.round(n * 10) / 10;
}

export { round };
