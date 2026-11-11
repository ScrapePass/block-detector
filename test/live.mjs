// Live check against real sites with a plain fetch (no browser). Not part of `npm test`: sites change.
// "ok" pages must come back OK (false-positive check). "watch" pages are sites that often block scrapers:
// their result is printed, not asserted, because it depends on your network and the day.
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const B = require('../lib/node.cjs');

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const OK = [
  'https://example.com/',
  'https://en.wikipedia.org/wiki/Web_scraping',
  'https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/429',
  'https://news.ycombinator.com/',
  'https://github.com/microsoft/playwright',
  'https://www.python.org/',
  'https://www.gnu.org/licenses/gpl-3.0.html',
  'https://httpbin.org/html',
  'https://www.rfc-editor.org/rfc/rfc9110.html',
  'https://books.toscrape.com/',
];
const NOT_OK = ['https://en.wikipedia.org/wiki/This_page_does_not_exist_block_detector_test'];
const WATCH = ['https://www.amazon.com/dp/B0BSHF7WHW', 'https://www.zillow.com/homes/for_sale/', 'https://www.g2.com/products/slack/reviews', 'https://www.walmart.com/ip/5011498025', 'https://www.indeed.com/jobs?q=scraping', 'https://www.linkedin.com/jobs/', 'https://www.tripadvisor.com/', 'https://www.realtor.com/'];

async function check(url) {
  try {
    const res = await fetch(url, { redirect: 'follow', headers: { 'user-agent': UA, accept: 'text/html,application/xhtml+xml', 'accept-language': 'en-US,en;q=0.9' }, signal: AbortSignal.timeout(20000) });
    return await B.detectResponse(res, { requestedUrl: url });
  } catch (e) {
    return { error: String(e.message || e) };
  }
}

let failed = 0;
const line = (tag, url, r) => console.log(`${tag.padEnd(5)} ${url}\n      ${r.error ? 'fetch error: ' + r.error : `[${r.page.status}] ${r.summary}`}`);
console.log('— must be OK —');
for (const url of OK) {
  const r = await check(url);
  const good = r.error || r.ok;
  if (!good) failed++;
  line(r.error ? 'skip' : good ? 'pass' : 'FAIL', url, r);
}
console.log('\n— must NOT be OK —');
for (const url of NOT_OK) {
  const r = await check(url);
  const good = r.error || !r.ok;
  if (!good) failed++;
  line(r.error ? 'skip' : good ? 'pass' : 'FAIL', url, r);
}
console.log('\n— sites that often block scrapers (shown, not asserted) —');
for (const url of WATCH) line('info', url, await check(url));
console.log(failed ? `\n${failed} failed` : '\nall passed');
process.exit(failed ? 1 : 0);
