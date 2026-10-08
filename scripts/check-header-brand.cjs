const { chromium } = require(process.argv[2] || 'playwright');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' };
const server = http.createServer((req, res) => {
  const file = path.join(process.cwd(), 'dist', decodeURIComponent(new URL(req.url, 'http://localhost').pathname));
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
    res.writeHead(404); res.end(); return;
  }
  res.setHeader('Content-Type', mime[path.extname(file)] || 'application/octet-stream');
  res.end(fs.readFileSync(file));
});
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({ channel: 'msedge', headless: true });
    const page = await browser.newPage();
    for (const theme of ['light', 'dark']) {
      await page.emulateMedia({ colorScheme: theme });
      for (const width of [320, 380, 519, 520, 767, ...Array.from({ length: 37 }, (_, i) => 768 + i), 805, 806, 1000, 1280]) {
        await page.setViewportSize({ width, height: 900 });
        await page.goto(`http://127.0.0.1:${server.address().port}/index.html`);
        await page.locator('.brand-icon').waitFor();
        const result = await page.evaluate(() => {
          const title = document.querySelector('.app-title'), nav = document.querySelector('.tabbar');
          const wordmark = title.querySelector('.brand-wordmark');
          const rect = el => el.getBoundingClientRect();
          const label = document.querySelector('.tab-label');
          return { wordmark: getComputedStyle(wordmark).display !== 'none', menu: rect(label).width > 1,
            overlaps: rect(title).right > rect(nav).left || rect(nav).right > rect(document.querySelector('.quick-generate')).left,
            overflow: document.querySelector('.app-header').scrollWidth > innerWidth,
            wrapped: [...nav.querySelectorAll('.tab-label')].some(el => rect(el).width > 1 && rect(el).height > parseFloat(getComputedStyle(el).lineHeight) + 1),
            loaded: [...title.querySelectorAll('img')].every(img => img.complete && img.naturalWidth > 0) };
        });
        console.log(JSON.stringify({theme, width, ...result}));
        if (result.wordmark !== (width >= 520) || result.menu !== (width >= 805) || result.wrapped || result.overlaps || result.overflow || !result.loaded) throw new Error('Header layout failed');
      }
    }
  } finally { if (browser) await browser.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
