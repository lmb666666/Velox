import { chromium } from 'playwright';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
await page.goto('http://localhost:8818/', { waitUntil: 'networkidle' });
await page.waitForTimeout(500);
const m = await page.evaluate(() => {
  const card = document.querySelector('main .border-dashed');
  const parent = card?.parentElement;
  const cs = card ? getComputedStyle(card) : null;
  const ps = parent ? getComputedStyle(parent) : null;
  return {
    card: cs ? {
      flexGrow: cs.flexGrow, flexBasis: cs.flexBasis, flexShrink: cs.flexShrink,
      height: cs.height, minHeight: cs.minHeight, display: cs.display,
      alignSelf: cs.alignSelf, classes: card.className,
    } : 'card not found',
    parent: ps ? {
      classes: parent.className, display: ps.display, flexDirection: ps.flexDirection,
      height: ps.height, alignItems: ps.alignItems,
    } : 'no parent',
    parentIsRightCol: parent?.className.includes('space-y-3'),
  };
});
console.log(JSON.stringify(m, null, 2));
await browser.close();
