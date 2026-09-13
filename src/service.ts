import { DEFAULT_UA } from './config.js';
import type { ModeOptions } from './modes.js';
import { providerChain, type SpeedTestProvider } from './providers/index.js';
import type { Frame, Mode, RunResult } from './types.js';

/**
 * 可复用的测试执行服务：CLI 与 Web 控制台共用。
 * 封装 http 目标归一化、节点选择降级、批量分片串行、帧回填（批量节点名/traceroute 标签）、聚合。
 *
 * 多上游抽象：所有 itdog 专属逻辑（任务创建/结果流/节点表/帧解码）均由 provider 提供，
 * 本服务只依赖 SpeedTestProvider 接口；调度按优先级自动故障切换（provider 链）。
 */

export interface TestRequest {
  mode: Mode;
  targets: string[];
  /** 节点选择器：all | 线路分组 | 关键词 | 节点ID（详见 provider.selectNodes） */
  nodes?: string;
  port?: number;
  timeoutSec?: number;
  idleTimeoutSec?: number;
  top?: number;
  sort?: 'latency' | 'loss';
  ua?: string;
  retry?: number;
  proxy?: string;
  /** 上游选择：auto 即当前唯一上游 itdog；保留字段以便未来扩展多上游 */
  provider?: string;
  /** http 模式 */
  checkMode?: 'fast' | 'slow';
  method?: string;
  referer?: string;
  cookie?: string;
  redirects?: number;
  httpVersion?: string;
  /** http 模式：强制解析（官方表单 ipv4 字段，可填 IPv4 或域名） */
  resolveTo?: string;
  /** http 模式：监测节点请求目标时使用的 User-Agent（区别于本工具的任务创建 UA） */
  httpUa?: string;
  /** dns 模式 / 目标解析：自定义 DNS 服务器（非空时 dns_server_type=custom） */
  dnsType?: string;
  dnsServer?: string;
}

export interface TestHandlers {
  /** 每收到一帧结果回调（已回填节点名/线路） */
  onFrame?: (frame: Frame, index: number) => void;
  /** 进度/提示信息（创建任务、降级提示等） */
  onStatus?: (line: string) => void;
  /** 取消信号：中止当前测试（Web 端「停止测试」→ DELETE /api/tests/:id） */
  signal?: AbortSignal;
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function runTest(req: TestRequest, h: TestHandlers = {}): Promise<RunResult> {
  const mode = req.mode;
  const targets = [...req.targets];
  const ua = req.ua || DEFAULT_UA; // 统一兜底：Web 端可不传 UA，但不能以空 UA 请求上游
  if (targets.length === 0) throw new Error('缺少目标（IP 或域名）');
  if (mode === 'http') {
    targets[0] = /^[a-z][a-z0-9+.-]*:\/\//i.test(targets[0]) ? targets[0] : `https://${targets[0]}`;
  }

  // 上游链：auto 时按优先级遍历，手动指定则仅该上游；指定但不可用（如未配置 token）则明确报错
  let chain = providerChain(req.provider);
  if (chain.length === 0) {
    const msg =
      req.provider && req.provider !== 'auto'
        ? `测速上游 "${req.provider}" 不可用（当前仅内置 itdog）`
        : '没有可用的测速上游（provider）';
    throw new Error(msg);
  }
  // 模式能力过滤：手动指定不支持该模式的上游直接报错（不发起请求）；auto 链上剔除不支持者
  if (req.provider && req.provider !== 'auto') {
    const p = chain[0];
    if (!p.supportedModes.includes(mode)) {
      throw new Error(`上游 "${p.id}" 不支持 ${mode} 模式（支持：${p.supportedModes.join(' / ')}）`);
    }
  } else {
    chain = chain.filter((p) => p.supportedModes.includes(mode));
    if (chain.length === 0) throw new Error(`没有支持 ${mode} 模式的测速上游`);
  }

  // 逐个 provider 尝试：仅当「尚未产出任何帧」（创建任务/首帧之前失败）时才切换上游；
  // 已有结果后换上游重跑会造成帧重复、批量目标丢失，直接抛错。主动取消同样不切换。
  let lastErr: unknown;
  const progress = { frames: 0 };
  for (const provider of chain) {
    try {
      return await runWithProvider(provider, req, targets, ua, h, progress);
    } catch (e) {
      lastErr = e;
      if (h.signal?.aborted) throw e;
      if (provider === chain[chain.length - 1]) throw e;
      if (progress.frames > 0) {
        throw new Error(
          `上游 ${provider.name} 在产出部分结果后失败（${(e as Error).message}），为避免结果重复/缺失不再切换上游`,
        );
      }
    }
  }
  throw lastErr;
}

async function runWithProvider(
  provider: SpeedTestProvider,
  req: TestRequest,
  targets: string[],
  ua: string,
  h: TestHandlers,
  progress: { frames: number },
): Promise<RunResult> {
  const mode = req.mode;
  const decoders = provider.decoders;

  const modeOpts: ModeOptions = {
    mode,
    targets,
    port: req.port ?? 443,
    nodes: req.nodes ?? 'all',
    checkMode: req.checkMode === 'slow' ? 'slow' : 'fast',
    method: req.method ?? 'get',
    referer: req.referer ?? '',
    ua: req.httpUa ?? '', // http 表单的 user-agent（目标请求 UA），与任务创建 UA 无关
    cookies: req.cookie ?? '',
    redirects: req.redirects ?? 5,
    httpVersion: req.httpVersion ?? 'auto',
    resolveTo: req.resolveTo ?? '',
    dnsType: req.dnsType ?? 'a',
    dnsServer: req.dnsServer ?? '',
  };

  // 批量模式把节点选择器展开成节点 ID；itdog 限制单任务 1~5 个节点，自动分片串行。
  // 单目标 ping/tcping 的「精确节点」路径：itdog 单目标端点只支持线路过滤（line 表单），
  // 而批量端点原生支持精确 node_id —— 非纯线路选择器时解析为显式节点，借道批量端点做真。
  // 互斥约束：批量端点表单没有 DNS 参数，指定了自定义 DNS 时回退线路过滤（downgradeNotice 明示）。
  const isBatch = mode === 'batch-ping' || mode === 'batch-tcping';
  let effectiveMode = mode;
  let nodeChunks: string[][] = [[]];
  const batchNodeMap = new Map<string, { name: string; category: string }>();
  let requestedNodes = 0;
  let degradedTo: string | undefined;
  if (isBatch) {
    const chosen = provider.selectNodes(modeOpts.nodes);
    if (chosen.length === 0) throw new Error('节点选择器未匹配到任何节点');
    for (const n of chosen) batchNodeMap.set(n.id, { name: n.name, category: n.category });
    nodeChunks = chunk(chosen.map((n) => n.id), 5);
    requestedNodes = chosen.length;
  } else if (mode !== 'traceroute') {
    let precise = false;
    if (
      (mode === 'ping' || mode === 'tcping') &&
      !provider.isPureLineSpec(modeOpts.nodes) &&
      !modeOpts.dnsServer
    ) {
      const chosen = provider.selectNodes(modeOpts.nodes);
      if (chosen.length === 0) {
        // 用户明确选了节点但一个都没匹配到：报错优于静默测全部节点
        throw new Error(`节点选择器 "${modeOpts.nodes}" 未匹配到任何节点`);
      }
      for (const n of chosen) batchNodeMap.set(n.id, { name: n.name, category: n.category });
      nodeChunks = chunk(chosen.map((n) => n.id), 5);
      effectiveMode = mode === 'ping' ? 'batch-ping' : 'batch-tcping';
      requestedNodes = chosen.length;
      precise = true;
      h.onStatus?.(`精确节点模式：${chosen.length} 个节点 → ${nodeChunks.length} 个子任务串行执行`);
    }
    if (!precise) {
      // 与精确路径同一错误语义：非纯线路选择器却匹配不到任何节点时，
      // 降级为「全部节点」只会无声放大测试范围，直接报错
      if (!provider.isPureLineSpec(modeOpts.nodes) && provider.selectNodes(modeOpts.nodes).length === 0) {
        throw new Error(`节点选择器 "${modeOpts.nodes}" 未匹配到任何节点`);
      }
      const notice = provider.downgradeNotice(mode, modeOpts.nodes, modeOpts.dnsServer ? 'dns' : undefined);
      if (notice) {
        h.onStatus?.(notice.message);
        if (notice.lines.length > 0) {
          modeOpts.nodes = notice.lines.join(',');
          degradedTo = notice.label;
        }
      }
    }
  }
  if (effectiveMode !== mode) modeOpts.mode = effectiveMode;
  const useChunks = isBatch || effectiveMode !== mode;

  const allFrames: Frame[] = [];
  let finishedAll = true;
  let lastReason = '';

  for (let i = 0; i < nodeChunks.length; i++) {
    if (h.signal?.aborted) throw new Error('任务已取消');
    if (useChunks) modeOpts.nodes = nodeChunks[i].join(',');
    const spec = provider.buildTaskSpec(modeOpts);
    const chunkLabel = nodeChunks.length > 1 ? `（分片 ${i + 1}/${nodeChunks.length}，${nodeChunks[i].length} 节点）` : '';
    h.onStatus?.(`正在创建任务（${provider.name} ${mode} ${targets.join(', ')}）${chunkLabel}...`);
    const task = await provider.createTask({
      path: spec.path,
      referer: spec.referer,
      form: spec.form,
      ua,
      proxy: req.proxy,
      retry: req.retry ?? provider.rateLimit.maxRetries,
    });
    h.onStatus?.(`任务已创建: ${task.taskId}`);

    let frameCount = 0;
    const stream = await provider.streamTask({
      wssUrl: task.wssUrl,
      taskId: task.taskId,
      ua,
      overallTimeoutMs: (req.timeoutSec ?? 90) * 1000,
      idleTimeoutMs: (req.idleTimeoutSec ?? 12) * 1000,
      proxy: req.proxy,
      signal: h.signal,
      onFrame: (frame) => {
        if (frame.type === 'finished') return;
        frameCount++;
        progress.frames++;
        // 批量模式的帧不带节点名/线路，用节点注册表回填；traceroute 帧用任务标签回填
        const info = batchNodeMap.get(String(frame.node_id ?? ''));
        if (info) {
          frame.name = info.name.replace(/\s*-\s*[^-]+$/, '');
          frame.line = decoders.categoryToLine(info.category) ?? frame.line;
          if (frame.province === undefined) {
            const code = decoders.provinceCodeFromName(info.name);
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
    // 中止检查（关键）：streamTask 收到 abort 后会优雅关闭连接并返回部分帧，
    // 必须在这里把「部分结果」转成「取消」，否则取消退化成提前完成的正常任务
    if (h.signal?.aborted) throw new Error('任务已取消');
    if (i < nodeChunks.length - 1) await sleep(provider.rateLimit.chunkSleepMs);
  }

  const finished = finishedAll;
  const frames = allFrames.filter((f) => f.type !== 'finished');
  // summary 始终使用原始模式（精确路径借道批量端点，但对外语义仍是 ping/tcping）
  const summary = provider.buildSummary(mode, targets, frames, finished, req.top ?? 5, req.sort ?? 'latency');
  if (requestedNodes > 0) summary.requestedNodes = requestedNodes;
  if (degradedTo) summary.degradedTo = degradedTo;
  return { summary, frames, finished, reason: lastReason || (finished ? 'finished' : ''), provider: provider.id };
}
