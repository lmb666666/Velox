#!/usr/bin/env node
/**
 * Velox 单文件可执行打包：
 *   1. esbuild 将 src/cli.ts（含全部运行时依赖）bundle 为单文件 CJS
 *   2. @yao-pkg/pkg 按 target 产出各平台可执行文件（含 Node 运行时，无外部依赖）
 *   3. 组装发布目录：可执行文件 + assets/（节点表/WAF 快照）+ web/dist/（控制台前端）
 *      —— 旁挂三件套，resolveAsset/resolveWebDist 已支持 exe 同目录查找
 *   4. tar.gz 打包到 build/release/
 *
 * 用法：node scripts/build-exe.mjs [target ...]   # 缺省构建全部 5 个平台
 *       node scripts/build-exe.mjs node22-linux-x64
 */
import { build } from 'esbuild';
import { exec as pkgExec } from '@yao-pkg/pkg';
import { cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const chdir = (p) => path.join(root, p);
const { version } = (await import(chdir('package.json'), { with: { type: 'json' } })).default;

/** 目标平台 → 输出文件名/压缩包名 */
const TARGETS = [
  { target: 'node22-win-x64', os: 'win', arch: 'x64', exe: 'velox.exe' },
  { target: 'node22-linux-x64', os: 'linux', arch: 'x64', exe: 'velox' },
  { target: 'node22-linux-arm64', os: 'linux', arch: 'arm64', exe: 'velox' },
  { target: 'node22-macos-x64', os: 'macos', arch: 'x64', exe: 'velox' },
  { target: 'node22-macos-arm64', os: 'macos', arch: 'arm64', exe: 'velox' },
];
const wanted = process.argv.slice(2);
const targets = wanted.length > 0 ? TARGETS.filter((t) => wanted.includes(t.target)) : TARGETS;
if (targets.length === 0) {
  console.error(`未知 target：${wanted.join(', ')}\n可选：${TARGETS.map((t) => t.target).join(', ')}`);
  process.exit(1);
}

const log = (m) => console.log(`[build-exe] ${m}`);

// ── 1. esbuild 打包为单文件 CJS（含全部运行时依赖；node 内置模块除外）──
log('esbuild bundle → build/exe/cli.cjs');
await build({
  entryPoints: [chdir('src/cli.ts')],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node18',
  outfile: chdir('build/exe/cli.cjs'),
  sourcemap: false,
  minify: false,
  // ws 的两个可选原生加速依赖：运行时缺省走纯 JS 回退
  external: ['bufferutil', 'utf-8-validate'],
  // CJS 输出下 import.meta 不可用（undefined）：让 esbuild 降级为 __filename shim，
  // 使 resolveAsset/resolveWebDist 的目录上溯在 pkg 快照路径下语义正确
  supported: { 'import-meta': false },
});

// ── 2/3. 逐平台 pkg 出可执行文件并组装发布目录 ──
const releaseDir = chdir('build/release');
rmSync(releaseDir, { recursive: true, force: true });

for (const t of targets) {
  const name = `velox-${version}-${t.os}-${t.arch}`;
  const dir = path.join(releaseDir, name);
  mkdirSync(dir, { recursive: true });
  log(`pkg ${t.target} → ${name}/`);

  await pkgExec([
    chdir('build/exe/cli.cjs'),
    '--compress', 'GZip',
    '--target', t.target,
    '--output', path.join(dir, t.exe),
    // 个别平台 V8 bytecode 生成可能失败（EPIPE 等）：显式允许回退为纯源码，保证产物可用
    '--fallback-to-source',
  ]);

  // 旁挂资源：exe 同目录放 assets/ 与 web/dist/
  cpSync(chdir('assets'), path.join(dir, 'assets'), { recursive: true });
  cpSync(chdir('web/dist'), path.join(dir, 'web', 'dist'), { recursive: true });
  writeFileSync(
    path.join(dir, 'README.txt'),
    [
      `Velox v${version}（${t.os}-${t.arch}）—— 多节点测速与 IP/CDN 优选`,
      '',
      `${t.exe} serve                 启动 Web 控制台（Windows 双击 ${t.exe} 默认启动并打开浏览器）`,
      `${t.exe} ping example.com      CLI 测速（ping/tcping/http/dns/traceroute/batch-*）`,
      `${t.exe} --help                完整命令参考`,
      '',
      '说明：',
      '- assets/ 与 web/dist/ 需与本文件同目录存放（本包已内置）',
      '- 节点表缓存与历史写入 ~/.cache/itdog-cli/',
      '- 非官方接口工具，仅供学习与个人测速，请控制频率',
    ].join('\n'),
  );

  // tar.gz（Windows 10+ 自带 bsdtar 可解）
  const tar = spawnSync('tar', ['-czf', path.join(releaseDir, `${name}.tar.gz`), '-C', releaseDir, name], { stdio: 'inherit' });
  if (tar.status !== 0) throw new Error(`tar 失败：${name}`);
  log(`完成 ${name}.tar.gz`);
}

log(`全部完成 → build/release/（${targets.length} 个平台）`);
