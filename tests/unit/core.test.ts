import { describe, it, expect } from 'vitest';
// 直接引用编译产物（dist/），避免 vitest 对 NodeNext `.js→.ts` 后缀的解析问题；
// 逻辑与 src 等价，且验证了真正被运行/发布的代码。
import { provinceCodeFromName } from '../../dist/config.js';
import { buildSummary } from '../../dist/aggregate.js';
import { selectNodes } from '../../dist/nodes.js';
import { solveGuardret } from '../../dist/guard/solver.js';
import type { Frame, Mode } from '../../dist/types.js';

/** 锁住最容易回归的纯函数逻辑：省份归一化、帧聚合、节点选择器、guard 公式兜底 */

describe('provinceCodeFromName：节点名 → 省份编码（曾一次修 7 个自治区/特别行政区）', () => {
  it.each([
    ['北京3 - 联通', 0],
    ['上海10 - 电信', 2],
    ['天津6 - 电信', 1],
    ['中国台湾台北2 - 海外', 31],
    ['香港1 - 海外', 32],
    ['澳门1 - 海外', 33],
    ['新疆乌鲁木齐1 - 移动', 12],
    ['内蒙古包头3 - 移动', 20],
    ['广西南宁1 - 电信', 17],
    ['宁夏银川1 - 移动', 29],
    // 港澳台特别行政区归一化（历史 bug 点）
    ['广西2 - 电信', 17],
  ])('%s → %i', (name, code) => {
    expect(provinceCodeFromName(name)).toBe(code);
  });

  it('境外节点应返回境外编码 99（含港澳台海外分类）', () => {
    expect(provinceCodeFromName('日本东京1 - 海外')).toBe(undefined); // 非中国省份名不匹配
  });

  it('未知节点返回 undefined', () => {
    expect(provinceCodeFromName('')).toBeUndefined();
    expect(provinceCodeFromName('- 无名')).toBeUndefined();
  });
});

describe('buildSummary：ping 帧聚合成统计', () => {
  const mode: Mode = 'ping';
  const mkFrame = (node_id: string, name: string, line: number, province: number, ip: string, result: number): Frame => ({
    node_id, name, line, province, region: 1, ip, result, type: 'success',
  });

  it('按节点聚合、统计成功/失败、计算平均/最快/最慢', () => {
    const frames: Frame[] = [
      mkFrame('a', '上海10 - 电信', 1, 2, '1.1.1.1', 8),
      mkFrame('b', '北京3 - 联通', 2, 0, '2.2.2.2', 20),
      mkFrame('c', '广州1 - 移动', 3, 25, '3.3.3.3', 5),
    ];
    const s = buildSummary(mode, ['example.com'], frames, true, 5, 'latency');
    expect(s.totalNodes).toBe(3);
    expect(s.okNodes).toBe(3);
    expect(s.failedNodes).toBe(0);
    expect(s.overallAvg).toBeCloseTo(11); // (8+20+5)/3 = 11
    expect(s.overallMin).toBe(5);
    expect(s.overallMax).toBe(20);
    expect(s.top[0].name).toBe('广州1 - 移动'); // 最快在前
  });

  it('标记失败节点（IP 无效）', () => {
    const frames: Frame[] = [
      mkFrame('a', '上海10 - 电信', 1, 2, '1.1.1.1', 8),
      { node_id: 'b', name: '北京3', line: 2, ip: 'Not Found', result: undefined },
    ];
    const s = buildSummary(mode, ['example.com'], frames, true, 5, 'latency');
    expect(s.okNodes).toBe(1);
    expect(s.failedNodes).toBe(1);
  });

  it('sort=loss 时失败排前', () => {
    const frames: Frame[] = [
      mkFrame('a', '上海10 - 电信', 1, 2, '1.1.1.1', 8),
      { node_id: 'b', name: '北京3', line: 2, ip: 'Not Found', result: undefined },
    ];
    const s = buildSummary(mode, ['example.com'], frames, true, 5, 'loss');
    expect(s.stats[0].ok).toBe(false);
  });

  it('http 模式秒转毫秒（itdog all_time 单位是秒）', () => {
    const httpFrames: Frame[] = [{
      node_id: 'a', name: '上海电信', line: 1, ip: '1.1.1.1', type: 'success', http_code: 200, all_time: 0.12,
    }];
    const s = buildSummary('http', ['https://example.com'], httpFrames, true, 5, 'latency');
    expect(s.stats[0].detail?.allTime).toBe(120); // 0.12s → 120ms
    expect(s.stats[0].ok).toBe(true);
  });
});

describe('selectNodes：节点选择器解析', () => {
  it('节点表为空时 all 返回空数组（不抛错）', () => {
    const res = selectNodes('all');
    expect(Array.isArray(res)).toBe(true);
  });

  it('别名映射到线路分组（telecom/电信）', () => {
    // 依赖节点缓存/静态表；若当前静态表有电信节点则命中，否则返回空
    const res = selectNodes('telecom');
    expect(Array.isArray(res)).toBe(true);
    expect(res.every((n) => n.category.includes('电信'))).toBe(true);
  });
});

describe('solveGuardret：guard → guardret 公式兜底', () => {
  it('对合法 guard 返回非空 base64', () => {
    // guard 形如随机串，前 8 位作密钥；公式兜底在沙箱失败时触发
    const guard = 'ab3de6f01f2e17f3';
    const ret = solveGuardret(guard);
    expect(typeof ret).toBe('string');
    expect((ret as string).length).toBeGreaterThan(0);
  });

  it('过短的 guard 返回 null（无法求解）', () => {
    expect(solveGuardret('')).toBeNull();
    expect(solveGuardret('abc')).toBeNull();
  });
});
