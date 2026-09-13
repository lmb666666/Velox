import { createTask as createItdogTask } from '../client.js';
import { streamTask as streamItdogTask } from '../ws.js';
import { buildTaskSpec as buildItdogSpec } from '../modes.js';
import {
  allNodes,
  refreshNodesFromSite,
  selectNodes as selectNodesItdog,
} from '../nodes.js';
import { normalizeFrame as normalizeItdogFrame, buildSummary as itdogBuildSummary } from '../aggregate.js';
import {
  CARRIER_BY_LINE,
  PROVINCE_BY_CODE,
  REGION_BY_CODE,
  provinceCodeFromName,
} from '../config.js';
import type { Frame, Mode, NodeInfo, NodeStat } from '../types.js';
import type { ModeOptions, TaskSpec } from '../modes.js';
import type { CreateTaskParams, Task } from '../client.js';
import type { StreamOptions, StreamResult } from '../ws.js';
import type { SpeedTestProvider, FrameDecoders } from './types.js';

/** 单目标模式：线路分类名 → 线路编码（label 代号） */
const CATEGORY_TO_LINE: Record<string, number> = {
  中国电信: 1,
  中国联通: 2,
  中国移动: 3,
  '港澳台、海外': 5,
};

/** 纯线路选择器词表：命中则走单目标端点按线路过滤，否则可解析为精确节点走批量端点 */
const PURE_LINE_SPECS = new Set(['', 'all', '全部', 'telecom', 'unicom', 'mobile', 'overseas', '电信', '联通', '移动', '海外', '境外']);

function isPureLineSpec(spec: string | undefined): boolean {
  const s = (spec ?? 'all').trim();
  if (s === '') return true;
  return s.split(',').every((p) => PURE_LINE_SPECS.has(p.trim()) || PURE_LINE_SPECS.has(p.trim().toLowerCase()));
}

const decoders: FrameDecoders = {
  carrierByLine: CARRIER_BY_LINE,
  provinceByCode: PROVINCE_BY_CODE,
  regionByCode: REGION_BY_CODE,
  provinceCodeFromName,
  // inline 简化：itdog 的分类名 → 编码，直接映射
  categoryToLine: (category) => CATEGORY_TO_LINE[category],
};

export const itdogProvider: SpeedTestProvider = {
  id: 'itdog',
  name: 'itdog.cn',
  supportedModes: ['ping', 'tcping', 'http', 'dns', 'traceroute', 'batch-ping', 'batch-tcping'],
  rateLimit: { chunkSleepMs: 600, maxRetries: 2 },

  buildTaskSpec(modeOpts: ModeOptions): TaskSpec {
    return buildItdogSpec(modeOpts);
  },

  createTask(spec: CreateTaskParams): Promise<Task> {
    return createItdogTask(spec);
  },

  streamTask(opts: StreamOptions): Promise<StreamResult> {
    return streamItdogTask(opts);
  },

  getNodes(): NodeInfo[] {
    return allNodes();
  },

  refreshNodes(ua: string): Promise<{ updated: number; counts: Record<string, number> }> {
    return refreshNodesFromSite(ua);
  },

  selectNodes(spec: string | undefined): NodeInfo[] {
    return selectNodesItdog(spec);
  },

  isPureLineSpec,

  normalizeFrame(frame: Frame, mode: Mode): NodeStat {
    return normalizeItdogFrame(frame, mode);
  },

  buildSummary(mode: Mode, targets: string[], frames: Frame[], finished: boolean, topN: number, sortBy: 'latency' | 'loss') {
    return itdogBuildSummary(mode, targets, frames, finished, topN, sortBy);
  },

  decoders,

  downgradeNotice(mode: Mode, spec: string, reason?: 'dns'): { lines: string[]; message: string; label?: string } | null {
    if (isPureLineSpec(spec)) return null;
    const chosen = selectNodesItdog(spec);
    const categories = [...new Set(chosen.map((n) => n.category))];
    const lines = categories
      .map((c) => (CATEGORY_TO_LINE[c] !== undefined ? String(CATEGORY_TO_LINE[c]) : ''))
      .filter(Boolean);
    const label = categories.length > 0 ? `${categories.map((c) => c.replace(/^中国/, '')).join('、')}线路` : '全部节点';
    // 基础文案只对 http/dns 准确（它们本就不支持精确）；ping/tcping 回退时补充真实原因
    const base =
      mode === 'ping' || mode === 'tcping'
        ? `提示: 已指定自定义 DNS，与精确节点选择互斥（批量端点无 DNS 参数），"${spec}"匹配的 ${chosen.length} 个节点无法精确执行`
        : `提示: ${mode} 模式下 itdog 仅支持按线路分组选择节点，无法精确指定"${spec}"匹配的 ${chosen.length} 个节点`;
    return {
      lines,
      label,
      message:
        base +
        (lines.length > 0 ? `，已降级为${label}: ${lines.join(',')}` : '，已使用全部节点'),
    };
  },
};
