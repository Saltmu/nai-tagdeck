// Real browser layout checks for the preview's width breakpoints.
const { chromium } = require(process.argv[2] || 'playwright');
const { resolve } = require('node:path');
const { pathToFileURL } = require('node:url');
(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 700, height: 900 } });
    await page.goto(pathToFileURL(resolve('public/brand-concepts/index.html')).href);
    for (const width of [320, 380, 519, 520, 767, 768, 804, 805, 1000]) {
      const result = await page.evaluate(width => {
        const slider = document.querySelector('#width');
        slider.value = width;
        slider.dispatchEvent(new Event('input'));
        const header = document.querySelector('#demo');
        const brand = document.querySelector('#demo-wordmark');
        const nav = document.querySelector('.demo-nav');
        const icon = document.querySelector('#demo-icon');
        const visible = element => getComputedStyle(element).display !== 'none';
        const rect = element => element.getBoundingClientRect();
        const brandRight = visible(brand) ? rect(brand).right : rect(icon).right;
        return { width: rect(header).width, brand: visible(brand), menu: visible(nav.querySelector('b')), overlaps: brandRight > rect(nav).left };
      }, width);
      if (result.width !== width || result.menu !== (width >= 805) || (width < 520 && result.brand) || result.overlaps) {
        throw new Error(`Layout failed at ${width}: ${JSON.stringify(result)}`);
      }
      console.log(JSON.stringify(result));
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
