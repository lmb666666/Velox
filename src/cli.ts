#!/usr/bin/env node
import { Command } from 'commander';
import { runTest, type TestRequest } from './service.js';
import { allNodes, refreshNodesFromSite } from './nodes.js';
import { renderSummary, renderTable, toCsv, toFullJson } from './render.js';
import { DEFAULT_UA } from './config.js';
import fs from 'node:fs';
import type { Frame, Mode } from './types.js';

const KNOWN_MODES = ['ping', 'tcping', 'http', 'dns', 'traceroute', 'batch-ping', 'batch-tcping', 'serve'];

async function refreshNodes(ua: string): Promise<void> {
  const { updated, counts } = await refreshNodesFromSite(ua);
  if (updated > 0) {
    const breakdown = Object.entries(counts)
      .map(([cat, n]) => `${cat.replace(/^中国/, '')} ${n}`)
      .join(' / ');
    console.error(`节点表已刷新：${breakdown}（缓存于 ~/.cache/itdog-cli/nodes.json）`);
  } else console.error('节点表刷新失败：页面未包含节点数据');
}

async function runWithCliOutput(mode: Mode, targets: string[], opts: Record<string, unknown>): Promise<void> {
  const ua = (opts.ua as string) || DEFAULT_UA;

  if (opts.refreshNodes) {
    try {
      await refreshNodes(ua);
    } catch (e) {
      console.error(`节点表刷新失败：${(e as Error).message}（继续使用本地缓存）`);
    }
  }

  const req: TestRequest = {
    mode,
    targets,
    port: Number.parseInt(String(opts.port ?? '443'), 10) || 443,
    nodes: (opts.nodes as string) ?? 'all',
    timeoutSec: Number.parseInt(String(opts.timeout ?? '90'), 10) || 90,
    idleTimeoutSec: Number.parseInt(String(opts.idleTimeout ?? '12'), 10) || 12,
    top: Number.parseInt(String(opts.top ?? '5'), 10) || 5,
    sort: opts.sort === 'loss' ? 'loss' : 'latency',
    provider: opts.provider as string | undefined,
    ua,
    proxy: opts.proxy as string | undefined,
    retry: Number.parseInt(String(opts.retry ?? '2'), 10) || 0,
    checkMode: opts.checkMode === 'slow' ? 'slow' : 'fast',
    method: String(opts.method ?? 'get'),
    referer: String(opts.referer ?? ''),
    cookie: String(opts.cookie ?? ''),
    httpUa: String(opts.httpUa ?? ''),
    resolveTo: String(opts.resolve ?? ''),
    redirects: Number.parseInt(String(opts.redirects ?? '5'), 10) || 5,
    httpVersion: String(opts.httpVersion ?? 'auto'),
    dnsType: String(opts.type ?? 'a'),
    dnsServer: String(opts.dnsServer ?? ''),
  };

  const quiet = Boolean(opts.quiet);
  const result = await runTest(req, {
    onStatus: (line) => console.error(line),
    onFrame: (frame: Frame, index: number) => {
      if (quiet || mode === 'traceroute') return; // traceroute 帧多，收完统一展示
      const name = String(frame.name ?? '');
      const ip = String(frame.ip ?? '');
      // itdog http 帧的 all_time 单位是秒，统一换算为毫秒展示
      const result2 =
        frame.result ??
        (frame.all_time !== undefined ? `${Math.round(Number(frame.all_time) * 1000)}ms` : '');
      const mark = frame.type && frame.type !== 'success' && mode === 'http' ? '✗' : ip === 'Not Found' ? '✗' : '✓';
      process.stdout.write(`  [${String(index).padStart(3)}] ${mark} ${name}  ${ip}${result2 !== '' ? `  ${result2}ms` : ''}\n`);
    },
  });

  const { summary } = result;
  console.log();
  if (!quiet) {
    console.log(renderTable(mode, summary.stats));
    console.log();
  }
  console.log(renderSummary(summary, result.finished));
  if (!result.finished) {
    const reasonLabels: Record<string, string> = {
      closed: '连接关闭',
      'overall-timeout': '整体超时',
      'idle-timeout': '空闲超时',
      error: '连接异常',
    };
    console.log(`提示: 未收到 finished（${reasonLabels[result.reason] ?? result.reason}），以上为已收到的部分结果`);
  }

  if (opts.json) {
    fs.writeFileSync(String(opts.json), toFullJson(summary, result.frames, result.finished, result.reason));
    console.log(`JSON 已导出: ${opts.json}`);
  }
  if (opts.csv) {
    fs.writeFileSync(String(opts.csv), toCsv(summary));
    console.log(`CSV 已导出: ${opts.csv}`);
  }

  process.exitCode = summary.okNodes > 0 ? 0 : 1;
}

function registerMode(mode: Mode, description: string): void {
  const cmd = addCommon(program.command(mode).description(description));
  cmd.argument('<targets...>', '目标 IP/域名/URL');
  if (mode === 'tcping' || mode === 'batch-tcping') {
    cmd.option('--port <port>', '目标端口', '443');
  }
  if (mode === 'ping' || mode === 'tcping' || mode === 'http' || mode === 'dns') {
    cmd.option('--dns-server <server>', '目标解析使用的 DNS 服务器（默认运营商 DNS）', '');
  }
  if (mode === 'http') {
    cmd
      .option('--check-mode <mode>', 'fast 快速 | slow 缓慢', 'fast')
      .option('--method <method>', 'HTTP 方法', 'get')
      .option('--referer <url>', '模拟 Referer', '')
      .option('--cookie <cookie>', '模拟 Cookie', '')
      .option('--http-ua <ua>', '目标请求 User-Agent（节点访问目标时使用）', '')
      .option('--resolve <host>', '强制解析（IPv4 或域名，官方"指定解析"）', '')
      .option('--redirects <n>', '跟随重定向次数（0~10）', '5')
      .option('--http-version <v>', 'auto | http_1_1 | http_2 | http_3', 'auto');
  }
  if (mode === 'dns') {
    cmd.option('--type <type>', 'DNS 记录类型 a/cname/mx/aaaa/ns/txt', 'a');
  }
  cmd.action(async (targets: string[], opts) => {
    try {
      await runWithCliOutput(mode, targets, opts);
    } catch (e) {
      console.error(`\n错误: ${(e as Error).message}`);
      process.exit(2);
    }
  });
}

const program = new Command();
program
  .name('itdog')
  .description('Velox —— 调用 itdog.cn 全国监测节点测速与 IP 优选（非官方接口，纯命令行）')
  .version('0.2.0')
  .showHelpAfterError();

function addCommon(cmd: Command): Command {
  return cmd
    .option('--nodes <spec>', '节点选择: all | telecom/unicom/mobile/overseas(逗号组合) | 节点ID | 名称关键词', 'all')
    .option('--timeout <seconds>', '整体超时（秒）', '90')
    .option('--idle-timeout <seconds>', 'WS 空闲超时（秒，超时后重发握手）', '12')
    .option('--top <n>', '汇总最快前 N 个节点', '5')
    .option('--sort <key>', '表格排序: latency | loss（失败在前）', 'latency')
    .option('--json <file>', '完整结果导出为 JSON')
    .option('--csv <file>', '逐节点结果导出为 CSV')
    .option('--proxy <url>', 'HTTP(S) 代理（任务创建与 WS 均走此代理）')
    .option('--retry <n>', '任务创建失败重试次数', '2')
    .option('--provider <name>', '测速上游: auto(默认) | itdog', 'auto')
    .option('--ua <ua>', '自定义 User-Agent')
    .option('--refresh-nodes', '先从 batch_ping 页面刷新节点表缓存', false)
    .option('--quiet', '只输出最终汇总，不逐帧打印');
}

registerMode('ping', 'ICMP ping（多节点单目标）');
registerMode('tcping', 'TCP 端口连通性/延迟（多节点单目标）');
registerMode('http', 'HTTP 请求测速（多节点单 URL）');
registerMode('dns', 'DNS 解析（多节点单域名）');
registerMode('traceroute', '路由跟踪（单节点逐跳，取第一个匹配节点）');
registerMode('batch-ping', '批量 ping（多目标 + 精确节点 ID）');
registerMode('batch-tcping', '批量 tcping（多目标 + 精确节点 ID）');

program
  .command('serve')
  .description('启动 Velox Web 控制台')
  .option('--port <port>', '监听端口', '8818')
  .option('--host <host>', '监听地址（Docker 等容器场景用 0.0.0.0 对外暴露）', '127.0.0.1')
  .action(async (opts) => {
    const { startWebServer } = await import('./web/server.js');
    startWebServer(Number.parseInt(opts.port, 10) || 8818, opts.host);
  });

// `itdog 1.2.3.4` 等价于 `itdog ping 1.2.3.4`
const argv = process.argv.slice(2);
if (argv.length > 0 && !KNOWN_MODES.includes(argv[0]) && !argv[0].startsWith('-')) {
  argv.unshift('ping');
}
program.parse(argv, { from: 'user' });
