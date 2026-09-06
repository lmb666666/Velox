import { BATCH_MAX_CHARS, BATCH_MAX_TARGETS } from './config.js';
import { allNodes, selectNodes, specToLineValues } from './nodes.js';
import type { Mode } from './types.js';

/** 各模式的任务创建参数：POST 路径 + 表单字段（字段名对照官方页面表单） */

export interface ModeOptions {
  mode: Mode;
  targets: string[];
  /** tcping 端口 */
  port: number;
  /** 节点选择器（all / 分组 / 关键词 / id） */
  nodes: string;
  /** http 模式选项 */
  checkMode: 'fast' | 'detail';
  method: string;
  referer: string;
  ua: string;
  cookies: string;
  redirects: number;
  httpVersion: string;
  /** dns 模式选项 */
  dnsType: string;
  dnsServer: string;
}

function dnsCommon(opts: ModeOptions): Record<string, string> {
  return {
    dns_server_type: 'isp',
    dns_server: opts.dnsServer ?? '',
  };
}

export interface TaskSpec {
  path: string;
  referer: string;
  form: Record<string, string>;
  /** 结果帧缺失 name 字段时的回填标签（traceroute 用） */
  label?: string;
}

export function buildTaskSpec(opts: ModeOptions): TaskSpec {
  const line = specToLineValues(opts.nodes);
  const target = opts.targets[0];
  switch (opts.mode) {
    case 'ping':
      return {
        path: `ping/${target}`,
        referer: 'ping/',
        form: { line, button_click: 'yes', ...dnsCommon(opts) },
      };
    case 'tcping': {
      const hostPart = target.includes(':') ? target : `${target}:${opts.port}`;
      return {
        path: `tcping/${hostPart}`,
        referer: 'tcping/',
        form: { line, button_click: 'yes', ...dnsCommon(opts) },
      };
    }
    case 'http':
      return {
        path: 'http/',
        referer: 'http/',
        form: {
          line,
          host: target,
          host_s: safeHost(target),
          check_mode: opts.checkMode,
          http_version: opts.httpVersion,
          ipv4: '',
          method: opts.method,
          referer: opts.referer,
          ua: opts.ua,
          cookies: opts.cookies,
          redirect_num: String(opts.redirects),
          ...dnsCommon(opts),
        },
      };
    case 'dns':
      return {
        path: `dns/${target}`,
        referer: 'dns/',
        form: {
          line,
          domain: target,
          dns_type: opts.dnsType,
          ...dnsCommon(opts),
        },
      };
    case 'traceroute': {
      // traceroute 单任务只跑一个节点：表单字段为 node（节点ID），取第一个匹配节点
      const chosen = selectNodes(opts.nodes);
      const pool = chosen.length > 0 ? chosen : allNodes();
      const node = pool[0];
      return {
        path: `traceroute/${target}`,
        referer: 'traceroute/',
        form: { node: node.id, dns_server_type: 'isp', dns_server: opts.dnsServer ?? '' },
        label: node.name,
      };
    }
    case 'batch-ping': {
      const ids = opts.nodes.split(',').map((x) => x.trim()).filter(Boolean);
      const hostJoined = opts.targets.join('\r\n');
      if (opts.targets.length > BATCH_MAX_TARGETS || hostJoined.length > BATCH_MAX_CHARS) {
        throw new Error(`批量目标过多：上限 ${BATCH_MAX_TARGETS} 个 / ${BATCH_MAX_CHARS} 字符`);
      }
      return {
        path: 'batch_ping/',
        referer: 'batch_ping/',
        form: {
          host: hostJoined,
          node_id: ids.join(','),
          cidr_filter: 'true',
          gateway: 'first',
        },
      };
    }
    case 'batch-tcping': {
      const ids = opts.nodes.split(',').map((x) => x.trim()).filter(Boolean);
      const hostJoined = opts.targets
        .map((t) => (t.includes(':') ? t : `${t}:${opts.port}`))
        .join('\r\n');
      if (opts.targets.length > BATCH_MAX_TARGETS || hostJoined.length > BATCH_MAX_CHARS) {
        throw new Error(`批量目标过多：上限 ${BATCH_MAX_TARGETS} 个 / ${BATCH_MAX_CHARS} 字符`);
      }
      return {
        path: 'batch_tcping',
        referer: 'batch_ping/',
        form: {
          host: hostJoined,
          port: String(opts.port),
          node_id: ids.join(','),
          cidr_filter: 'true',
          gateway: 'first',
        },
      };
    }
  }
}

/** 从 URL/域名提取主机名（对照官方 buildAPIRequestWithTarget 的行为） */
function safeHost(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    const m = /^(?:https?:\/\/)?([^/:?#]+)/.exec(url);
    return m ? m[1] : url;
  }
}
