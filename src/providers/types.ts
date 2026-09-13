import type { Frame, Mode, NodeInfo, NodeStat } from '../types.js';
import type { ModeOptions, TaskSpec } from '../modes.js';
import type { CreateTaskParams, Task } from '../client.js';
import type { StreamOptions, StreamResult } from '../ws.js';
import type { TestSummary } from '../types.js';

/**
 * 测速上游（provider）统一接口。
 * 实现本接口并注册到 registry 即可接入新上游，由统一调度层调用。
 */

/** 上游标识 */
export type ProviderId = 'itdog';

/** 任务创建时的频率/退避常量（不同上游限频窗口不同） */
export interface ProviderRateLimit {
  /** 批量分片之间/逐节点查询之间的间隔（毫秒） */
  chunkSleepMs: number;
  maxRetries: number;
}

/**
 * 帧解码器：把上游帧里的数字编码字段转成通用字符串（运营商/省份/大区）。
 * itdog 每个上游有自己的编码表，聚合层通过它做归一化，不直接依赖某上游。
 */
export interface FrameDecoders {
  carrierByLine: Record<number, string>;
  provinceByCode: Record<number, string>;
  regionByCode: Record<number, string>;
  /** 从监测点名推断省份编码（批量模式帧不带 province 字段时用） */
  provinceCodeFromName(name: string): number | undefined;
  /** 线路分类名 → 线路编码（批量回填 line 字段用） */
  categoryToLine(category: string): number | undefined;
}

/** 单目标模式下「按线路分组 vs 逐节点精确选择」的降级提示 */
export interface DowngradeNotice {
  lines: string[];
  message: string;
  /** 降级目标的可读描述（如「电信、联通线路」），供结果页标注 */
  label?: string;
}

export interface SpeedTestProvider {
  id: ProviderId;
  name: string;
  supportedModes: Mode[];
  rateLimit: ProviderRateLimit;

  /** 构造请求（原 modes.buildTaskSpec 的泛化） */
  buildTaskSpec(modeOpts: ModeOptions): TaskSpec;
  /** 创建任务（原 client.createTask）→ 拿到可发现的任务句柄 */
  createTask(spec: CreateTaskParams): Promise<Task>;
  /** 获取结果流（WS 或 HTTP 轮询或逐源查询） */
  streamTask(opts: StreamOptions): Promise<StreamResult>;

  /** 节点表（结构通用） */
  getNodes(): NodeInfo[];
  refreshNodes(ua: string): Promise<{ updated: number; counts: Record<string, number> }>;
  selectNodes(spec: string | undefined): NodeInfo[];
  /** 选择器是否为纯线路分组（all/telecom/…）：纯线路走单目标端点，否则单目标 ping/tcping 可精确执行 */
  isPureLineSpec(spec: string | undefined): boolean;

  /** 帧归一化（WS 帧 → 节点统计） */
  normalizeFrame(frame: Frame, mode: Mode): NodeStat;
  /** 汇总：帧归一化后的通用聚合（itdog 复用 aggregate.buildSummary/summarizeStats） */
  buildSummary(
    mode: Mode,
    targets: string[],
    frames: Frame[],
    finished: boolean,
    topN: number,
    sortBy: 'latency' | 'loss',
  ): TestSummary;
  /** 帧解码器（供聚合层使用） */
  decoders: FrameDecoders;
  /** 单目标模式节点选择降级提示；reason 说明回退原因（dns=指定了自定义 DNS 与批量端点互斥） */
  downgradeNotice(mode: Mode, spec: string, reason?: 'dns'): DowngradeNotice | null;
}
