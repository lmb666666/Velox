export interface NodeInfo {
  id: string;
  name: string;
  category: string;
}

/** WS 原始帧。不同模式字段不同，统一用宽松类型。 */
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
  task_num?: number;
  [key: string]: unknown;
}

export type Mode = 'ping' | 'tcping' | 'http' | 'dns' | 'traceroute' | 'batch-ping' | 'batch-tcping';

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
  /** http 模式的细分耗时 */
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
  /** traceroute 模式的逐跳明细 */
  hops?: HopInfo[];
  raw: Frame;
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
