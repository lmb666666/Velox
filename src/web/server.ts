import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { runTest, type TestRequest } from '../service.js';
import type { Frame, Mode, RunResult } from '../types.js';
import { allNodes, refreshNodesFromSite } from '../nodes.js';
import { DEFAULT_UA } from '../config.js';

/**
 * Pulse 脉测 Web 控制台后端：node:http 零框架。
 * REST 创建任务/查节点/查历史 + SSE 帧级实时推送；全局串行任务队列（对 itdog 友好）。
 */

const MODES: Mode[] = ['ping', 'tcping', 'http', 'dns', 'traceroute', 'batch-ping', 'batch-tcping'];

interface TaskEntry {
  id: string;
  req: TestRequest;
  state: 'queued' | 'running' | 'done' | 'error';
  createdAt: number;
  startedAt?: number;
  finishedAt?: number;
  frames: Frame[];
  result?: RunResult;
  error?: string;
  listeners: Set<ServerResponse>;
}

const tasks = new Map<string, TaskEntry>();
let chain: Promise<void> = Promise.resolve();
const HISTORY_DIR = path.join(os.homedir(), '.cache', 'itdog-cli', 'web-history');
const HISTORY_LIMIT = 50;
const MAX_MEMORY_TASKS = 120;

/** 完成态任务保留最新 120 条，防止长时间运行内存无限增长 */
function pruneTasks(): void {
  if (tasks.size <= MAX_MEMORY_TASKS) return;
  const finished = [...tasks.values()]
    .filter((t) => (t.state === 'done' || t.state === 'error') && t.listeners.size === 0)
    .sort((a, b) => a.createdAt - b.createdAt);
  for (const t of finished.slice(0, tasks.size - MAX_MEMORY_TASKS)) tasks.delete(t.id);
}

function resolveWebDist(): string | null {
  const here = path.dirname(fileURLToPath(import.meta.url));
  let dir = here;
  for (let i = 0; i < 5; i++) {
    const candidate = path.join(dir, 'web', 'dist');
    if (fs.existsSync(path.join(candidate, 'index.html'))) return candidate;
    dir = path.dirname(dir);
  }
  return null;
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

function json(res: ServerResponse, code: number, data: unknown): void {
  const body = JSON.stringify(data);
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(body);
}

function broadcast(entry: TaskEntry, event: string, data: unknown): void {
  for (const res of entry.listeners) {
    try {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    } catch {
      entry.listeners.delete(res);
    }
  }
}

function saveHistory(entry: TaskEntry): void {
  try {
    fs.mkdirSync(HISTORY_DIR, { recursive: true });
    const record = {
      id: entry.id,
      mode: entry.req.mode,
      targets: entry.req.targets,
      createdAt: entry.createdAt,
      finishedAt: entry.finishedAt ?? Date.now(),
      result: entry.result,
      error: entry.error,
    };
    fs.writeFileSync(path.join(HISTORY_DIR, `${entry.id}.json`), JSON.stringify(record));
    // 只保留最近 HISTORY_LIMIT 条
    const files = fs.readdirSync(HISTORY_DIR).filter((f) => f.endsWith('.json')).map((f) => ({
      f,
      m: fs.statSync(path.join(HISTORY_DIR, f)).mtimeMs,
    })).sort((a, b) => b.m - a.m);
    for (const old of files.slice(HISTORY_LIMIT)) fs.rmSync(path.join(HISTORY_DIR, old.f));
  } catch {
    /* 历史写失败不影响主流程 */
  }
}

function enqueue(entry: TaskEntry): void {
  chain = chain
    .then(() => execute(entry))
    .catch(() => {});
}

async function execute(entry: TaskEntry): Promise<void> {
  entry.state = 'running';
  entry.startedAt = Date.now();
  broadcast(entry, 'state', { state: 'running' });
  try {
    const result = await runTest(entry.req, {
      onStatus: (line) => broadcast(entry, 'status', { line }),
      onFrame: (frame, index) => broadcast(entry, 'frame', { frame, index }),
    });
    entry.result = result;
    entry.state = 'done';
    entry.finishedAt = Date.now();
    broadcast(entry, 'done', {
      summary: result.summary,
      finished: result.finished,
      reason: result.reason,
      frames: result.frames,
    });
  } catch (e) {
    entry.state = 'error';
    entry.error = (e as Error).message;
    entry.finishedAt = Date.now();
    broadcast(entry, 'error', { message: entry.error });
  }
  saveHistory(entry);
  broadcast(entry, 'state', { state: entry.state });
  pruneTasks();
}

function snapshot(entry: TaskEntry) {
  return {
    id: entry.id,
    state: entry.state,
    mode: entry.req.mode,
    targets: entry.req.targets,
    createdAt: entry.createdAt,
    frames: entry.frames,
    summary: entry.result?.summary,
    finished: entry.result?.finished,
    reason: entry.result?.reason,
    error: entry.error,
  };
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (c) => {
      body += c;
      if (body.length > 1e6) reject(new Error('body too large'));
    });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

function parseRequest(body: string): TestRequest {
  const raw = JSON.parse(body) as Record<string, unknown>;
  const mode = String(raw.mode ?? 'ping') as Mode;
  if (!MODES.includes(mode)) throw new Error(`不支持的模式: ${mode}`);
  const targetsRaw = raw.targets;
  const targets = (Array.isArray(targetsRaw) ? targetsRaw : String(targetsRaw ?? '').split('\n'))
    .map((t) => String(t).trim())
    .filter(Boolean);
  if (targets.length === 0) throw new Error('缺少目标');
  const clamp = (v: unknown, min: number, max: number, dflt: number) => {
    const n = Number.parseInt(String(v ?? ''), 10);
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : dflt;
  };
  return {
    mode,
    targets,
    nodes: String(raw.nodes ?? 'all').trim() || 'all',
    port: clamp(raw.port, 1, 65535, 443),
    timeoutSec: clamp(raw.timeoutSec, 15, 600, 90),
    idleTimeoutSec: clamp(raw.idleTimeoutSec, 5, 120, 12),
    top: clamp(raw.top, 1, 50, 5),
    sort: raw.sort === 'loss' ? 'loss' : 'latency',
    proxy: typeof raw.proxy === 'string' && raw.proxy ? raw.proxy : undefined,
    checkMode: raw.checkMode === 'detail' ? 'detail' : 'fast',
    method: String(raw.method ?? 'get'),
    redirects: clamp(raw.redirects, 0, 20, 5),
    httpVersion: String(raw.httpVersion ?? 'auto'),
    dnsType: String(raw.dnsType ?? 'a'),
    dnsServer: String(raw.dnsServer ?? ''),
  };
}

function serveStatic(res: ServerResponse, pathname: string, webDist: string): void {
  const rel = pathname === '/' ? 'index.html' : decodeURIComponent(pathname).replace(/^\/+/, '');
  const file = path.join(webDist, rel);
  // 防目录穿越：解析后必须仍在 webDist 内
  if (!path.resolve(file).startsWith(path.resolve(webDist) + path.sep) && path.resolve(file) !== path.resolve(webDist)) {
    res.writeHead(403);
    res.end();
    return;
  }
  try {
    const data = fs.readFileSync(file);
    res.writeHead(200, {
      'content-type': MIME[path.extname(file)] ?? 'application/octet-stream',
      'cache-control': rel.startsWith('assets/') ? 'public, max-age=86400' : 'no-cache',
    });
    res.end(data);
  } catch {
    // SPA 兜底：非静态路径回退 index.html
    if (!rel.includes('.')) {
      const index = fs.readFileSync(path.join(webDist, 'index.html'));
      res.writeHead(200, { 'content-type': MIME['.html'] });
      res.end(index);
      return;
    }
    res.writeHead(404);
    res.end('not found');
  }
}

async function handleApi(req: IncomingMessage, res: ServerResponse, pathname: string): Promise<boolean> {
  if (!pathname.startsWith('/api/')) return false;

  if (pathname === '/api/health' && req.method === 'GET') {
    json(res, 200, { ok: true, brand: 'Pulse 脉测', tasks: tasks.size, nodes: allNodes().length });
    return true;
  }

  if (pathname === '/api/nodes' && req.method === 'GET') {
    const byCat: Record<string, { id: string; name: string }[]> = {};
    for (const n of allNodes()) {
      (byCat[n.category] ??= []).push({ id: n.id, name: n.name });
    }
    json(res, 200, { total: allNodes().length, categories: byCat });
    return true;
  }

  if (pathname === '/api/nodes/refresh' && req.method === 'POST') {
    try {
      const { updated, counts } = await refreshNodesFromSite(DEFAULT_UA);
      json(res, 200, { updated, total: allNodes().length, counts });
    } catch (e) {
      json(res, 502, { error: `节点表刷新失败：${(e as Error).message}` });
    }
    return true;
  }

  if (pathname === '/api/tests' && req.method === 'POST') {
    let reqTest: TestRequest;
    try {
      reqTest = parseRequest(await readBody(req));
    } catch (e) {
      json(res, 400, { error: (e as Error).message });
      return true;
    }
    const id = crypto.randomUUID().replaceAll('-', '').slice(0, 12);
    const entry: TaskEntry = {
      id,
      req: reqTest,
      state: 'queued',
      createdAt: Date.now(),
      frames: [],
      listeners: new Set(),
    };
    tasks.set(id, entry);
    enqueue(entry);
    json(res, 200, { id, state: entry.state });
    return true;
  }

  const testMatch = /^\/api\/tests\/([0-9a-f]+)(\/events)?$/.exec(pathname);
  if (testMatch) {
    const entry = tasks.get(testMatch[1]);
    if (!entry) {
      json(res, 404, { error: '任务不存在' });
      return true;
    }
    if (testMatch[2] === '/events' && req.method === 'GET') {
      // SSE 实时流
      res.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
      });
      res.write(`event: snapshot\ndata: ${JSON.stringify(snapshot(entry))}\n\n`);
      entry.listeners.add(res);
      const hb = setInterval(() => {
        try {
          res.write(': hb\n\n');
        } catch {
          /* 关闭时忽略 */
        }
      }, 15000);
      req.on('close', () => {
        clearInterval(hb);
        entry.listeners.delete(res);
      });
      return true;
    }
    json(res, 200, snapshot(entry));
    return true;
  }

  if (pathname === '/api/history' && req.method === 'GET') {
    try {
      const files = fs.readdirSync(HISTORY_DIR).filter((f) => f.endsWith('.json')).map((f) => {
        const raw = JSON.parse(fs.readFileSync(path.join(HISTORY_DIR, f), 'utf8'));
        return {
          id: raw.id,
          mode: raw.mode,
          targets: raw.targets,
          createdAt: raw.createdAt,
          finishedAt: raw.finishedAt,
          okNodes: raw.result?.summary?.okNodes,
          totalNodes: raw.result?.summary?.totalNodes,
          overallAvg: raw.result?.summary?.overallAvg,
          error: raw.error,
        };
      }).sort((a, b) => b.createdAt - a.createdAt);
      json(res, 200, { items: files });
    } catch {
      json(res, 200, { items: [] });
    }
    return true;
  }

  if (pathname === '/api/history' && req.method === 'DELETE') {
    try {
      for (const f of fs.readdirSync(HISTORY_DIR)) fs.rmSync(path.join(HISTORY_DIR, f));
      json(res, 200, { ok: true });
    } catch (e) {
      json(res, 500, { error: (e as Error).message });
    }
    return true;
  }

  const histMatch = /^\/api\/history\/([0-9a-f]+)$/.exec(pathname);
  if (histMatch && (req.method === 'GET' || req.method === 'DELETE')) {
    const file = path.join(HISTORY_DIR, `${histMatch[1]}.json`);
    if (req.method === 'DELETE') {
      try {
        fs.rmSync(file);
        json(res, 200, { ok: true });
      } catch {
        json(res, 404, { error: '记录不存在' });
      }
      return true;
    }
    try {
      const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
      // 顶层展开 result 字段，前端按 RunResult 形状消费
      json(res, 200, {
        ...raw,
        summary: raw.result?.summary,
        frames: raw.result?.frames ?? [],
        finished: raw.result?.finished ?? false,
        reason: raw.result?.reason ?? '',
      });
    } catch {
      json(res, 404, { error: '记录不存在' });
    }
    return true;
  }

  json(res, 404, { error: 'not found' });
  return true;
}

export function startWebServer(port = 8818, host = '0.0.0.0'): void {
  const webDist = resolveWebDist();
  const server = createServer((req, res) => {
    const pathname = new URL(req.url ?? '/', 'http://x').pathname;
    handleApi(req, res, pathname)
      .then((handled) => {
        if (handled) return;
        if (!webDist) {
          res.writeHead(503, { 'content-type': 'text/html; charset=utf-8' });
          res.end('<h1>Pulse 脉测</h1><p>前端尚未构建，请先运行：<code>pnpm web:build</code></p>');
          return;
        }
        serveStatic(res, pathname, webDist);
      })
      .catch((e) => {
        json(res, 500, { error: (e as Error).message });
      });
  });
  server.listen(port, host, () => {
    console.log('');
    console.log('  ⚡ Pulse 脉测 —— Web 控制台已启动');
    console.log(`  ➜  http://localhost:${port}`);
    console.log(`  ➜  节点表：${allNodes().length} 个监测点${webDist ? '' : '（前端未构建：pnpm web:build）'}`);
    console.log('');
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  startWebServer(Number.parseInt(process.env.PORT ?? '8818', 10) || 8818);
}
