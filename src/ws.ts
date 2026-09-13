import { createHash } from 'node:crypto';
import WebSocket from 'ws';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { WS_SALT, BASE_URL } from './config.js';
import type { Frame } from './types.js';

/**
 * 结果流：连接 wss://www.itdog.cn/websockets/<task_id>/<token>，
 * 握手发送 {"task_id": ...}，逐帧回调，收到 {"type":"finished"} 结束。
 * token = md5(task_id + WS_SALT) 十六进制第 8~24 位（盐见 config.ts，2026-09 抓取自官方前端）。
 *
 * itdog 的 openresty 对「任务创建后立刻发起的 WS 握手」会概率性 403/静默，
 * 官方前端的做法是失败后延时 2 秒重连，这里同样实现：零帧结束则重连（带退避）。
 */

export interface StreamOptions {
  wssUrl: string;
  taskId: string;
  ua: string;
  overallTimeoutMs: number;
  idleTimeoutMs: number;
  proxy?: string;
  /** 取消信号：中止后立即断开连接并停止重连（Web 端「停止测试」用） */
  signal?: AbortSignal;
  onFrame: (frame: Frame) => void;
}

export interface StreamResult {
  reason: 'finished' | 'overall-timeout' | 'idle-timeout' | 'closed' | 'error';
  frames: Frame[];
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function taskToken(taskId: string): string {
  return createHash('md5').update(taskId + WS_SALT).digest('hex').slice(8, 24);
}

const MAX_RESENDS = 3;
const MAX_RECONNECTS = 4;
const RECONNECT_DELAY_MS = 2000; // 与官方前端一致（0x7d0）

export async function streamTask(opts: StreamOptions): Promise<StreamResult> {
  const { wssUrl, taskId, ua } = opts;
  const base = wssUrl.endsWith('/') ? wssUrl : `${wssUrl}/`;
  const url = `${base}${taskId}/${taskToken(taskId)}`;
  const handshake = JSON.stringify({ task_id: taskId });

  const frames: Frame[] = [];
  const deadline = Date.now() + opts.overallTimeoutMs;
  let reason: StreamResult['reason'] = 'closed';
  let finished = false;

  let wsOptions: Record<string, unknown> = {
    headers: { origin: BASE_URL.replace(/\/$/, ''), 'user-agent': ua },
  };
  if (opts.proxy) {
    wsOptions = { ...wsOptions, agent: new HttpsProxyAgent(opts.proxy) };
  }

  for (let attempt = 0; attempt <= MAX_RECONNECTS; attempt++) {
    if (attempt > 0) await sleep(RECONNECT_DELAY_MS);
    if (opts.signal?.aborted) {
      reason = 'closed';
      break;
    }
    const remaining = deadline - Date.now();
    if (finished || remaining <= 2000) {
      reason = finished ? 'finished' : frames.length > 0 ? 'closed' : 'overall-timeout';
      break;
    }
    const r = await connectOnce(remaining);
    if (finished) {
      reason = 'finished';
      break;
    }
    if (r === 'has-frames') {
      // 已收到数据后连接断开：不再重连（任务大概率已完成或被服务端关闭）
      reason = 'closed';
      break;
    }
    if (r === 'timed-out') {
      // 整体超时被掐断（可能已收到部分帧），保留超时语义
      reason = 'overall-timeout';
      break;
    }
    // 零帧结束（403/静默/关闭）：退避后重连
    reason = 'error';
  }

  return { reason, frames };

  function connectOnce(budgetMs: number): Promise<'has-frames' | 'no-frames' | 'timed-out'> {
    return new Promise((resolve) => {
      const ws = new WebSocket(url, wsOptions);
      let resends = 0;
      let overallTimedOut = false;

      const settle = () => {
        // 整体超时一律标记 timed-out（无论是否收到过帧），外层统一记为 overall-timeout
        if (overallTimedOut) {
          resolve('timed-out');
        } else {
          resolve(frames.length > 0 || finished ? 'has-frames' : 'no-frames');
        }
      };

      const overallTimer = setTimeout(() => {
        overallTimedOut = true;
        ws.terminate();
      }, budgetMs);

      const armIdle = () => {
        return setTimeout(() => {
          if (resends < MAX_RESENDS) {
            resends++;
            try {
              ws.send(handshake); // 官方客户端空闲时重发握手
            } catch {
              /* 连接已断 */
            }
          } else {
            reason = 'idle-timeout';
            ws.terminate();
          }
        }, opts.idleTimeoutMs);
      };
      let idleTimer = armIdle();

      ws.on('open', () => {
        ws.send(handshake);
        clearTimeout(idleTimer);
        idleTimer = armIdle();
      });

      ws.on('message', (data) => {
        clearTimeout(idleTimer);
        idleTimer = armIdle();
        if (opts.signal?.aborted) {
          // 取消必须硬断：ws.close() 要等对端回 close 帧，itdog 不回时连接会挂很久
          ws.terminate();
          return;
        }
        let msg: Frame;
        try {
          msg = JSON.parse(data.toString()) as Frame;
        } catch {
          return; // 心跳/非 JSON 帧忽略
        }
        if (msg && typeof msg === 'object') {
          frames.push(msg);
          opts.onFrame(msg);
          if (msg.type === 'finished') {
            finished = true;
            clearTimeout(overallTimer);
            ws.close();
          }
        }
      });

      ws.on('error', () => {
        // 403 等：交由 close 统一处理
      });

      ws.on('close', () => {
        clearTimeout(overallTimer);
        clearTimeout(idleTimer);
        settle();
      });
    });
  }
}
