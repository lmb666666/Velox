import { chromium } from 'playwright';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
await page.goto('http://localhost:8818/', { waitUntil: 'networkidle' });
await page.waitForTimeout(500);
const m = await page.evaluate(() => {
  const q = (sel) => document.querySelector(sel);
  const grid = q('main div.grid');
  const cols = grid ? [...grid.children] : [];
  const rect = (el) => { const r = el.getBoundingClientRect(); return { top: Math.round(r.top), h: Math.round(r.height), w: Math.round(r.width) }; };
  return {
    viewport: { w: innerWidth, h: innerHeight },
    grid: grid ? { h: Math.round(grid.getBoundingClientRect().height), alignItems: getComputedStyle(grid).alignItems, cols: getComputedStyle(grid).gridTemplateColumns } : null,
    leftCol: cols[0] ? rect(cols[0]) : null,
    rightCol: cols[1] ? { ...rect(cols[1]), display: getComputedStyle(cols[1]).display } : null,
    idleCard: q('main .border-dashed') ? rect(q('main .border-dashed')) : null,
  };
});
console.log(JSON.stringify(m, null, 2));
await browser.close();
