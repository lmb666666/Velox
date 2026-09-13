/** Velox 后端 API 类型与请求封装 */

export type Mode = 'ping' | 'tcping' | 'http' | 'dns' | 'traceroute' | 'batch-ping' | 'batch-tcping';

export const MODES: { value: Mode; label: string; hint: string; batch: boolean }[] = [
  { value: 'ping', label: 'Ping', hint: '多节点 ICMP 延迟', batch: false },
  { value: 'tcping', label: 'TCPing', hint: 'TCP 端口连通/延迟', batch: false },
  { value: 'http', label: 'HTTP', hint: '网站打开速度', batch: false },
  { value: 'dns', label: 'DNS', hint: '各地 DNS 解析', batch: false },
  { value: 'traceroute', label: 'Traceroute', hint: 'mtr 式逐跳路由', batch: false },
  { value: 'batch-ping', label: '批量 Ping', hint: '多目标 × 精确节点', batch: true },
  { value: 'batch-tcping', label: '批量 TCPing', hint: '多目标 TCP 测试', batch: true },
];

/** 测速上游（provider） —— 供「测速上游」选择器使用（当前内置 itdog，接口层预留多上游扩展） */
export const PROVIDERS: { value: string; label: string; hint: string }[] = [
  { value: 'auto', label: '自动（推荐）', hint: '使用内置上游 itdog.cn，全国 290+ 监测点' },
  { value: 'itdog', label: 'itdog.cn', hint: '全国 290+ 监测点，数据最成熟' },
];
export type ProviderValue = (typeof PROVIDERS)[number]['value'];

export interface Frame {
  ip?: string;
  result?: string | number;
  node_id?: string;
  line?: number;
  name?: string;
  region?: number;
  province?: number;
  address?: string;
  type?: string;
  http_code?: number;
  all_time?: number;
  dns_time?: number;
  connect_time?: number;
  ssl_time?: number;
  download_time?: number;
  redirect?: string | number;
  redirect_time?: number;
  head?: string;
  time?: number;
  ttl?: number;
  [key: string]: unknown;
}

export interface HopInfo {
  ttl: number;
  ip: string;
  latencyMs?: number;
  address?: string;
  asn?: string;
  asnInfo?: string;
  ptr?: string;
}

export interface NodeStat {
  nodeId: string;
  name: string;
  carrier: string;
  province: string;
  region: string;
  ip: string;
  ok: boolean;
  failReason?: string;
  latencyMs?: number;
  detail?: {
    httpCode?: number;
    allTime?: number;
    dnsTime?: number;
    connectTime?: number;
    sslTime?: number;
    downloadTime?: number;
    redirectTime?: number;
  };
  address?: string;
  hops?: HopInfo[];
}

export interface CarrierSummary {
  carrier: string;
  nodes: number;
  ok: number;
  avg: number;
  min: number;
  max: number;
}

export interface TestSummary {
  mode: Mode;
  targets: string[];
  totalNodes: number;
  okNodes: number;
  failedNodes: number;
  overallAvg?: number;
  overallMin?: number;
  overallMax?: number;
  carriers: CarrierSummary[];
  top: NodeStat[];
  stats: NodeStat[];
  /** 用户精确选择的节点数（批量端点精确执行时填入） */
  requestedNodes?: number;
  /** 精确选择不可用时的降级目标描述（如「电信、联通线路」） */
  degradedTo?: string;
}

/** 纯线路选择器判定（与后端 itdogProvider.isPureLineSpec 口径一致，勿单侧修改） */
const PURE_LINE_SPECS = new Set(['', 'all', '全部', 'telecom', 'unicom', 'mobile', 'overseas', '电信', '联通', '移动', '海外', '境外']);

export function isPureLineSpec(spec: string | undefined): boolean {
  const s = (spec ?? 'all').trim();
  if (s === '') return true;
  return s.split(',').every((p) => PURE_LINE_SPECS.has(p.trim()) || PURE_LINE_SPECS.has(p.trim().toLowerCase()));
}

export interface RunResult {
  summary: TestSummary;
  frames: Frame[];
  finished: boolean;
  reason: string;
  /** 结果来自哪个上游（当前内置 itdog） */
  provider?: string;
}

export interface TestRequest {
  mode: Mode;
  targets: string[];
  nodes?: string;
  /** 测速上游：auto(默认) | itdog */
  provider?: string;
  port?: number;
  timeoutSec?: number;
  idleTimeoutSec?: number;
  top?: number;
  retry?: number;
  sort?: 'latency' | 'loss';
  proxy?: string;
  checkMode?: 'fast' | 'slow';
  method?: string;
  referer?: string;
  cookie?: string;
  redirects?: number;
  httpVersion?: string;
  /** http 模式：强制解析（IPv4 或域名） */
  resolveTo?: string;
  /** http 模式：目标请求 User-Agent */
  httpUa?: string;
  /** 目标解析/查询使用的 DNS 服务器（非空 = 指定 DNS） */
  dnsType?: string;
  dnsServer?: string;
}

export interface NodeInfo {
  id: string;
  name: string;
  /** 节点来源上游（当前内置 itdog） */
  provider?: string;
}

export interface NodesResponse {
  total: number;
  categories: Record<string, NodeInfo[]>;
  /** 当前节点表来源上游 */
  provider?: string;
}

export interface HistoryItem {
  id: string;
  mode: Mode;
  targets: string[];
  createdAt: number;
  finishedAt: number;
  okNodes?: number;
  totalNodes?: number;
  overallAvg?: number;
  /** 结果来源上游（当前内置 itdog） */
  provider?: string;
  error?: string;
}

export interface HistoryDetail extends RunResult {
  id: string;
  mode: Mode;
  targets: string[];
  createdAt: number;
  finishedAt: number;
  error?: string;
}

async function jsonFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const data = (await res.json()) as T & { error?: string };
  if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
  return data;
}

export function createTest(req: TestRequest): Promise<{ id: string; state: string }> {
  return jsonFetch('/api/tests', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(req),
  });
}

/** 取消任务：排队中的直接取消；执行中的中止结果流（对应后端 DELETE /api/tests/:id） */
export function cancelTest(id: string): Promise<{ ok: boolean; state: string }> {
  return jsonFetch(`/api/tests/${id}`, { method: 'DELETE' });
}

export interface StreamHandlers {
  onSnapshot?: (snap: { state: string; frames: Frame[]; summary?: TestSummary; finished?: boolean; reason?: string; error?: string; provider?: string }) => void;
  onStatus?: (line: string) => void;
  onFrame?: (frame: Frame, index: number) => void;
  onDone?: (result: RunResult) => void;
  onError?: (message: string) => void;
  onState?: (state: string) => void;
}

/** 订阅任务 SSE 流，返回取消函数 */
export function streamTest(id: string, h: StreamHandlers): () => void {
  const es = new EventSource(`/api/tests/${id}/events`);
  es.addEventListener('snapshot', (e) => h.onSnapshot?.(JSON.parse((e as MessageEvent).data)));
  es.addEventListener('status', (e) => h.onStatus?.(JSON.parse((e as MessageEvent).data).line));
  es.addEventListener('frame', (e) => {
    const d = JSON.parse((e as MessageEvent).data) as { frame: Frame; index: number };
    h.onFrame?.(d.frame, d.index);
  });
  es.addEventListener('done', (e) => {
    const d = JSON.parse((e as MessageEvent).data) as RunResult;
    h.onDone?.(d);
    es.close();
  });
  es.addEventListener('error', (e) => {
    if (e instanceof MessageEvent) {
      h.onError?.(JSON.parse(e.data).message);
      es.close();
    }
    // EventSource 原生错误（断线重连）交给浏览器
  });
  es.addEventListener('state', (e) => h.onState?.(JSON.parse((e as MessageEvent).data).state));
  return () => es.close();
}

export function getNodes(provider?: string): Promise<NodesResponse> {
  const qs = provider && provider !== 'auto' ? `?provider=${encodeURIComponent(provider)}` : '';
  return jsonFetch(`/api/nodes${qs}`);
}

export interface ProviderMeta {
  id: string;
  name: string;
  supportedModes: string[];
}
export function getProviderMeta(): Promise<{ providers: ProviderMeta[]; default: string }> {
  return jsonFetch('/api/meta/providers');
}

export function refreshNodes(): Promise<{ updated: number; total: number }> {
  return jsonFetch('/api/nodes/refresh', { method: 'POST' });
}

export function getHistory(): Promise<{ items: HistoryItem[] }> {
  return jsonFetch('/api/history');
}

export function getHistoryDetail(id: string): Promise<HistoryDetail> {
  return jsonFetch(`/api/history/${id}`);
}

export function deleteHistory(id: string): Promise<{ ok: boolean }> {
  return jsonFetch(`/api/history/${id}`, { method: 'DELETE' });
}

export function clearHistory(): Promise<{ ok: boolean }> {
  return jsonFetch('/api/history', { method: 'DELETE' });
}
