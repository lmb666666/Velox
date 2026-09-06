#!/usr/bin/env node
/** 布局调试：无头浏览器量测关键区块尺寸。用法: pnpm layout-check */
import { chromium } from 'playwright';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
await page.goto('http://localhost:8818/', { waitUntil: 'networkidle' });
await page.waitForTimeout(500);
const m = await page.evaluate(() => {
  const grid = document.querySelector('main div.grid');
  const cols = grid ? [...grid.children] : [];
  const rect = (el) => { const r = el.getBoundingClientRect(); return { top: Math.round(r.top), h: Math.round(r.height), w: Math.round(r.width) }; };
  const idle = document.querySelector('main .border-dashed');
  return {
    grid: grid ? rect(grid) : null,
    leftCol: cols[0] ? rect(cols[0]) : null,
    rightCol: cols[1] ? rect(cols[1]) : null,
    idleCard: idle ? rect(idle) : null,
    idleFlexGrow: idle ? getComputedStyle(idle).flexGrow : null,
  };
});
console.log(JSON.stringify(m, null, 2));
await browser.close();
