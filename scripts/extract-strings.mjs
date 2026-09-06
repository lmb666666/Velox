#!/usr/bin/env node
/**
 * itdog 页面 JS 混淆串解码工具（维护用）。
 *
 * 当 WS token 盐（src/config.ts 的 WS_SALT）或 guard 算法轮换时，用它从官方前端 JS
 * 中重新提取盐值/常量：
 *
 *   curl -s --compressed 'https://www.itdog.cn/frame/js/pages/icmp_ping.js?v=<页面版本号>' \
 *        -H 'User-Agent: Mozilla/5.0' -o /tmp/icmp_ping.js
 *   node scripts/extract-strings.mjs /tmp/icmp_ping.js --ws
 *
 * 输出中 "WebSocket 调用点字符串（按序拼接）" 即为 md5() 的盐参数。
 *
 * 不带 --ws 时解码并打印整个文件的所有字符串，便于核对其他常量。
 */
import fs from 'node:fs';

const file = process.argv[2];
const wsMode = process.argv.includes('--ws');
if (!file) {
  console.error('用法: node scripts/extract-strings.mjs <页面JS文件> [--ws]');
  process.exit(1);
}
const src = fs.readFileSync(file, 'utf8');

// obfuscator 固定命名模式：a数字_0x十六进制
const NAME_RE = /^a\d+_0x[0-9a-f]+$/;

function extractFn(name) {
  const start = src.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`找不到函数 ${name}`);
  let i = src.indexOf('{', start);
  let depth = 0;
  let end = -1;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') {
      depth--;
      if (depth === 0) {
        end = i + 1;
        break;
      }
    }
  }
  return src.slice(start, end);
}

// 1) 字符串数组函数（无参）
const fns = [...src.matchAll(/function (a\d+_0x[0-9a-f]+)\(([^)]*)\)/g)].map((m) => ({
  name: m[1],
  args: m[2],
}));
const arrFnDef = fns.find((f) => f.args === '');
const decFnDef = fns.find((f) => f.args.split(',').length === 2 && f.args.includes('_0x'));
if (!arrFnDef || !decFnDef) {
  console.error('未识别出字符串数组/解码器函数（混淆器结构可能已变化）');
  process.exit(1);
}

// 2) 字符串数组旋转 IIFE：(function(_0x,_0x){...}(数组函数名,0x种子))
const rotStart = src.indexOf('(function(');
const rotCallRe = new RegExp(`\\(${arrFnDef.name},(0x[0-9a-f]+)\\)\\)`);
const rotCall = rotCallRe.exec(src);
if (!rotCall) {
  console.error('未找到旋转 IIFE 结尾');
  process.exit(1);
}
const rot = src.slice(rotStart, rotCall.index + rotCall[0].length);

// 3) 生成沙箱代码
const code = `${extractFn(arrFnDef.name)}\n${rot}\n${extractFn(decFnDef.name)}\n`;

// 收集源码中的解码调用 (0x索引, 'key')
function collectPairs(text) {
  const pairs = [];
  const re = new RegExp(`_0x[0-9a-f]+\\((0x[0-9a-f]+),\\s*'([^']+)'\\)`, 'g');
  let m;
  while ((m = re.exec(text))) pairs.push([m[1], m[2]]);
  return pairs;
}

const sandboxSrc =
  code +
  `
const pairs = ${JSON.stringify(collectPairs(wsMode ? src.slice(src.indexOf('WebSocket('), src.indexOf('WebSocket(') + 1500) : src))};
const seen = new Set();
for (const [idx, key] of pairs) {
  try {
    const v = ${decFnDef.name}(Number(idx), key);
    if (typeof v === 'string' && v.length > 0 && !seen.has(v)) { seen.add(v); console.log(idx, key, JSON.stringify(v)); }
  } catch {}
}
`;

if (!wsMode) {
  fs.writeFileSync('/tmp/itdog_decode_run.mjs', sandboxSrc);
} else {
  // --ws 模式：按出现顺序打印 WebSocket( 调用点附近的解码结果，便于人工拼接盐值
  const wsSandbox =
    code +
    `
const pairs = ${JSON.stringify(collectPairs(src.slice(src.indexOf('WebSocket('), src.indexOf('WebSocket(') + 1500)))};
let buf = '';
for (const [idx, key] of pairs) {
  try {
    const v = ${decFnDef.name}(Number(idx), key);
    if (typeof v === 'string') { console.log(idx, key, JSON.stringify(v)); buf += v; }
  } catch {}
}
console.log('--- 按出现顺序拼接（剔除非片段后即盐值）:', JSON.stringify(buf));
`;
  fs.writeFileSync('/tmp/itdog_decode_run.mjs', wsSandbox);
}
await import('/tmp/itdog_decode_run.mjs');
