/**
 * 终端交互界面（TUI）：pkg 单文件双击启动后的默认入口。
 * 默认不运行 Web 服务；菜单内可启动/停止 Web 控制台，或在终端直接使用各测速功能。
 *
 * 设计：
 *  - TTY 下为 prompts 风格彩色菜单：↑↓/数字导航、Enter 确认、q 返回（raw keypress）
 *  - 非TTY（管道/自动化）自动降级为数字行菜单，行为可确定性验证
 *  - 测速过程带实时状态行（已收帧/耗时/最新节点），结果彩色渲染
 *  - 仅依赖 node:readline + ANSI 转义（无 TUI 第三方库），与 pkg 环境兼容
 *  - pkg 引导器禁止原生动态 import()：全部依赖静态导入
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

const WEB_PORT = 8818;
const WEB_URL = `http://localhost:${WEB_PORT}`;
let webServer: import('node:http').Server | null = null;

// ── ANSI 颜色与光标（非 TTY 时退化为无色）──
const tty = process.stdout.isTTY === true && !process.env.NO_COLOR;
const C = {
  bold: (s: string) => (tty ? `\x1b[1m${s}\x1b[22m` : s),
  dim: (s: string) => (tty ? `\x1b[2m${s}\x1b[39m` : s),
  cyan: (s: string) => (tty ? `\x1b[36m${s}\x1b[39m` : s),
  green: (s: string) => (tty ? `\x1b[32m${s}\x1b[39m` : s),
  yellow: (s: string) => (tty ? `\x1b[33m${s}\x1b[39m` : s),
  red: (s: string) => (tty ? `\x1b[31m${s}\x1b[39m` : s),
};
const gradeColor = (ms: number) => (ms <= 50 ? C.green : ms <= 150 ? C.cyan : ms <= 300 ? C.yellow : C.red);
const CLEAR_LINE = tty ? '\x1b[2K\r' : '\r';

function setRaw(on: boolean): void {
  if (process.stdin.isTTY) {
    try {
      process.stdin.setRawMode(on);
    } catch {
      /* 非 TTY 环境忽略 */
    }
  }
}

// ── 行队列 asker：line 事件入队，ask 依次消费（时序无关，管道不丢行）──
type Asker = { ask: (q: string) => Promise<string>; isClosed: () => boolean };
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
        process.stdout.write(q);
        if (queue.length > 0) resolve(queue.shift()!);
        else if (closed) resolve('');
        else waiters.push(resolve);
      }),
    isClosed: () => closed && queue.length === 0,
  };
}

/** TTY 交互式选择：↑↓/j/k/数字移动，Enter 确认，q/Esc 返回 null。返回所选下标或 null */
function interactiveSelect(items: string[]): Promise<number | null> {
  return new Promise((resolve) => {
    let index = 0;
    let drawn = 0;
    readline.emitKeypressEvents(process.stdin);
    setRaw(true);
    const render = (): void => {
      const lines = items.map((label, i) =>
        i === index ? C.cyan(`  ❯ ${i + 1}. ${label}`) : C.dim(`    ${i + 1}. ${label}`),
      );
      lines.push(C.dim('  ↑↓/数字 选择 · Enter 确认 · q 返回上级'));
      if (drawn > 0) process.stdout.write(`\x1b[${drawn}A`);
      for (const l of lines) process.stdout.write(`${CLEAR_LINE}${l}\n`);
      drawn = lines.length;
    };
    const finish = (v: number | null): void => {
      process.stdin.removeListener('keypress', onKey);
      setRaw(false);
      if (v === null) {
        // 抹掉菜单后退出
        process.stdout.write(`\x1b[${drawn}A`);
        for (let i = 0; i < drawn; i++) process.stdout.write(`${CLEAR_LINE}\n`);
        process.stdout.write(`\x1b[${drawn}A`);
      } else {
        // 收起提示行
        process.stdout.write(`\x1b[${1}A${CLEAR_LINE}`);
      }
      resolve(v);
    };
    const onKey = (str: string, key: { name?: string; ctrl?: boolean; sequence?: string }): void => {
      if (key?.ctrl && key.name === 'c') {
        process.stdout.write('\n');
        process.exit(0);
      }
      if (key?.name === 'up' || key?.name === 'k') index = (index - 1 + items.length) % items.length;
      else if (key?.name === 'down' || key?.name === 'j') index = (index + 1) % items.length;
      else if (key?.name === 'return' || key?.name === 'enter') return finish(index);
      else if (key?.name === 'q' || key?.name === 'escape') return finish(null);
      else if (str && /^[1-9]$/.test(str)) {
        const d = Number(str) - 1;
        if (d < items.length) {
          index = d;
          return finish(index);
        }
        return;
      } else return;
      render();
    };
    process.stdin.on('keypress', onKey);
    render();
  });
}

// ── 实时状态行 ──
let statusVisible = false;
function printLine(text: string): void {
  if (statusVisible) process.stdout.write('\n');
  statusVisible = false;
  console.log(text);
}
function drawStatus(text: string): void {
  if (!tty) return;
  process.stdout.write(`${CLEAR_LINE}${text}`);
  statusVisible = true;
}

// ── 菜单 ──
const MENU = [
  { key: '1', label: 'Web 控制台', hint: () => (webServer ? C.green('● 运行中 ' + WEB_URL.replace('http://', '')) : '启动本地 Web 服务') },
  { key: '2', label: 'Ping 测速', hint: () => '多节点 ICMP 延迟' },
  { key: '3', label: 'TCPing 测速', hint: () => 'TCP 端口连通/延迟' },
  { key: '4', label: 'HTTP 测速', hint: () => '网站打开速度' },
  { key: '5', label: 'DNS 解析', hint: () => '各地 DNS 解析' },
  { key: '6', label: 'Traceroute', hint: () => '路由跟踪（单节点）' },
  { key: '7', label: '批量 Ping', hint: () => '多目标 · IP 优选' },
  { key: '8', label: '刷新节点表', hint: () => '从 itdog 重新抓取' },
];

function printHeader(): void {
  const web = webServer ? C.green('● Web 运行中') : C.dim('○ Web 未启动');
  console.log('');
  console.log(`  ${C.bold('⚡ Velox')} ${C.dim('v' + VERSION)}  ${web}  ${C.dim(`监测点 ${allNodes().length}`)}`);
  console.log('');
}

/** 菜单选择：TTY 走交互式选择，非 TTY 走数字行输入 */
async function menuSelect(ask: Asker['ask']): Promise<string | null> {
  const items = MENU.map((m) => `${m.label}  ${C.dim(m.hint())}`);
  if (!process.stdin.isTTY) {
    items.forEach((l, i) => printLine(`  ${i + 1}. ${l}`));
    printLine('  0. 退出');
    while (true) {
      const v = (await ask('  请选择: ')).trim();
      if (v === 'q') return null;
      if (v === '0') return 'exit';
      const n = Number.parseInt(v, 10);
      if (n >= 1 && n <= MENU.length) return MENU[n - 1].key;
      if (v === '') continue;
      printLine(C.red('  无效选择'));
    }
  }
  const idx = await interactiveSelect(items);
  if (idx === null) return null;
  return MENU[idx].key;
}

// ── 测速执行 ──
function gradeText(mode: Mode, frame: Frame): { ok: boolean; text: string } {
  const name = String(frame.name ?? '');
  const ip = String(frame.ip ?? '');
  if (mode === 'http') {
    const code = typeof frame.http_code === 'number' ? frame.http_code : 0;
    const ms = frame.all_time !== undefined ? Math.round(Number(frame.all_time) * 1000) : undefined;
    return { ok: frame.type === 'success' && code > 0, text: `${name}  ${code || '-'}  ${ms !== undefined ? gradeColor(ms)(ms + 'ms') : ''}` };
  }
  const n = typeof frame.result === 'number' ? frame.result : undefined;
  const ok = ip !== 'Not Found' && ip !== '' && n !== undefined;
  const text = `${name}  ${ip}${n !== undefined ? '  ' + gradeColor(n)(n + 'ms') : ''}`;
  return { ok, text };
}

async function runModeTui(ask: Asker['ask'], mode: Mode): Promise<void> {
  const hints: Partial<Record<Mode, string>> = {
    http: '目标 URL',
    dns: '目标域名',
    'batch-ping': '多个目标（逗号分隔）',
  };
  const defaults: Partial<Record<Mode, string>> = { http: 'https://www.baidu.com', ping: 'www.baidu.com' };
  const hint = hints[mode] ?? '目标（IP 或域名）';
  const target = (await ask(`  ${hint} ${defaults[mode] ? `[${defaults[mode]}]` : ''}: `)).trim() || defaults[mode] || '';
  if (!target) {
    printLine(C.yellow('  未输入目标，已取消。'));
    return;
  }
  const nodes = (await ask('  节点 [三网]: ')).trim() || 'telecom,unicom,mobile';
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
  printLine(C.dim(`  ${mode} · 节点=${nodes} · 目标=${target}`));
  const started = Date.now();
  let frames = 0;
  let okCount = 0;
  let lastLine = '';
  const result = await runTest(req, {
    onStatus: (line) => printLine(C.dim('  ' + line)),
    onFrame: (frame, index) => {
      frames++;
      const g = gradeText(mode, frame);
      if (g.ok) okCount++;
      lastLine = g.text;
      drawStatus(C.dim(`  ⟳ ${frames} 帧 · ${((Date.now() - started) / 1000).toFixed(0)}s · `) + lastLine);
    },
  });
  if (statusVisible) process.stdout.write('\n');
  statusVisible = false;
  const secs = ((Date.now() - started) / 1000).toFixed(0);
  printLine(
    result.summary.failedNodes > 0
      ? `  ${C.green(`✔ 完成 ${secs}s`)}  ${C.green('成功 ' + result.summary.okNodes)} / ${C.red('失败 ' + result.summary.failedNodes)}`
      : `  ${C.green(`✔ 完成 ${secs}s`)}  ${C.green(`成功 ${result.summary.okNodes}/${result.summary.totalNodes}`)}`,
  );
  console.log('');
  console.log(renderTable(mode, result.summary.stats));
  console.log('');
  console.log(renderSummary(result.summary, result.finished));
  console.log('');
  await ask(C.dim('  按回车返回菜单...'));
}

async function webTui(ask: Asker['ask']): Promise<void> {
  if (webServer) {
    const y = (await ask(`  ${C.yellow('Web 控制台运行中')}，停止它？[Y/n] `)).trim().toLowerCase();
    if (y !== 'n') {
      webServer.close(() => console.log('  ' + C.dim('Web 控制台已停止。')));
      webServer = null;
    }
    return;
  }
  webServer = startWebServer(WEB_PORT, '127.0.0.1');
  printLine(`  ${C.green('Web 控制台已启动：' + WEB_URL)}`);
  const y = (await ask('  是否在浏览器打开？[Y/n] ')).trim().toLowerCase();
  if (y !== 'n') {
    const open =
      process.platform === 'win32'
        ? spawn('cmd', ['/c', 'start', '', WEB_URL], { detached: true, stdio: 'ignore' })
        : process.platform === 'darwin'
          ? spawn('open', [WEB_URL], { detached: true, stdio: 'ignore' })
          : spawn('xdg-open', [WEB_URL], { detached: true, stdio: 'ignore' });
    open.on('error', () => {}); // 无图形环境时忽略
    open.unref();
  }
}

async function refreshTui(): Promise<void> {
  printLine(C.dim('  正在从 itdog 刷新节点表...'));
  const { updated, counts } = await refreshNodesFromSite(DEFAULT_UA);
  printLine(
    updated > 0
      ? `  ${C.green('✔ 节点表已刷新')}：${Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(' / ')}`
      : C.yellow('  节点表刷新失败：页面未包含节点数据'),
  );
}

export function startTui(): void {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: false });
  const { ask, isClosed } = makeAsker(rl);
  rl.on('SIGINT', () => {
    console.log('\n  再见。');
    process.exit(0);
  });

  void (async () => {
    for (;;) {
      if (isClosed()) break;
      printHeader();
      const c = await menuSelect(ask);
      if (isClosed()) break;
      if (c === null || c === 'exit') break;
      try {
        if (c === '1') await webTui(ask);
        else if (c === '2') await runModeTui(ask, 'ping');
        else if (c === '3') await runModeTui(ask, 'tcping');
        else if (c === '4') await runModeTui(ask, 'http');
        else if (c === '5') await runModeTui(ask, 'dns');
        else if (c === '6') await runModeTui(ask, 'traceroute');
        else if (c === '7') await runModeTui(ask, 'batch-ping');
        else if (c === '8') await refreshTui();
      } catch (e) {
        printLine(C.red(`  错误: ${(e as Error).message}`));
        await ask(C.dim('  按回车返回菜单...'));
      }
    }
    rl.close();
    console.log('  再见。');
  })();
}
