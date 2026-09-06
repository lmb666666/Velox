#!/usr/bin/env node
/**
 * 重新抓取 itdog 官方 /_guard/auto.js 快照（WAF 算法轮换时的自救脚本）。
 * 用法: pnpm refresh-guard
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0';
const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.resolve(here, '../assets/guard-auto.js');

const res = await fetch('https://www.itdog.cn/_guard/auto.js', {
  headers: { 'user-agent': UA, referer: 'https://www.itdog.cn/ping/', 'accept-language': 'zh-CN,zh;q=0.9' },
});
if (!res.ok) {
  console.error(`抓取失败: HTTP ${res.status}`);
  process.exit(1);
}
const body = await res.text();
if (body.length < 500 || !body.includes('function')) {
  console.error(`抓取内容异常（${body.length} 字节），未写入`);
  process.exit(1);
}
fs.writeFileSync(out, body);
console.log(`已更新 ${out}（${body.length} 字节）`);
