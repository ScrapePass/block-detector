// Playwright: learn what a good product page looks like once, then check every other product page against it.
import { chromium } from 'playwright';
import { detectInPage, fingerprintPage, waitForContent } from 'block-detector/page';

const browser = await chromium.launch();
const page = await browser.newPage();

// 1. A page you know is good (check it by eye once).
await page.goto('https://books.toscrape.com/catalogue/a-light-in-the-attic_1000/index.html');
const reference = await fingerprintPage(page, { expect: ['h1', '.price_color'] });

// 2. Every other page of the same kind.
for (const url of ['https://books.toscrape.com/catalogue/tipping-the-velvet_999/index.html']) {
  const response = await page.goto(url);
  const r = await waitForContent(page, { response, reference, timeout: 8000 });
  console.log(r.ok ? 'OK     ' : r.blocked ? 'BLOCKED' : 'MISSING', url, '—', r.summary);
  if (r.blocked) break; // slow down, rotate, or stop
}
await browser.close();
