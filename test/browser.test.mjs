// Runs the detector in a real Chromium (Playwright) on the same test pages, through the page helper, with real
// HTTP redirects; plus cases only a live page has (content rendered by scripts, CSS-hidden text). Skipped when
// Playwright is not installed.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { CASES, PRODUCT, PRODUCT_2 } from './cases.mjs';
import { check } from './check.mjs';

const require = createRequire(import.meta.url);
const { detectInPage, fingerprintPage, waitForContent } = require('../lib/page.cjs');

let chromium;
try {
  ({ chromium } = require('playwright'));
} catch (_) {
  chromium = null;
}

// A local server answers for every host name (Chromium maps them all to 127.0.0.1), so redirects are real HTTP.
const pages = new Map(); // "host/path?query" → { status, headers, body }
const server = createServer((req, res) => {
  const key = req.headers.host.replace(/:\d+$/, '') + req.url;
  const p = pages.get(key);
  if (!p) {
    res.writeHead(404, { 'content-type': 'text/plain' });
    return res.end('');
  }
  res.writeHead(p.status, p.headers);
  res.end(p.body);
});
let port;
/** https://shop.test/a → http://shop.test:PORT/a (the test server speaks plain HTTP). */
const local = (u) => {
  const x = new URL(u);
  return `http://${x.hostname}:${port}${x.pathname}${x.search}`;
};
const serve = (u, p) => {
  const x = new URL(u);
  pages.set(x.hostname + x.pathname + x.search, p);
};

let browser;
let context;
before(async () => {
  if (!chromium) return;
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  port = server.address().port;
  browser = await chromium.launch({ args: ['--host-resolver-rules=MAP * 127.0.0.1'] });
  context = await browser.newContext({ viewport: { width: 1200, height: 900 } });
});
after(async () => {
  if (browser) await browser.close();
  server.close();
});

/** Open `url` serving `html`; with `from`, `from` answers 302 → url first. Returns the page and the response. */
async function open(html, { url = 'https://shop.test/item/42', from, status = 200, headers = {}, files = {} } = {}) {
  pages.clear();
  serve(url, { status, headers: { 'content-type': 'text/html; charset=utf-8', ...headers }, body: html });
  if (from && local(from) !== local(url)) serve(from, { status: 302, headers: { location: local(url) }, body: '' });
  for (const [u, body] of Object.entries(files)) serve(u, { status: 200, headers: { 'content-type': 'application/javascript' }, body });
  const page = await context.newPage();
  const response = await page.goto(local(from || url), { waitUntil: 'load' });
  await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});
  return { page, response };
}

for (const c of CASES) {
  test(`browser: ${c.name}`, async (t) => {
    if (!chromium) return t.skip('playwright not installed');
    const o = c.opts || {};
    const { page, response } = await open(c.html, { url: o.url || 'https://shop.test/item/42', from: o.requestedUrl, status: o.status || 200, headers: o.headers });
    try {
      const r = await detectInPage(page, { response, expect: o.expect, threshold: o.threshold });
      assert.equal(r.mode, 'dom');
      check(r, c.expect, c.name);
    } finally {
      await page.close();
    }
  });
}

test('browser: the URL before redirects comes from the response', async (t) => {
  if (!chromium) return t.skip('playwright not installed');
  const { page, response } = await open(PRODUCT, { url: 'https://shop.test/', from: 'https://shop.test/item/42' });
  const r = await detectInPage(page, { response });
  assert.equal(r.page.requestedUrl, local('https://shop.test/item/42'));
  assert.equal(r.reason, 'redirected', r.summary);
  await page.close();
});

test('browser: JavaScript redirect to the home page (requestedUrl given)', async (t) => {
  if (!chromium) return t.skip('playwright not installed');
  pages.clear();
  serve('https://shop.test/', { status: 200, headers: { 'content-type': 'text/html' }, body: '<!doctype html><title>Shop</title><body><h1>Welcome</h1></body>' });
  serve('https://shop.test/item/42', { status: 200, headers: { 'content-type': 'text/html' }, body: '<script>location.replace("/")</script>' });
  const page = await context.newPage();
  await page.goto(local('https://shop.test/item/42'));
  await page.waitForURL(local('https://shop.test/'));
  const r = await detectInPage(page, { requestedUrl: local('https://shop.test/item/42') });
  assert.equal(r.reason, 'redirected', r.summary);
  await page.close();
});

test('browser: waitForContent waits for an app that renders late', async (t) => {
  if (!chromium) return t.skip('playwright not installed');
  const html = '<!doctype html><title>App</title><body><div id="root"></div><script src="/app.js"></script></body>';
  const app = `setTimeout(() => { document.getElementById('root').innerHTML = '<h1>Steel Bottle</h1><p class="price">$24.99</p><p>' + 'Great bottle. '.repeat(40) + '</p>'; }, 1200);`;
  const { page, response } = await open(html, { files: { 'https://shop.test/app.js': app } });
  const first = await detectInPage(page, { response });
  assert.equal(first.reason, 'js-shell', first.summary);
  const r = await waitForContent(page, { response, timeout: 5000, interval: 200, expect: ['.price'] });
  assert.equal(r.ok, true, r.summary);
  await page.close();
});

test('browser: text hidden with CSS does not count', async (t) => {
  if (!chromium) return t.skip('playwright not installed');
  const html = '<!doctype html><title>Shop</title><style>.x{display:none}</style><body><div class="x">' + '<p>Real product text that is hidden from people.</p>'.repeat(50) + '</div><p>Access denied.</p></body>';
  const { page, response } = await open(html);
  const r = await detectInPage(page, { response });
  assert.equal(r.reason, 'access-denied', r.summary);
  assert.ok(r.page.textLength < 50, `textLength ${r.page.textLength}`);
  await page.close();
});

test('browser: fingerprintPage + reference, RegExp expect survives the trip into the page', async (t) => {
  if (!chromium) return t.skip('playwright not installed');
  let { page } = await open(PRODUCT, { url: 'https://shop.test/item/1' });
  const ref = await fingerprintPage(page, { expect: ['.price', '.card'] });
  await page.close();
  assert.equal(ref.v, 1);
  assert.deepEqual(ref.expect.map((e) => e.count), [1, 6]);

  ({ page } = await open(PRODUCT_2, { url: 'https://shop.test/item/2' }));
  const good = await detectInPage(page, { reference: ref, expect: [{ selector: '.price', text: /^\$\d+\.\d\d$/ }] });
  assert.equal(good.ok, true, good.summary);
  assert.ok(good.reference.similarity >= 0.8, String(good.reference.similarity));
  assert.ok(good.fingerprint && good.fingerprint.v === 1, 'fingerprint attached');
  await page.close();

  const decoy = '<!doctype html><title>Steel Water Bottle</title><body><div class="wrapper"><h1>Steel Water Bottle</h1><p>Price unavailable.</p></div></body>';
  ({ page } = await open(decoy, { url: 'https://shop.test/item/3' }));
  const bad = await detectInPage(page, { reference: ref });
  assert.equal(bad.ok, false, bad.summary);
  assert.ok(bad.detections.some((d) => d.reason === 'different'), bad.summary);
  await page.close();
});

test('browser: captcha-detector result is included when installed', async (t) => {
  if (!chromium) return t.skip('playwright not installed');
  let installed = true;
  try {
    require.resolve('captcha-detector/page');
  } catch (_) {
    installed = false;
  }
  const html = '<!doctype html><html><head><title>Just a moment...</title></head><body><div id="challenge-running">Checking if the site connection is secure</div><script src="/cdn-cgi/challenge-platform/h/b/orchestrate/chl_page/v1?ray=8a1b2c3d4e5f6a7b"></script></body></html>';
  const { page, response } = await open(html);
  const r = await detectInPage(page, { response });
  assert.equal(r.ok, false, r.summary);
  if (installed) assert.equal(r.reason, 'challenge', r.summary);
  const off = await detectInPage(page, { response, captcha: false });
  assert.equal(off.captcha, null);
  await page.close();
});
