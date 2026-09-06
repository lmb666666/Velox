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
}

export interface RunResult {
  summary: TestSummary;
  frames: Frame[];
  finished: boolean;
  reason: string;
}

export interface TestRequest {
  mode: Mode;
  targets: string[];
  nodes?: string;
  port?: number;
  timeoutSec?: number;
  idleTimeoutSec?: number;
  top?: number;
  sort?: 'latency' | 'loss';
  proxy?: string;
  checkMode?: 'fast' | 'detail';
  method?: string;
  referer?: string;
  cookie?: string;
  redirects?: number;
  httpVersion?: string;
  dnsType?: string;
  dnsServer?: string;
}

export interface NodeInfo {
  id: string;
  name: string;
}

export interface NodesResponse {
  total: number;
  categories: Record<string, NodeInfo[]>;
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

export interface StreamHandlers {
  onSnapshot?: (snap: { state: string; frames: Frame[]; summary?: TestSummary; finished?: boolean; reason?: string; error?: string }) => void;
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

export function getNodes(): Promise<NodesResponse> {
  return jsonFetch('/api/nodes');
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
