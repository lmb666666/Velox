/**
 * 运行时资源占位模块：
 *  - 普通 tsc 构建：两个表为空（资源走文件系统：web/dist/ 与 assets/）
 *  - pkg 单文件打包：scripts/build-exe.mjs 通过 esbuild 虚拟模块把
 *    web/dist/** 与 assets/{nodes.json,guard-auto.js} 的内容注入本模块，
 *    运行时直接从内存读取，绕开 pkg 快照文件系统在 Windows 上的兼容性问题
 */
export const WEB_ASSETS: Record<string, string> = {}; // 路径（/index.html 形式）→ base64
export const RUNTIME_FILES: Record<string, string> = {}; // 文件名 → utf8 内容
export const HAS_EMBEDDED_ASSETS = false;
