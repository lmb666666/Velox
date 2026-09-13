#!/usr/bin/env node
/**
 * Velox 单文件可执行打包：
 *   1. esbuild 将 src/cli.ts（含全部运行时依赖）bundle 为单文件 CJS
 *   2. @yao-pkg/pkg 按 target 产出各平台可执行文件（含 Node 运行时，无外部依赖）
 *   3. assets/（节点表/WAF 快照）与 web/dist/（控制台前端）通过 --assets 内嵌进
 *      快照虚拟文件系统（/snapshot/assets、/snapshot/web/dist），resolveAsset/
 *      resolveWebDist 的目录上溯可直接命中 —— 产物为**单个裸可执行文件**
 *
 * 用法：node scripts/build-exe.mjs [target ...]   # 缺省构建全部平台
 *       node scripts/build-exe.mjs node22-linux-x64
 */
import { build } from 'esbuild';
import { exec as pkgExec } from '@yao-pkg/pkg';
import { mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const chdir = (p) => path.join(root, p);
const { version } = (await import(chdir('package.json'), { with: { type: 'json' } })).default;

/** 目标平台 → 输出文件名。
 *  macOS 暂不下发：未签名产物会被 Gatekeeper 拦截（需 Apple 开发者证书才能根除），
 *  且缺少真机验证。恢复方法：在数组中加回
 *    { target: 'node22-macos-x64',   os: 'macos', arch: 'x64',   exe: 'velox' },
 *    { target: 'node22-macos-arm64', os: 'macos', arch: 'arm64', exe: 'velox' },
 *  并在 release.yml 恢复 ldid 安装步骤（ad-hoc 签名）。 */
const TARGETS = [
  { target: 'node22-win-x64', os: 'win', arch: 'x64', exe: 'velox.exe' },
  { target: 'node22-linux-x64', os: 'linux', arch: 'x64', exe: 'velox' },
  { target: 'node22-linux-arm64', os: 'linux', arch: 'arm64', exe: 'velox' },
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

// ── 2. 逐平台 pkg 出单文件可执行（assets 与 web/dist 内嵌进快照）──
const releaseDir = chdir('build/release');
rmSync(releaseDir, { recursive: true, force: true });
mkdirSync(releaseDir, { recursive: true });

for (const t of targets) {
  const ext = t.exe.includes('.') ? t.exe.slice(t.exe.lastIndexOf('.')) : '';
  const out = path.join(releaseDir, `velox-${version}-${t.os}-${t.arch}${ext}`);
  log(`pkg ${t.target} → ${path.basename(out)}`);

  await pkgExec([
    chdir('build/exe/cli.cjs'),
    '--compress', 'GZip',
    '--target', t.target,
    '--output', out,
    // 禁用 V8 bytecode：bytecode 与 V8 版本强耦合，交叉编译时目标端会报
    // "V8 rejected the bytecode cache"。纯源码内嵌需同时声明全部包为 public
    // （否则依赖被标记为 bytecode-only，与 --no-bytecode 冲突报 "no source"）
    '--no-bytecode',
    '--public',
    '--public-packages', '*',
    // 内嵌资源在 package.json 的 pkg.assets 中配置（assets/**、web/dist/**），
    // 快照内路径为 /snapshot/assets 与 /snapshot/web/dist，落在资源解析的上溯范围内
  ]);
  log(`完成 ${path.basename(out)}（单文件）`);
}

log(`全部完成 → build/release/（${targets.length} 个平台，单文件）`);
