/**
 * 终端交互界面（TUI）：pkg 单文件双击启动后的默认入口。
 * 默认不运行 Web 服务；菜单内可选择启动 Web 控制台，或在终端直接使用各测速功能。
 * 仅依赖 node:readline（无 TUI 第三方库），与 pkg 环境兼容。
 *
 * 输入采用「行队列」：统一监听 line 事件入队、ask 依次消费，
 * 无论是真实键盘逐字输入还是管道/预输入都不会丢行。
 */
import * as readline from 'node:readline';
import { spawn } from 'node:child_process';
import { runTest, type TestRequest } from './service.js';
import { allNodes, refreshNodesFromSite } from './nodes.js';
import { renderSummary, renderTable } from './render.js';
import { startWebServer } from './web/server.js';
import { DEFAULT_UA } from './config.js';
import { VERSION } from './version.js';
import type { Frame, Mode } from './types.js';

const WEB_URL = 'http://localhost:8818';
let webServer: import('node:http').Server | null = null;

type Asker = {
  ask: (q: string) => Promise<string>;
  isClosed: () => boolean;
};

/** 行队列 asker：line 事件入队，ask 依次消费（时序无关） */
function makeAsker(rl: readline.Interface): Asker {
  const queue: string[] = [];
  const waiters: Array<(v: string) => void> = [];
  let closed = false;
  rl.on('line', (l) => {
    const w = waiters.shift();
    if (w) w(l.trim());
    else queue.push(l.trim());
  });
  rl.on('close', () => {
    closed = true;
    waiters.splice(0).forEach((w) => w(''));
  });
  return {
    ask: (q) =>
      new Promise<string>((resolve) => {
        if (queue.length > 0) {
          process.stdout.write(q);
          resolve(queue.shift()!);
          return;
        }
        if (closed) {
          resolve('');
          return;
        }
        waiters.push((v) => {
          process.stdout.write(q);
          resolve(v);
        });
        process.stdout.write(q);
      }),
    isClosed: () => closed && queue.length === 0,
  };
}

const CJK = (s: string) => [...s].reduce((w, ch) => w + (ch.codePointAt(0)! > 0x2e7f ? 2 : 1), 0);
const row = (label: string, desc: string) => {
  const pad = ' '.repeat(Math.max(0, 22 - CJK(label)));
  return `  │  ${label}${pad}${desc}  │`;
};

function printMenu(nodeCount: number): void {
  console.log('');
  console.log(`  ⚡ Velox v${VERSION} —— 多节点测速（当前 ${nodeCount} 个监测点）`);
  console.log('  ┌────────────────────────────────────────┐');
  console.log(row('  1. Web 控制台', '启动/停止本地 Web 服务'));
  console.log(row('  2. Ping 测速', '多节点 ICMP 延迟'));
  console.log(row('  3. TCPing 测速', 'TCP 端口连通/延迟'));
  console.log(row('  4. HTTP 测速', '网站打开速度'));
  console.log(row('  5. DNS 解析', '各地 DNS 解析'));
  console.log(row('  6. Traceroute', '路由跟踪（单节点）'));
  console.log(row('  7. 批量 Ping', '多目标（IP 优选）'));
  console.log(row('  8. 刷新节点表', '从 itdog 重新抓取'));
  console.log(row('  0. 退出', ''));
  console.log('  └────────────────────────────────────────┘');
}

function openBrowser(url: string): void {
  const open =
    process.platform === 'win32'
      ? spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' })
      : process.platform === 'darwin'
        ? spawn('open', [url], { detached: true, stdio: 'ignore' })
        : spawn('xdg-open', [url], { detached: true, stdio: 'ignore' });
  open.on('error', () => {}); // 无图形环境时忽略
  open.unref();
}

function frameLine(mode: Mode, frame: Frame, index: number): string {
  if (mode === 'traceroute') return '';
  const name = String(frame.name ?? '');
  const ip = String(frame.ip ?? '');
  const ok = frame.type === undefined || frame.type === 'success' ? (ip === 'Not Found' ? '✗' : '✓') : '✗';
  const ms = frame.result !== undefined ? ` ${frame.result}ms` : frame.all_time !== undefined ? ` ${Math.round(Number(frame.all_time) * 1000)}ms` : '';
  return `  [${String(index).padStart(3)}] ${ok} ${name}  ${ip}${ms}`;
}

async function runModeTui(ask: Asker['ask'], mode: Mode): Promise<void> {
  const hints: Partial<Record<Mode, string>> = {
    http: '目标 URL',
    dns: '目标域名',
    'batch-ping': '多个目标（逗号分隔）',
  };
  const hint = hints[mode] ?? '目标（IP 或域名）';
  const target = (await ask(`  ${hint}: `)).trim();
  if (!target) {
    console.log('  未输入目标，已取消。');
    return;
  }
  const nodes = (await ask('  节点选择（回车=三网；all=全部；telecom/unicom/mobile/overseas；名称关键词；节点ID）: ')).trim() || 'telecom,unicom,mobile';
  const port = mode === 'tcping' ? Number.parseInt((await ask('  端口 [443]: ')).trim() || '443', 10) || 443 : 443;

  const req: TestRequest = {
    mode,
    targets: target.split(',').map((t) => t.trim()).filter(Boolean),
    nodes,
    port,
    timeoutSec: mode === 'traceroute' ? 60 : 90,
    top: 5,
    sort: 'latency',
  };
  console.log('');
  const result = await runTest(req, {
    onStatus: (line) => console.log(`  ${line}`),
    onFrame: (frame, index) => {
      const line = frameLine(mode, frame, index);
      if (line) console.log(line);
    },
  });
  console.log('');
  console.log(renderTable(mode, result.summary.stats));
  console.log('');
  console.log(renderSummary(result.summary, result.finished));
  console.log('');
  await ask('  按回车返回菜单...');
}

async function webTui(ask: Asker['ask']): Promise<void> {
  if (webServer) {
    console.log(`  Web 控制台已在运行：${WEB_URL}`);
    await ask('  按回车返回菜单...');
    return;
  }
  webServer = startWebServer(8818, '127.0.0.1');
  console.log('  Web 控制台已启动（服务运行中）。');
  const y = (await ask('  是否在浏览器打开？[Y/n] ')).trim().toLowerCase();
  if (y !== 'n') openBrowser(WEB_URL);
  await ask('  按回车停止 Web 服务并返回菜单...');
  webServer.close(() => console.log('  Web 控制台已停止。'));
  webServer = null;
}

export function startTui(): void {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const { ask, isClosed } = makeAsker(rl);
  rl.on('SIGINT', () => {
    console.log('\n  再见。');
    process.exit(0);
  });

  void (async () => {
    for (;;) {
      if (isClosed()) break;
      printMenu(allNodes().length);
      const c = (await ask('  请选择: ')).trim();
      if (c === '' && isClosed()) break;
      try {
        if (c === '1') await webTui(ask);
        else if (c === '2') await runModeTui(ask, 'ping');
        else if (c === '3') await runModeTui(ask, 'tcping');
        else if (c === '4') await runModeTui(ask, 'http');
        else if (c === '5') await runModeTui(ask, 'dns');
        else if (c === '6') await runModeTui(ask, 'traceroute');
        else if (c === '7') await runModeTui(ask, 'batch-ping');
        else if (c === '8') {
          console.log('  正在从 itdog 刷新节点表...');
          const { updated, counts } = await refreshNodesFromSite(DEFAULT_UA);
          console.log(updated > 0 ? `  节点表已刷新：${Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(' / ')}` : '  节点表刷新失败：页面未包含节点数据');
          await ask('  按回车返回菜单...');
        } else if (c === '0' || c.toLowerCase() === 'q') break;
        else if (c !== '') console.log('  无效选择，请输入菜单编号。');
      } catch (e) {
        console.log(`  错误: ${(e as Error).message}`);
        await ask('  按回车返回菜单...');
      }
    }
    rl.close();
    console.log('  再见。');
  })();
}
