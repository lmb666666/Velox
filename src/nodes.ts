import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NODES_CACHE_FILE } from './config.js';
import type { NodeInfo } from './types.js';

/** 节点注册表：内置静态表兜底 + 运行时从 itdog 页面 HTML 刷新（缓存到用户目录） */

type Registry = Record<string, NodeInfo[]>;

let registry: Registry | null = null;

function staticNodesPath(): string {
  return resolveAsset('nodes.json');
}

/** 兼容 dist/ 与 tsx 直跑两种布局，向上逐级查找 assets/ 目录 */
export function resolveAsset(name: string): string {
  if (process.env.ITDOG_ASSETS_DIR) return path.resolve(process.env.ITDOG_ASSETS_DIR, name);
  const here = path.dirname(fileURLToPath(import.meta.url));
  let dir = here;
  for (let i = 0; i < 4; i++) {
    const candidate = path.join(dir, 'assets', name);
    try {
      fs.accessSync(candidate);
      return candidate;
    } catch {
      dir = path.dirname(dir);
    }
  }
  return path.join(path.dirname(here), 'assets', name);
}

function cacheFile(): string {
  return path.join(os.homedir(), '.cache', NODES_CACHE_FILE);
}

function registryLoad(): Registry {
  if (registry) return registry;
  // 优先用较新的本地缓存，其次用随仓库分发的静态表
  for (const p of [cacheFile(), staticNodesPath()]) {
    try {
      const data = JSON.parse(fs.readFileSync(p, 'utf8')) as Registry;
      if (data && Object.keys(data).length > 0) {
        registry = data;
        return registry;
      }
    } catch {
      /* 尝试下一个来源 */
    }
  }
  registry = {};
  return registry;
}

export function allNodes(): NodeInfo[] {
  const reg = registryLoad();
  return Object.values(reg).flat();
}

export function categories(): string[] {
  return Object.keys(registryLoad());
}

/** 从任务/页面 HTML 里的 <optgroup>/<option> 更新节点表并写缓存 */
export function updateFromHtml(html: string): number {
  if (!html || !html.includes('<option')) return 0;
  const fresh: Registry = {};
  const groupRe = /<optgroup label="([^"]+)">([\s\S]*?)<\/optgroup>/g;
  let group: RegExpExecArray | null;
  let total = 0;
  while ((group = groupRe.exec(html))) {
    const nodes: NodeInfo[] = [];
    const optRe = /<option value="([^"]+)"[^>]*>([^<]+)<\/option>/g;
    let opt: RegExpExecArray | null;
    while ((opt = optRe.exec(group[2]))) {
      nodes.push({ id: opt[1], name: opt[2].trim(), category: group[1] });
      total++;
    }
    if (nodes.length > 0) fresh[group[1]] = nodes;
  }
  if (total > 0) {
    registry = fresh;
    try {
      const file = cacheFile();
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, JSON.stringify(fresh));
    } catch {
      /* 缓存写失败不影响主流程 */
    }
  }
  return total;
}

/**
 * 解析 --nodes 选择器：
 *  all / 空              → 全部
 *  telecom|unicom|mobile|overseas（可逗号组合，也接受中文分组名）
 *  id,id,...             → 按节点 ID（随机串）
 *  关键词                 → 节点名子串匹配，如 上海、济南
 */
export function selectNodes(spec: string | undefined): NodeInfo[] {
  const nodes = allNodes();
  const s = (spec ?? 'all').trim();
  if (s === '' || s.toLowerCase() === 'all' || s === '全部') return nodes;

  const alias: Record<string, string> = {
    telecom: '中国电信', 电信: '中国电信',
    unicom: '中国联通', 联通: '中国联通',
    mobile: '中国移动', 移动: '中国移动',
    overseas: '港澳台、海外', 海外: '港澳台、海外',境外: '港澳台、海外',
  };
  const parts = s.split(',').map((x) => x.trim()).filter(Boolean);
  const picked = new Map<string, NodeInfo>();
  for (const part of parts) {
    const cat = alias[part.toLowerCase()] ?? alias[part];
    if (cat) {
      for (const n of registryLoad()[cat] ?? []) picked.set(n.id, n);
      continue;
    }
    const byId = nodes.find((n) => n.id === part);
    if (byId) {
      picked.set(byId.id, byId);
      continue;
    }
    for (const n of nodes) {
      if (n.name.includes(part) || n.name.replace(/\s+/g, '').includes(part)) picked.set(n.id, n);
    }
  }
  return [...picked.values()];
}

/** 节点选择器 → 单目标模式的 line 表单值（1电信 2联通 3移动 5境外；空=全部） */
export function specToLineValues(spec: string | undefined): string {
  const s = (spec ?? 'all').trim();
  if (s === '' || s.toLowerCase() === 'all' || s === '全部') return '';
  const codes: number[] = [];
  for (const part of s.split(',').map((x) => x.trim().toLowerCase())) {
    if (part === 'telecom' || part === '电信') codes.push(1);
    else if (part === 'unicom' || part === '联通') codes.push(2);
    else if (part === 'mobile' || part === '移动') codes.push(3);
    else if (part === 'overseas' || part === '海外' || part === '境外') codes.push(5);
  }
  return [...new Set(codes)].sort().join(',');
}

/** 从 itdog batch_ping 页面抓取最新节点表并写入缓存，返回 {updated, counts} */
export async function refreshNodesFromSite(ua: string): Promise<{ updated: number; counts: Record<string, number> }> {
  const res = await fetch('https://www.itdog.cn/batch_ping/', {
    headers: { 'user-agent': ua, 'accept-language': 'zh-CN,zh;q=0.9' },
  });
  const html = await res.text();
  const updated = updateFromHtml(html);
  const counts: Record<string, number> = {};
  for (const n of allNodes()) counts[n.category] = (counts[n.category] ?? 0) + 1;
  return { updated, counts };
}
