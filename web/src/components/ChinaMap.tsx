import { useMemo, useState } from 'react';
import { geoConicEqualArea, geoPath } from 'd3-geo';
import chinaData from '@/data/china-provinces.json';
import type { NodeStat } from '@/lib/api';
import { cn } from '@/lib/utils';

/**
 * 中国地图可视化（itdog 风格）：按省份聚合节点延迟并着色。
 * 省界数据：阿里云 DataV.GeoAtlas（scripts/fetch-china-geo.mjs 生成/简化）。
 */

type GeoFeature = {
  type: 'Feature';
  properties: { name: string; adcode: string | number };
  geometry: { type: string; coordinates: unknown };
};

const WIDTH = 760;
const HEIGHT = 480;

const FEATURES = (chinaData as { features: GeoFeature[] }).features;
const PROVINCE_FEATURES = FEATURES.filter((f) => f.properties.adcode !== '100000_JD');
const JD_FEATURE = FEATURES.find((f) => f.properties.adcode === '100000_JD');

function normProvince(name: string): string {
  return name.replace(/(维吾尔|壮族|回族|特别行政|自治|省|市)/g, '');
}

// 投影：Albers 等积圆锥（中国标准），主图不含南海要素，避免撑爆视野
const projection = geoConicEqualArea()
  .parallels([25, 47])
  .rotate([-105, 0])
  .fitSize([WIDTH, HEIGHT], { type: 'FeatureCollection', features: PROVINCE_FEATURES } as never);
const pathGen = geoPath(projection);

const INSET_W = 120;
const INSET_H = 150;
const jdProjection = JD_FEATURE
  ? geoConicEqualArea().parallels([25, 47]).rotate([-105, 0]).fitSize([INSET_W - 12, INSET_H - 12], JD_FEATURE as never)
  : null;
const jdPathGen = jdProjection ? geoPath(jdProjection) : null;

export interface ProvinceAgg {
  province: string;
  total: number;
  ok: number;
  avg?: number;
  nodes: NodeStat[];
}

function fillColor(agg: ProvinceAgg | undefined): string {
  if (!agg || agg.total === 0) return 'hsl(240 5% 78%)';
  if (agg.ok === 0) return '#ff5c5c';
  const avg = agg.avg!;
  if (avg <= 50) return '#00e5c7';   // 优
  if (avg <= 150) return '#7c9fff';  // 良
  if (avg <= 300) return '#ffb020';  // 中
  return '#ff5c5c';                  // 差
}

const LEGEND = [
  { label: '优 ≤50ms', color: '#00e5c7' },
  { label: '良 ≤150ms', color: '#7c9fff' },
  { label: '中 ≤300ms', color: '#ffb020' },
  { label: '差 >300ms', color: '#ff5c5c' },
  { label: '无数据', color: 'hsl(240 5% 78%)' },
];

export function ChinaMap({
  stats,
  filter,
  onFilterChange,
}: {
  stats: NodeStat[];
  filter: string | null;
  onFilterChange: (province: string | null) => void;
}) {
  const [tooltip, setTooltip] = useState<{ x: number; y: number; w: number; agg: ProvinceAgg } | null>(null);

  const byProvince = useMemo(() => {
    const map = new Map<string, ProvinceAgg>();
    for (const s of stats) {
      if (!s.province || s.province === '未知' || s.province === '境外') continue;
      const agg = map.get(s.province) ?? { province: s.province, total: 0, ok: 0, nodes: [] };
      agg.total++;
      if (s.ok) {
        agg.ok++;
        agg.nodes.push(s);
      }
      map.set(s.province, agg);
    }
    for (const agg of map.values()) {
      const lats = agg.nodes.map((n) => n.latencyMs!).filter((v) => Number.isFinite(v));
      agg.avg = lats.length ? Math.round((lats.reduce((a, b) => a + b, 0) / lats.length) * 10) / 10 : undefined;
    }
    return map;
  }, [stats]);

  const overseas = useMemo(() => stats.filter((s) => s.province === '境外'), [stats]);
  const overseasAvg = (() => {
    const lats = overseas.map((s) => s.latencyMs!).filter((v) => Number.isFinite(v));
    return lats.length ? Math.round((lats.reduce((a, b) => a + b, 0) / lats.length) * 10) / 10 : undefined;
  })();
  const overseasOk = overseas.filter((s) => s.ok).length;

  const hasProvinceData = byProvince.size > 0;
  if (!hasProvinceData) {
    return (
      <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
        当前结果不含省份信息，无法绘制地图
      </div>
    );
  }

  const paths = PROVINCE_FEATURES.map((f) => ({
    feature: f,
    d: pathGen(f as never) ?? '',
    province: normProvince(f.properties.name),
  })).filter((p) => p.d);

  function handleMove(e: React.MouseEvent<SVGPathElement>, province: string) {
    const agg = byProvince.get(province);
    if (!agg) {
      setTooltip(null);
      return;
    }
    const svg = e.currentTarget.ownerSVGElement as SVGSVGElement;
    const rect = svg.getBoundingClientRect();
    setTooltip({
      x: Math.min(e.clientX - rect.left + 14, Math.max(0, rect.width - 216)),
      y: e.clientY - rect.top + 12,
      w: rect.width,
      agg,
    });
  }

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="h-auto w-full select-none"
        onMouseLeave={() => setTooltip(null)}
      >
        {paths.map(({ feature, d, province }) => {
          const agg = byProvince.get(province);
          const selected = filter === province;
          return (
            <path
              key={feature.properties.adcode}
              d={d}
              fill={fillColor(agg)}
              fillOpacity={agg ? 0.88 : 0.6}
              stroke={selected ? 'hsl(187 86% 53%)' : 'hsl(var(--background))'}
              strokeWidth={selected ? 2 : 0.6}
              className="cursor-pointer transition-[fill-opacity,stroke-width] duration-150 hover:fill-opacity-100"
              onMouseMove={(e) => handleMove(e, province)}
              onClick={() => onFilterChange(selected ? null : province)}
            />
          );
        })}
        {/* 南海诸岛/十段线插图（地图右下） */}
        {JD_FEATURE && jdPathGen && (
          <g transform={`translate(${WIDTH - INSET_W - 6},${HEIGHT - INSET_H - 6})`}>
            <rect width={INSET_W} height={INSET_H} fill="none" stroke="hsl(var(--border))" strokeWidth="1" rx="4" />
            <g transform="translate(6,6)">
              <path d={jdPathGen(JD_FEATURE as never) ?? ''} fill="none" stroke="hsl(var(--muted-foreground))" strokeWidth="0.8" />
            </g>
          </g>
        )}
      </svg>

      {/* 悬浮提示 */}
      {tooltip && (
        <div
          className="pointer-events-none absolute z-20 w-52 rounded-lg border bg-popover/95 p-2.5 text-xs shadow-lg backdrop-blur"
          style={{ left: `${Math.min(tooltip.x, tooltip.w - 216)}px`, top: `${tooltip.y}px` }}
        >
          <div className="mb-1 flex items-center justify-between">
            <span className="font-semibold">{tooltip.agg.province}</span>
            <span className={cn('num', tooltip.agg.avg !== undefined ? latencyTextClass(tooltip.agg.avg) : 'text-muted-foreground')}>
              {tooltip.agg.avg !== undefined ? `${tooltip.agg.avg} ms` : '无成功数据'}
            </span>
          </div>
          <div className="mb-1.5 text-muted-foreground">
            {tooltip.agg.ok}/{tooltip.agg.total} 节点成功
          </div>
          <div className="space-y-0.5">
            {tooltip.agg.nodes
              .slice()
              .sort((a, b) => (a.latencyMs ?? 9e9) - (b.latencyMs ?? 9e9))
              .slice(0, 5)
              .map((n, i) => (
                <div key={n.nodeId + i} className="flex justify-between gap-2">
                  <span className="truncate">{n.name}</span>
                  <span className="num shrink-0">{n.latencyMs}ms</span>
                </div>
              ))}
            {tooltip.agg.nodes.length > 5 && (
              <div className="text-muted-foreground">… 共 {tooltip.agg.nodes.length} 个成功节点</div>
            )}
          </div>
        </div>
      )}

      {/* 图例 */}
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
        {LEGEND.map((l) => (
          <span key={l.label} className="inline-flex items-center gap-1">
            <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: l.color }} />
            {l.label}
          </span>
        ))}
        {overseas.length > 0 && (
          <span className="ml-auto">
            境外节点：<span className="num">{overseasOk}/{overseas.length}</span>
            {overseasAvg !== undefined && <span className="num"> · 均值 {overseasAvg} ms</span>}
          </span>
        )}
        <span className="w-full text-right opacity-70">地图数据 © DataV.GeoAtlas · 点击省份可筛选明细</span>
      </div>
    </div>
  );
}

function latencyTextClass(ms: number): string {
  if (ms <= 50) return 'text-emerald-500';
  if (ms <= 150) return 'text-amber-500';
  if (ms <= 300) return 'text-orange-500';
  return 'text-red-400';
}
