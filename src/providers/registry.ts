import { itdogProvider } from './itdog.js';
import type { SpeedTestProvider, ProviderId } from './types.js';

/**
 * provider 注册表 + 调度。
 * 接入新上游只需实现 SpeedTestProvider 接口并在 REGISTRY 里按优先级追加条目；
 * 调度默认按优先级自动切换。provider 可用性可通过环境变量开关控制
 * （PROVIDER_<ID>_ENABLED=0 关闭某上游）。
 */

/** 各 provider 是否启用：环境变量开关（PROVIDER_<ID>_ENABLED，0/false 关闭） */
function isEnabled(p: SpeedTestProvider): boolean {
  const key = `PROVIDER_${p.id.toUpperCase()}_ENABLED`;
  const v = process.env[key];
  if (v !== undefined && ['0', 'false'].includes(v.toLowerCase())) return false;
  return true;
}

/** 已注册 provider（按优先级降序，index 越小优先级越高）；当前内置 itdog */
export const REGISTRY: SpeedTestProvider[] = [itdogProvider].filter(isEnabled);

const byId = new Map<string, SpeedTestProvider>(REGISTRY.map((p) => [p.id, p]));

/** 是否支持自动故障切换（默认 auto 时按优先级遍历） */
export function getProvider(id: string | undefined): SpeedTestProvider | null {
  if (!id || id === 'auto') return REGISTRY[0] ?? null;
  return byId.get(id) ?? null;
}

/** 按优先级顺序返回可用 provider 列表（故障切换时从前往后遍历）。
 *  - auto/未指定：返回所有已启用 provider。
 *  - 指定某 id：仅返回该 provider；若未启用则返回 []（便于上层明确提示"不可用"）。 */
export function providerChain(requestedId: string | undefined): SpeedTestProvider[] {
  if (!requestedId || requestedId === 'auto') return REGISTRY;
  return byId.has(requestedId) ? [byId.get(requestedId)!] : [];
}

/** 判断指定 provider 是否已启用且可调度 */
export function isProviderAvailable(id: string | undefined): boolean {
  if (!id || id === 'auto') return REGISTRY.length > 0;
  return REGISTRY.some((p) => p.id === id);
}

export function listProviders(): Array<{ id: ProviderId; name: string; supportedModes: string[] }> {
  return REGISTRY.map((p) => ({ id: p.id, name: p.name, supportedModes: p.supportedModes }));
}
