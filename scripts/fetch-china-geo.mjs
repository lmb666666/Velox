#!/usr/bin/env node
/**
 * 下载并简化中国省界 GeoJSON（用于 Web 控制台的地图可视化）。
 *
 * 数据来源：阿里云 DataV.GeoAtlas（https://geo.datav.aliyun.com/areas_v3/bound/100000_full.json）
 * 简化策略：坐标保留 3 位小数（约百米级）、丢弃重复相邻点，属性仅保留 name/adcode。
 *
 * 用法: pnpm fetch-china-geo   （输出 web/src/data/china-provinces.json）
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = 'https://geo.datav.aliyun.com/areas_v3/bound/100000_full.json';
const out = path.join(path.dirname(fileURLToPath(import.meta.url)), '../web/src/data/china-provinces.json');

const res = await fetch(SRC);
if (!res.ok) {
  console.error(`下载失败: HTTP ${res.status}`);
  process.exit(1);
}
const geo = await res.json();

const round = (n) => Number(n.toFixed(3));
function simplifyRing(ring) {
  const out = [];
  let last = null;
  for (const [x, y] of ring) {
    const p = [round(x), round(y)];
    if (!last || Math.abs(p[0] - last[0]) > 0.001 || Math.abs(p[1] - last[1]) > 0.001) {
      out.push(p);
      last = p;
    }
  }
  return out.length >= 4 ? out : ring.map(([x, y]) => [round(x), round(y)]);
}
function simplifyGeometry(geom) {
  if (geom.type === 'Polygon') return { ...geom, coordinates: geom.coordinates.map(simplifyRing) };
  if (geom.type === 'MultiPolygon') {
    return { ...geom, coordinates: geom.coordinates.map((poly) => poly.map(simplifyRing)) };
  }
  return geom;
}

const features = geo.features.map((f) => ({
  type: 'Feature',
  properties: { name: f.properties.name ?? '', adcode: f.properties.adcode ?? '' },
  geometry: simplifyGeometry(f.geometry),
}));

const simplified = { type: 'FeatureCollection', features };
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify(simplified));
console.log(
  `已生成 ${out}：${features.length} 个要素，` +
    `${(fs.statSync(out).size / 1024).toFixed(0)} KB`,
);
