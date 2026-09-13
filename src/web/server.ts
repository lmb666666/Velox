import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { runTest, type TestRequest } from '../service.js';
import { isPkgRuntime, selfDir } from '../self-dir.js';
import { HAS_EMBEDDED_ASSETS, WEB_ASSETS } from '../web-assets.js';
import type { Frame, Mode, RunResult } from '../types.js';
import { allNodes, refreshNodesFromSite } from '../nodes.js';
import { DEFAULT_UA } from '../config.js';
import { listProviders, isProviderAvailable, getProvider } from '../providers/index.js';
import type { NodeInfo } from '../types.js';

/**
 * Velox Web 控制台后端：node:http 零框架。
 * REST 创建任务/查节点/查历史 + SSE 帧级实时推送；全局串行任务队列（对 itdog 友好）。
 */

const MODES: Mode[] = ['ping', 'tcping', 'http', 'dns', 'traceroute', 'batch-ping', 'batch-tcping'];

interface TaskEntry {
  id: string;
  req: TestRequest;
  state: 'queued' | 'running' | 'done' | 'error' | 'cancelled';
  createdAt: number;
  startedAt?: number;
  finishedAt?: number;
  frames: Frame[];
  result?: RunResult;
  error?: string;
  listeners: Set<ServerResponse>;
  /** 取消标记 + 中止源（DELETE /api/tests/:id） */
  cancelled?: boolean;
  abort?: AbortController;
}

const tasks = new Map<string, TaskEntry>();
let chain: Promise<void> = Promise.resolve();
const HISTORY_DIR = path.join(os.homedir(), '.cache', 'itdog-cli', 'web-history');
const HISTORY_LIMIT = 50;
const MAX_MEMORY_TASKS = 120;
/** 排队+执行中的任务上限：超出直接拒绝，防止连环提交拖垮队列与内存 */
const MAX_ACTIVE_TASKS = 16;
const MAX_BODY_BYTES = 1e6;

/** API-KEY 鉴权：设置 VELOX_API_KEY 后，写操作（创建任务/删历史）需携带 Bearer token 或 x-api-key。
 *  GET 读操作（health/nodes/meta/查询）不强制鉴权，保持 Web 控制台本地友好。 */
function apiKeyConfigured(): boolean {
  return Boolean(process.env.VELOX_API_KEY);
}

function authorized(req: IncomingMessage): boolean {
  const key = process.env.VELOX_API_KEY;
  if (!key) return true; // 未设置 API-KEY 时不鉴权
  const header = req.headers.authorization ?? req.headers['x-api-key'];
  const token = Array.isArray(header) ? header[0] : String(header ?? '');
  // 支持 "Bearer <key>" 或裸 key
  const challenge = token.replace(/^Bearer\s+/i, '').trim();
  return challenge === key;
}

/** 完成态任务保留最新 120 条，防止长时间运行内存无限增长 */
function pruneTasks(): void {
  if (tasks.size <= MAX_MEMORY_TASKS) return;
  const finished = [...tasks.values()]
    .filter((t) => (t.state === 'done' || t.state === 'error' || t.state === 'cancelled') && t.listeners.size === 0)
    .sort((a, b) => a.createdAt - b.createdAt);
  for (const t of finished.slice(0, tasks.size - MAX_MEMORY_TASKS)) tasks.delete(t.id);
}

function activeTaskCount(): number {
  let n = 0;
  for (const t of tasks.values()) if (t.state === 'queued' || t.state === 'running') n++;
  return n;
}

function resolveWebDist(): string | null {
  let dir = selfDir();
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
  '.txt': 'text/plain; charset=utf-8',
};

function json(res: ServerResponse, code: number, data: unknown): void {
  // 头已发出（如 SSE 中途出错）时只尝试截断响应，绝不能再 writeHead —— 否则
  // 异常会从 .catch 处理器里再抛出，变成 unhandled rejection 直接杀死进程
  if (res.headersSent) {
    try {
      res.end();
    } catch {
      /* 连接已断 */
    }
    return;
  }
  const body = JSON.stringify(data);
  try {
    res.writeHead(code, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    });
    res.end(body);
  } catch {
    /* 客户端已断开（如 body 超限被 destroy），写入失败忽略 */
  }
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
  // 排队期间被取消：直接标记取消态，不执行
  if (entry.cancelled) {
    entry.state = 'cancelled';
    entry.error = '任务已取消';
    entry.finishedAt = Date.now();
    broadcast(entry, 'state', { state: 'cancelled' });
    pruneTasks();
    return;
  }
  entry.state = 'running';
  entry.startedAt = Date.now();
  broadcast(entry, 'state', { state: 'running' });
  try {
    const result = await runTest(entry.req, {
      signal: entry.abort?.signal,
      onStatus: (line) => broadcast(entry, 'status', { line }),
      onFrame: (frame) => {
        entry.frames.push(frame); // 快照可回放（重连 SSE / 事后查询不丢帧）
        broadcast(entry, 'frame', { frame, index: entry.frames.length });
      },
    });
    // 双保险：即使 provider 忽略了中止信号优雅返回，取消的任务也不能落成 done
    if (entry.cancelled) throw new Error('任务已取消');
    entry.result = result;
    entry.state = 'done';
    entry.finishedAt = Date.now();
    broadcast(entry, 'done', {
      summary: result.summary,
      finished: result.finished,
      reason: result.reason,
      frames: result.frames,
      provider: result.provider,
    });
  } catch (e) {
    entry.error = entry.cancelled ? '任务已取消' : (e as Error).message;
    entry.state = entry.cancelled ? 'cancelled' : 'error';
    entry.finishedAt = Date.now();
    broadcast(entry, 'error', { message: entry.error });
  }
  // 取消的任务不写历史（无结果可回看）
  if (entry.state !== 'cancelled') saveHistory(entry);
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
    provider: entry.result?.provider,
  };
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (c) => {
      body += c;
      if (body.length > MAX_BODY_BYTES) {
        req.destroy(); // 超限立即断开，不再接收剩余上传
        reject(new Error('请求体过大'));
      }
    });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

/** 目标合法性：可打印 ASCII、无控制字符（会拼进 itdog 的请求 URL 与 WS 握手串） */
function validTarget(t: string): boolean {
  return t.length > 0 && t.length <= 200 && /^[\x21-\x7e]+$/.test(t);
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
  if (targets.length > 256) throw new Error('目标数量过多（上限 256）');
  for (const t of targets) {
    if (!validTarget(t)) throw new Error(`目标不合法（仅支持 ASCII 可打印字符，长度 ≤200）: ${t.slice(0, 40)}`);
  }
  const clamp = (v: unknown, min: number, max: number, dflt: number) => {
    const n = Number.parseInt(String(v ?? ''), 10);
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : dflt;
  };
  const provider = String(raw.provider ?? 'auto').trim() || 'auto';
  if (provider !== 'auto' && !isProviderAvailable(provider)) {
    throw new Error(`测速上游 "${provider}" 不可用（当前仅内置 itdog）`);
  }
  // 模式能力在提交时校验，避免无效任务占用串行队列后才在 SSE 里报错
  if (provider !== 'auto') {
    const p = getProvider(provider);
    if (p && !p.supportedModes.includes(mode)) {
      throw new Error(`上游 "${p.id}" 不支持 ${mode} 模式（支持：${p.supportedModes.join(' / ')}）`);
    }
  }
  return {
    mode,
    targets,
    nodes: String(raw.nodes ?? 'all').trim() || 'all',
    provider,
    port: clamp(raw.port, 1, 65535, 443),
    timeoutSec: clamp(raw.timeoutSec, 15, 600, 90),
    idleTimeoutSec: clamp(raw.idleTimeoutSec, 5, 120, 12),
    top: clamp(raw.top, 1, 50, 5),
    retry: clamp(raw.retry, 0, 10, 2),
    sort: raw.sort === 'loss' ? 'loss' : 'latency',
    proxy: typeof raw.proxy === 'string' && raw.proxy ? raw.proxy : undefined,
    checkMode: raw.checkMode === 'slow' ? 'slow' : 'fast',
    method: String(raw.method ?? 'get'),
    referer: String(raw.referer ?? ''),
    cookie: String(raw.cookie ?? ''),
    httpUa: String(raw.httpUa ?? ''),
    resolveTo: String(raw.resolveTo ?? ''),
    redirects: clamp(raw.redirects, 0, 10, 5),
    httpVersion: String(raw.httpVersion ?? 'auto'),
    dnsType: String(raw.dnsType ?? 'a'),
    dnsServer: String(raw.dnsServer ?? '').trim(),
  };
}

function serveStatic(res: ServerResponse, pathname: string, webDist: string | null): void {
  // ① 内嵌资源（pkg 单文件）：内存直读，完全不经文件系统（Windows 快照 fs 不可靠）
  if (HAS_EMBEDDED_ASSETS) {
    const rel = pathname === '/' ? '/index.html' : pathname;
    const b64 = WEB_ASSETS[rel] ?? (rel.slice(1).includes('.') ? undefined : WEB_ASSETS['/index.html']);
    if (b64 === undefined) {
      res.writeHead(404, { 'x-content-type-options': 'nosniff' });
      res.end('not found');
      return;
    }
    res.writeHead(200, {
      'content-type': MIME[path.extname(rel)] ?? 'application/octet-stream',
      'cache-control': rel.startsWith('/assets/') ? 'public, max-age=86400' : 'no-cache',
      'x-content-type-options': 'nosniff',
    });
    res.end(Buffer.from(b64, 'base64'));
    return;
  }
  // ② 文件系统（开发 / Docker / 普通部署）
  if (!webDist) {
    res.writeHead(503, { 'content-type': 'text/html; charset=utf-8' });
    res.end('<h1>Velox</h1><p>前端尚未构建，请先运行：<code>pnpm web:build</code></p>');
    return;
  }
  let rel: string;
  try {
    rel = pathname === '/' ? 'index.html' : decodeURIComponent(pathname).replace(/^\/+/, '');
  } catch {
    res.writeHead(400, { 'x-content-type-options': 'nosniff' });
    res.end('bad request');
    return;
  }
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
      'x-content-type-options': 'nosniff',
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
    json(res, 200, { ok: true, brand: 'Velox', tasks: tasks.size, nodes: allNodes().length });
    return true;
  }

  if (pathname === '/api/meta/providers' && req.method === 'GET') {
    json(res, 200, {
      providers: listProviders(),
      default: 'auto',
      auth: apiKeyConfigured() ? 'enabled' : 'disabled',
    });
    return true;
  }

  if (pathname === '/api/nodes' && req.method === 'GET') {
    // ?provider= 指定上游（当前仅 itdog）；auto 按 itdog 处理
    const qProvider = String(new URL(req.url ?? '/', 'http://x').searchParams.get('provider') ?? 'itdog');
    const providerId = qProvider === 'auto' ? 'itdog' : qProvider;
    const provider = getProvider(providerId);
    // 未启用/不存在的上游明确报错
    if (!provider) {
      json(res, 404, { error: `测速上游 "${providerId}" 未启用或不存在（当前仅内置 itdog）` });
      return true;
    }
    const usedProvider = provider.id;
    // 多上游恢复时在此按 provider 预拉其节点表；当前仅 itdog，
    // 节点表随每次任务创建从页面 HTML 自动更新（client.ts updateFromHtml）
    const nodes: NodeInfo[] = provider.getNodes();
    const byCat: Record<string, { id: string; name: string; provider: string }[]> = {};
    for (const n of nodes) {
      (byCat[n.category] ??= []).push({ id: n.id, name: n.name, provider: usedProvider });
    }
    json(res, 200, { total: nodes.length, categories: byCat, provider: usedProvider });
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
    if (!authorized(req)) {
      json(res, 401, { error: '未授权：需携带 API-KEY（Authorization: Bearer <key>）' });
      return true;
    }
    if (activeTaskCount() >= MAX_ACTIVE_TASKS) {
      json(res, 429, { error: `排队任务过多（上限 ${MAX_ACTIVE_TASKS}），请等待当前任务完成` });
      return true;
    }
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
      abort: new AbortController(),
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
    // 取消任务：排队中的直接标记；执行中的通过 AbortSignal 中止 provider 流
    if (req.method === 'DELETE') {
      if (!authorized(req)) {
        json(res, 401, { error: '未授权：需携带 API-KEY（Authorization: Bearer <key>）' });
        return true;
      }
      if (entry.state === 'queued' || entry.state === 'running') {
        entry.cancelled = true;
        entry.abort?.abort();
      }
      json(res, 200, { ok: true, state: entry.state });
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
          provider: raw.result?.provider,
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
    if (!authorized(req)) {
      json(res, 401, { error: '未授权：需携带 API-KEY（Authorization: Bearer <key>）' });
      return true;
    }
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
      if (!authorized(req)) {
        json(res, 401, { error: '未授权：需携带 API-KEY（Authorization: Bearer <key>）' });
        return true;
      }
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
        provider: raw.result?.provider,
      });
    } catch {
      json(res, 404, { error: '记录不存在' });
    }
    return true;
  }

  json(res, 404, { error: 'not found' });
  return true;
}

export function startWebServer(port = 8818, host = '127.0.0.1'): Server {
  // pkg 单文件：前端从内存服务（HAS_EMBEDDED_ASSETS），无需文件系统定位
  const webDist = isPkgRuntime() ? null : resolveWebDist();
  const server = createServer((req, res) => {
    const pathname = new URL(req.url ?? '/', 'http://x').pathname;
    handleApi(req, res, pathname)
      .then((handled) => {
        if (handled) return;
        serveStatic(res, pathname, webDist);
      })
      .catch((e) => {
        json(res, 500, { error: (e as Error).message });
      });
  });
  // 端口占用等启动错误给出友好提示，而不是抛未捕获异常直接崩掉窗口
  server.on('error', (e: NodeJS.ErrnoException) => {
    if (e.code === 'EADDRINUSE') {
      console.error(`\n  ⚠ 端口 ${port} 已被占用 —— 可能已有一个 Velox 在运行，或端口被其他程序使用`);
      console.error('    可用 --port 换一个端口，或关闭已有实例后重试\n');
    } else {
      console.error(`\n  ⚠ 服务启动失败：${e.message}\n`);
    }
    process.exitCode = 1;
  });
  server.listen(port, host, () => {
    console.log('');
    console.log('  ⚡ Velox —— Web 控制台已启动');
    console.log(`  ➜  http://localhost:${port}`);
    console.log(`  ➜  节点表：${allNodes().length} 个监测点${webDist || HAS_EMBEDDED_ASSETS ? '' : '（前端未构建：pnpm web:build）'}`);
    console.log('');
  });
  return server;
}

if (process.argv[1] && path.join(selfDir(), 'server.js') === path.resolve(process.argv[1])) {
  startWebServer(Number.parseInt(process.env.PORT ?? '8818', 10) || 8818);
}
