import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * 当前编译产物所在目录（兼容三种运行形态）：
 *  - tsc ESM 产物：import.meta.url 为标准 file:// URL
 *  - esbuild CJS 打包（supported.import-meta=false）：import.meta.url 被 shim 为
 *    __filename（纯路径，非 file:// URL）
 *  - pkg 单文件运行：快照路径无法命中旁挂资源，改用 exe 所在目录
 */
export function selfDir(): string {
  try {
    const url = (import.meta as unknown as { url?: string }).url;
    if (typeof url === 'string' && url.startsWith('file:')) {
      return path.dirname(fileURLToPath(url));
    }
    if (typeof url === 'string' && url.startsWith('/')) {
      return path.dirname(url); // esbuild CJS shim：__filename 纯路径
    }
  } catch {
    /* import.meta 不可用时走下方兜底 */
  }
  if ((process as unknown as { pkg?: unknown }).pkg) {
    return path.dirname(process.execPath);
  }
  const argv1 = process.argv[1];
  return argv1 ? path.dirname(path.resolve(argv1)) : process.cwd();
}

/** 是否运行于 pkg 单文件可执行内 */
export function isPkgRuntime(): boolean {
  return (process as unknown as { pkg?: unknown }).pkg !== undefined;
}
