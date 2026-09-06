import vm from 'node:vm';
import fs from 'node:fs';
import { GUARD_XOR_SUFFIX } from '../config.js';
import { resolveAsset } from '../nodes.js';

/**
 * guard → guardret 求解，双层策略：
 * 1. 沙箱执行 itdog 官方 /_guard/auto.js 快照（算法轮换时自适应，不依赖具体函数名，
 *    通过模拟 document.cookie 捕获脚本写回的 guardret）。
 * 2. 失败时退回公式：guard 前 8 位作密钥，第 12 位后的数字 ×2+16，
 *    与「密钥+盐」逐字符异或后 base64。
 */

let cachedScript: vm.Script | null = null;
let cachedSource: string | null = null;

function loadGuardJs(): string {
  if (cachedSource !== null) return cachedSource;
  const candidates: string[] = [];
  if (process.env.ITDOG_GUARD_JS) candidates.push(process.env.ITDOG_GUARD_JS);
  candidates.push(resolveAsset('guard-auto.js'));
  for (const p of candidates) {
    try {
      cachedSource = fs.readFileSync(p, 'utf8');
      return cachedSource;
    } catch {
      /* 尝试下一个候选路径 */
    }
  }
  throw new Error(
    '找不到 guard-auto.js 快照。请运行 `pnpm refresh-guard` 重新抓取，' +
      '或用环境变量 ITDOG_GUARD_JS 指定文件路径。',
  );
}

function compile(): vm.Script {
  if (!cachedScript) {
    cachedScript = new vm.Script(loadGuardJs(), { filename: 'guard-auto.js' });
  }
  return cachedScript;
}

/** 在 vm 沙箱里跑官方脚本：预置 guard cookie，脚本自己算好并写回 guardret */
function solveBySandbox(guard: string): string | null {
  const jar = new Map<string, string>([['guard', guard]]);
  const sandbox: Record<string, unknown> = {};
  sandbox.window = sandbox;
  sandbox.self = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.location = { reload: () => {}, href: 'https://www.itdog.cn/', protocol: 'https:' };
  sandbox.navigator = {
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0',
    cookieEnabled: true,
    language: 'zh-CN',
  };
  sandbox.document = {
    get cookie() {
      return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
    },
    set cookie(v: string) {
      const pair = String(v).split(';')[0];
      const eq = pair.indexOf('=');
      if (eq > 0) jar.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
    },
  };
  sandbox.btoa = (s: string) => Buffer.from(s, 'binary').toString('base64');
  sandbox.atob = (s: string) => Buffer.from(s, 'base64').toString('binary');
  sandbox.setTimeout = () => 0;
  sandbox.clearTimeout = () => {};
  sandbox.console = { log: () => {}, warn: () => {}, error: () => {} };

  try {
    const context = vm.createContext(sandbox);
    compile().runInContext(context, { timeout: 5000 });
  } catch {
    return null;
  }
  const ret = jar.get('guardret');
  return ret && ret.length > 0 ? ret : null;
}

/** 公式兜底（2024-2026 多个开源实现验证一致的算法） */
function solveByFormula(guard: string): string | null {
  if (!guard || guard.length < 8) return null;
  const key = guard.slice(0, 8);
  const num = Number.parseInt(guard.slice(12), 10);
  const value = String((Number.isNaN(num) ? 0 : num) * 2 + 16);
  const fullKey = key + GUARD_XOR_SUFFIX;
  let out = '';
  for (let i = 0; i < value.length; i++) {
    out += String.fromCharCode(value.charCodeAt(i) ^ fullKey.charCodeAt(i % fullKey.length));
  }
  return Buffer.from(out, 'binary').toString('base64');
}

export function solveGuardret(guard: string): string | null {
  return solveBySandbox(guard) ?? solveByFormula(guard);
}
