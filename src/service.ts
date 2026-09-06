import { createTask } from './client.js';
import { streamTask } from './ws.js';
import { buildTaskSpec, type ModeOptions } from './modes.js';
import { selectNodes } from './nodes.js';
import { buildSummary } from './aggregate.js';
import { DEFAULT_UA, provinceCodeFromName } from './config.js';
import type { Frame, Mode, RunResult } from './types.js';

/**
 * 可复用的测试执行服务：CLI 与 Web 控制台共用。
 * 封装 http 目标归一化、节点选择降级、批量分片串行、帧回填（批量节点名/traceroute 标签）、聚合。
 */

export interface TestRequest {
  mode: Mode;
  targets: string[];
  /** 节点选择器：all | 线路分组 | 关键词 | 节点ID（详见 nodes.ts selectNodes） */
  nodes?: string;
  port?: number;
  timeoutSec?: number;
  idleTimeoutSec?: number;
  top?: number;
  sort?: 'latency' | 'loss';
  ua?: string;
  retry?: number;
  proxy?: string;
  /** http 模式 */
  checkMode?: 'fast' | 'detail';
  method?: string;
  referer?: string;
  cookie?: string;
  redirects?: number;
  httpVersion?: string;
  /** dns 模式 */
  dnsType?: string;
  dnsServer?: string;
}

export interface TestHandlers {
  /** 每收到一帧结果回调（已回填节点名/线路） */
  onFrame?: (frame: Frame, index: number) => void;
  /** 进度/提示信息（创建任务、降级提示等） */
  onStatus?: (line: string) => void;
}

export const CATEGORY_TO_LINE: Record<string, number> = {
  中国电信: 1,
  中国联通: 2,
  中国移动: 3,
  '港澳台、海外': 5,
};

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 单目标模式仅支持线路分组；检查节点选择器并降级，返回降级提示（无则 null） */
function downgradeNotice(mode: Mode, spec: string): { lines: string[]; message: string } | null {
  const known = ['all', '全部', '', 'telecom', 'unicom', 'mobile', 'overseas', '电信', '联通', '移动', '海外', '境外'];
  const isCarrierSpec = spec.split(',').every((p) => known.includes(p.trim().toLowerCase()) || known.includes(p.trim()));
  if (isCarrierSpec) return null;
  const chosen = selectNodes(spec);
  const lines = [...new Set(chosen.map((n) => n.category))]
    .map((c) => (CATEGORY_TO_LINE[c] !== undefined ? String(CATEGORY_TO_LINE[c]) : ''))
    .filter(Boolean);
  return {
    lines,
    message:
      `提示: ${mode} 模式下 itdog 仅支持按线路分组选择节点，无法精确指定"${spec}"匹配的 ${chosen.length} 个节点` +
      (lines.length > 0 ? `，已降级为线路过滤: ${lines.join(',')}` : '，已使用全部节点'),
  };
}

export async function runTest(req: TestRequest, h: TestHandlers = {}): Promise<RunResult> {
  const mode = req.mode;
  const targets = [...req.targets];
  const ua = req.ua || DEFAULT_UA; // 统一兜底：Web 端可不传 UA，但不能以空 UA 请求 itdog
  if (targets.length === 0) throw new Error('缺少目标（IP 或域名）');
  if (mode === 'http') {
    targets[0] = /^[a-z][a-z0-9+.-]*:\/\//i.test(targets[0]) ? targets[0] : `https://${targets[0]}`;
  }

  const modeOpts: ModeOptions = {
    mode,
    targets,
    port: req.port ?? 443,
    nodes: req.nodes ?? 'all',
    checkMode: req.checkMode === 'detail' ? 'detail' : 'fast',
    method: req.method ?? 'get',
    referer: req.referer ?? '',
    ua: req.ua ?? '',
    cookies: req.cookie ?? '',
    redirects: req.redirects ?? 5,
    httpVersion: req.httpVersion ?? 'auto',
    dnsType: req.dnsType ?? 'a',
    dnsServer: req.dnsServer ?? '',
  };

  // 批量模式把节点选择器展开成节点 ID；itdog 限制单任务 1~5 个节点，自动分片串行
  const isBatch = mode === 'batch-ping' || mode === 'batch-tcping';
  let nodeChunks: string[][] = [[]];
  const batchNodeMap = new Map<string, { name: string; category: string }>();
  if (isBatch) {
    const chosen = selectNodes(modeOpts.nodes);
    if (chosen.length === 0) throw new Error('节点选择器未匹配到任何节点');
    for (const n of chosen) batchNodeMap.set(n.id, { name: n.name, category: n.category });
    nodeChunks = chunk(chosen.map((n) => n.id), 5);
  } else if (mode !== 'traceroute') {
    const notice = downgradeNotice(mode, modeOpts.nodes);
    if (notice) {
      h.onStatus?.(notice.message);
      if (notice.lines.length > 0) modeOpts.nodes = notice.lines.join(',');
    }
  }

  const allFrames: Frame[] = [];
  let finishedAll = true;
  let lastReason = '';

  for (let i = 0; i < nodeChunks.length; i++) {
    if (isBatch) modeOpts.nodes = nodeChunks[i].join(',');
    const spec = buildTaskSpec(modeOpts);
    const chunkLabel = nodeChunks.length > 1 ? `（分片 ${i + 1}/${nodeChunks.length}，${nodeChunks[i].length} 节点）` : '';
    h.onStatus?.(`正在创建任务（${mode} ${targets.join(', ')}）${chunkLabel}...`);
    const task = await createTask({
      path: spec.path,
      referer: spec.referer,
      form: spec.form,
      ua,
      proxy: req.proxy,
      retry: req.retry ?? 2,
    });
    h.onStatus?.(`任务已创建: ${task.taskId}`);

    let frameCount = 0;
    const stream = await streamTask({
      wssUrl: task.wssUrl,
      taskId: task.taskId,
      ua,
      overallTimeoutMs: (req.timeoutSec ?? 90) * 1000,
      idleTimeoutMs: (req.idleTimeoutSec ?? 12) * 1000,
      proxy: req.proxy,
      onFrame: (frame) => {
        if (frame.type === 'finished') return;
        frameCount++;
        // 批量模式的帧不带节点名/线路，用节点注册表回填；traceroute 帧用任务标签回填
        const info = batchNodeMap.get(String(frame.node_id ?? ''));
        if (info) {
          frame.name = info.name.replace(/\s*-\s*[^-]+$/, '');
          frame.line = CATEGORY_TO_LINE[info.category] ?? frame.line;
          if (frame.province === undefined) {
            const code = provinceCodeFromName(info.name);
            if (code !== undefined) frame.province = code;
            else if (info.category === '港澳台、海外') frame.province = 99; // 非中国节点统一记境外，与单目标模式一致
          }
        } else if (spec.label && !frame.name) {
          frame.name = spec.label;
        }
        allFrames.push(frame);
        h.onFrame?.(frame, frameCount);
      },
    });
    if (stream.reason !== 'finished') {
      finishedAll = false;
      lastReason = stream.reason;
    }
    if (i < nodeChunks.length - 1) await sleep(600);
  }

  const finished = finishedAll;
  const frames = allFrames.filter((f) => f.type !== 'finished');
  const summary = buildSummary(mode, targets, frames, finished, req.top ?? 5, req.sort ?? 'latency');
  return { summary, frames, finished, reason: lastReason || (finished ? 'finished' : '') };
}
