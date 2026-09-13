import { BASE_URL, DEFAULT_WSS_URL } from './config.js';
import { CookieJar } from './cookiejar.js';
import { solveGuardret } from './guard/solver.js';
import { updateFromHtml } from './nodes.js';
import { ProxyAgent } from 'undici';

/** 任务创建层：浏览器头伪装、guard 反爬重试、HTML 解析（task_id/wss_url/错误信息） */

export interface CreateTaskParams {
  path: string;
  referer: string;
  form: Record<string, string>;
  ua: string;
  proxy?: string;
  retry: number;
}

export interface Task {
  taskId: string;
  wssUrl: string;
  html: string;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function postForm(
  url: string,
  form: Record<string, string>,
  ua: string,
  referer: string,
  jar: CookieJar,
  proxy?: string,
): Promise<{ status: number; html: string }> {
  const body = new URLSearchParams(form).toString();
  // npm undici 的 ProxyAgent 与 Node 内置 fetch 按 Dispatcher 接口鸭子类型协作（实测可用）
  const dispatcher = proxy ? new ProxyAgent(proxy) : undefined;
  const headers: Record<string, unknown> = {
    'content-type': 'application/x-www-form-urlencoded',
    'user-agent': ua,
    'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8',
    origin: BASE_URL.replace(/\/$/, ''),
    referer,
  };
  // 空罐不发 cookie 头（itdog 后端会区分有无会话）
  const cookieHeader = jar.header();
  if (cookieHeader) headers.cookie = cookieHeader;
  const res = await fetch(url, {
    method: 'POST',
    headers: headers as never,
    body,
    // undici 的 dispatcher 选项让 fetch 走代理
    dispatcher,
  } as RequestInit);
  jar.absorb((res.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie?.());
  const html = await res.text();
  return { status: res.status, html };
}

function extractError(html: string): string | null {
  const m =
    /err_tip(?:_more)?\(\s*["']((?:[^"'\\]|\\.)*)["']/.exec(html) ??
    /<div[^>]*class="[^"]*err[^"]*"[^>]*>([^<]{4,120})</.exec(html);
  if (!m) return null;
  return m[1]
    .replace(/<[^>]+>/g, '')
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(Number.parseInt(h, 16)));
}

/**
 * 创建测速任务，返回 taskId 与 wss_url。
 * 命中 WAF（响应含 /_guard/auto.js）时自动求解 guardret 重试；可配置普通错误重试次数。
 */
export async function createTask(p: CreateTaskParams): Promise<Task> {
  const url = BASE_URL + p.path.replace(/^\//, '');
  const referer = BASE_URL + p.referer.replace(/^\//, '');
  const jar = new CookieJar();
  let lastHtml = '';
  let lastStatus = 0;
  const maxAttempts = p.retry + 4;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const { status, html } = await postForm(url, p.form, p.ua, referer, jar, p.proxy);
    if (process.env.ITDOG_DEBUG === '1') {
      console.error(`[debug] POST ${url} attempt=${attempt} status=${status} html=${html.length}B`);
      console.error(`[debug] request headers:`, JSON.stringify({ cookie: jar.header(), referer }));
    }
    lastHtml = html;
    lastStatus = status;

    const taskId = /var task_id='([^']+)'/.exec(html)?.[1];
    if (taskId) {
      updateFromHtml(html);
      return {
        taskId,
        wssUrl: /var wss_url='([^']+)'/.exec(html)?.[1] ?? DEFAULT_WSS_URL,
        html,
      };
    }

    if (html.includes('_guard/auto.js')) {
      // WAF 挑战：请求响应时已吸收 guard cookie，求解 guardret 后带上重试
      const guard = jar.get('guard');
      if (guard) {
        const guardret = solveGuardret(guard);
        if (guardret) jar.set('guardret', guardret);
        else throw new Error('WAF guard 求解失败：auto.js 快照可能已过期，请运行 `pnpm refresh-guard` 更新');
      }
      await sleep(1500);
      continue;
    }

    const err = extractError(html);
    if (err && attempt < p.retry) {
      await sleep(1000 * (attempt + 1));
      continue;
    }
    break;
  }

  const err = extractError(lastHtml);
  const title = /<title>([^<]*)<\/title>/.exec(lastHtml)?.[1] ?? '';
  throw new Error(
    `创建任务失败（HTTP ${lastStatus}）` +
      (err ? `：${err}` : '') +
      (title ? `｜页面标题：${title}` : '') +
      '｜若反复失败，可能是接口变动，请更新本工具或检查网络',
  );
}
