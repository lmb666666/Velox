import { describe, it, expect } from 'vitest';
// 直接引用编译产物（dist/），与 core.test.ts 同一取舍：验证真正被运行/发布的代码
import fs from 'node:fs';
import { providerChain, getProvider, isProviderAvailable, listProviders } from '../../dist/providers/registry.js';
import { itdogProvider } from '../../dist/providers/itdog.js';
import { runTest } from '../../dist/service.js';
import { allNodes, specToLineValues } from '../../dist/nodes.js';
import type { Frame } from '../../dist/types.js';

/** 锁住 provider 调度与节点选择的关键逻辑（当前内置 itdog 单上游） */

describe('registry：provider 注册表与调度链', () => {
  it('auto/未指定 返回 itdog 上游链', () => {
    expect(providerChain('auto').map((p) => p.id)).toEqual(['itdog']);
    expect(providerChain(undefined).map((p) => p.id)).toEqual(['itdog']);
  });

  it('指定 itdog 返回单个；未知 id 返回空链', () => {
    expect(providerChain('itdog').map((p) => p.id)).toEqual(['itdog']);
    expect(providerChain('no-such-provider')).toEqual([]);
  });

  it('getProvider / isProviderAvailable / listProviders 口径一致', () => {
    expect(getProvider('auto')?.id).toBe('itdog');
    expect(getProvider('itdog')?.id).toBe('itdog');
    expect(getProvider('nope')).toBeNull();
    expect(isProviderAvailable('auto')).toBe(true);
    expect(isProviderAvailable('itdog')).toBe(true);
    expect(isProviderAvailable('nope')).toBe(false);
    expect(listProviders()).toEqual([
      { id: 'itdog', name: 'itdog.cn', supportedModes: itdogProvider.supportedModes },
    ]);
  });

  it('itdog 声明支持全部 7 种模式', () => {
    expect(itdogProvider.supportedModes).toEqual([
      'ping', 'tcping', 'http', 'dns', 'traceroute', 'batch-ping', 'batch-tcping',
    ]);
  });
});

describe('itdog provider：帧归一化（数字编码 → 字符串口径）', () => {
  const frame = (over: Partial<Frame> = {}): Frame => ({
    node_id: 'a',
    name: '上海10 - 电信',
    line: 1,
    province: 2,
    region: 1,
    ip: '1.1.1.1',
    result: 8,
    type: 'success',
    ...over,
  });

  it('成功帧 → 电信/上海/华东 + 延迟', () => {
    const s = itdogProvider.normalizeFrame(frame(), 'ping');
    expect(s.ok).toBe(true);
    expect(s.latencyMs).toBe(8);
    expect(s.carrier).toBe('电信');
    expect(s.province).toBe('上海');
    expect(s.region).toBe('华东');
  });

  it('DNS 解析失败帧（ip=Not Found）→ 标记失败', () => {
    const s = itdogProvider.normalizeFrame(frame({ ip: 'Not Found', result: undefined }), 'ping');
    expect(s.ok).toBe(false);
    expect(s.failReason).toBe('DNS 解析失败');
  });

  it('http 帧秒转毫秒', () => {
    const s = itdogProvider.normalizeFrame(
      frame({ type: 'success', http_code: 200, all_time: 0.12, result: undefined }),
      'http',
    );
    expect(s.ok).toBe(true);
    expect(s.detail?.allTime).toBe(120);
  });
});

describe('nodes：线路编码解析与快照完整性', () => {
  it('specToLineValues 接受名称与数字编码（downgradeNotice 产出的编码必须能解析回来）', () => {
    expect(specToLineValues('telecom,unicom')).toBe('1,2');
    expect(specToLineValues('1,2')).toBe('1,2');
    expect(specToLineValues('电信,5')).toBe('1,5');
    expect(specToLineValues('3')).toBe('3');
    expect(specToLineValues('all')).toBe('');
    expect(specToLineValues('')).toBe('');
  });

  it('静态快照每个节点必须带 category（历史缺陷：分组键在外层、节点内缺失）', () => {
    const reg = JSON.parse(fs.readFileSync(new URL('../../assets/nodes.json', import.meta.url), 'utf8')) as Record<string, Array<{ id: string; category?: string }>>;
    const nodes = Object.values(reg).flat();
    expect(nodes.length).toBeGreaterThan(0);
    expect(nodes.every((n) => typeof n.category === 'string' && n.category.length > 0)).toBe(true);
  });

  it('allNodes() 展平后 category 非空（含旧快照兜底注入）', () => {
    const nodes = allNodes();
    expect(nodes.length).toBeGreaterThan(0);
    expect(nodes.every((n) => typeof n.category === 'string' && n.category.length > 0)).toBe(true);
  });
});

describe('itdog：纯线路选择器判定（单目标精确路由的分流依据）', () => {
  it('纯线路 spec 返回 true', () => {
    expect(itdogProvider.isPureLineSpec('all')).toBe(true);
    expect(itdogProvider.isPureLineSpec('telecom,unicom')).toBe(true);
    expect(itdogProvider.isPureLineSpec('电信')).toBe(true);
    expect(itdogProvider.isPureLineSpec('')).toBe(true);
    expect(itdogProvider.isPureLineSpec(undefined)).toBe(true);
  });

  it('节点 ID / 关键词 spec 返回 false（可解析为精确节点）', () => {
    expect(itdogProvider.isPureLineSpec('zefoplpmut7nso0a,vt91d6dw1cserjjx')).toBe(false);
    expect(itdogProvider.isPureLineSpec('北京')).toBe(false);
    expect(itdogProvider.isPureLineSpec('telecom,北京')).toBe(false);
  });
});

describe('service：上游选择校验（不发网络请求即报错）', () => {
  it('手动指定未注册的上游报「不可用」', async () => {
    await expect(
      runTest({ mode: 'ping', targets: ['example.com'], provider: 'tcptest' }),
    ).rejects.toThrow(/不可用/);
    await expect(
      runTest({ mode: 'ping', targets: ['example.com'], provider: 'no-such' }),
    ).rejects.toThrow(/不可用/);
  });

  it('非纯线路选择器匹配不到任何节点时报错，而非静默测全部节点（精确与降级路径一致）', async () => {
    // ping 精确路径：选了节点但一个都没匹配到
    await expect(
      runTest({ mode: 'ping', targets: ['example.com'], nodes: 'no-such-node-xyz' }),
    ).rejects.toThrow(/未匹配到任何节点/);
    // http 降级路径（http 无法精确，回退线路过滤；匹配不到同样应报错）
    await expect(
      runTest({ mode: 'http', targets: ['example.com'], nodes: 'no-such-node-xyz' }),
    ).rejects.toThrow(/未匹配到任何节点/);
  });
});
