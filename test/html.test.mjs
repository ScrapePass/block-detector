import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { CASES, PRODUCT, PRODUCT_2 } from './cases.mjs';
import { check } from './check.mjs';
import ESM, { detectHtml as detectHtmlEsm } from '../dist/block-detector.mjs';

const require = createRequire(import.meta.url);
const B = require('../dist/block-detector.js'); // browser build: captcha-detector not registered
const NodeB = require('../lib/node.cjs'); // node entry: captcha-detector registered when installed

// Every case on its own, and again with captcha-detector's checks (when it is installed).
for (const c of CASES) {
  test(`html: ${c.name}`, () => check(B.detectHtml(c.html, { ...c.opts, useCaptchaDetector: false }), c.expect, c.name));
  test(`html + captcha-detector: ${c.name}`, () => check(NodeB.detectHtml(c.html, c.opts || {}), c.expect, c.name));
}

test('ESM build gives the same answer', () => {
  assert.equal(detectHtmlEsm(CASES[0].html).summary, B.detectHtml(CASES[0].html).summary);
  assert.equal(typeof ESM.detect, 'function');
});

test('result shape', () => {
  const r = B.detectHtml(CASES[0].html, { url: 'https://shop.test/a', status: 200 });
  for (const k of ['ok', 'blocked', 'reason', 'confidence', 'summary', 'detections', 'hints', 'expect', 'reference', 'captcha', 'page', 'mode', 'version']) assert.ok(k in r, k);
  assert.equal(r.mode, 'html');
  assert.equal(r.page.status, 200);
  const d = r.detections[0];
  for (const k of ['reason', 'confidence', 'blocking', 'description', 'evidence']) assert.ok(k in d, k);
  assert.ok(r.fingerprint && r.fingerprint.v === 1, 'fingerprint is attached');
  assert.ok(!Object.keys(r).includes('fingerprint'), 'fingerprint is not enumerable');
  assert.doesNotThrow(() => JSON.stringify(r));
});

test('reference: a page of the same template matches', () => {
  const ref = B.fingerprintHtml(PRODUCT, { url: 'https://shop.test/item/1' });
  const r = B.detectHtml(PRODUCT_2, { reference: ref });
  assert.equal(r.ok, true, r.summary);
  assert.ok(r.reference.similarity >= 0.8, `similarity ${r.reference.similarity}`);
  assert.ok(JSON.parse(JSON.stringify(ref)).v === 1, 'fingerprint is JSON');
});

test('reference: a block page served inside the site layout is different', () => {
  const ref = B.fingerprintHtml(PRODUCT);
  const html = CASES.find((c) => c.name === 'redirected to the home page').html;
  const r = B.detectHtml(html, { reference: ref });
  assert.equal(r.ok, false, r.summary);
  assert.ok(r.detections.some((d) => d.reason === 'different' || d.reason === 'stripped'), r.summary);
});

test('reference: a decoy page with no block wording is different', () => {
  const ref = B.fingerprintHtml(PRODUCT);
  const decoy = '<!doctype html><html><head><title>Steel Water Bottle 750 ml</title></head><body><div class="wrapper"><h1>Steel Water Bottle 750 ml</h1><p>Price unavailable.</p><p>Contact us for details.</p></div></body></html>';
  const r = B.detectHtml(decoy, { reference: ref });
  assert.equal(r.ok, false, r.summary);
  assert.ok(r.detections.some((d) => d.reason === 'different'), r.summary);
});

test('reference with expect: recorded selectors must be there again', () => {
  const ref = B.fingerprintHtml(PRODUCT, { expect: ['.price', '.card'] });
  assert.deepEqual(ref.expect.map((e) => [e.selector, e.count]), [['.price', 1], ['.card', 6]]);
  const ok = B.detectHtml(PRODUCT_2, { reference: ref });
  assert.equal(ok.ok, true, ok.summary);
  const noPrice = CASES.find((c) => c.name === 'stripped: no price (expect .price)').html;
  const r = B.detectHtml(noPrice, { reference: ref });
  assert.equal(r.reason, 'stripped', r.summary);
});

test('reference overrules wording on a real page (a film called "Access Denied")', () => {
  const ref = B.fingerprintHtml(PRODUCT, { expect: ['.price'] });
  const film = B.detectHtml(PRODUCT_2.replace(/Insulated Travel Mug 400 ml/g, 'Access Denied (Blu-ray)'), { reference: ref });
  assert.equal(film.ok, true, film.summary);
  const plain = B.detectHtml(PRODUCT_2.replace(/Insulated Travel Mug 400 ml/g, 'Access Denied (Blu-ray)'));
  assert.equal(plain.ok, false, 'without a reference, the heading alone is suspicious: ' + plain.summary);
});

test('a list of references: best match wins', () => {
  const refs = [B.fingerprintHtml(CASES.find((c) => c.name === 'long article that mentions block messages').html), B.fingerprintHtml(PRODUCT)];
  const r = B.detectHtml(PRODUCT_2, { reference: refs });
  assert.equal(r.ok, true, r.summary);
  assert.ok(r.reference.similarity >= 0.8);
});

test('compare() accepts a snapshot or a fingerprint', () => {
  const a = B.fingerprintHtml(PRODUCT);
  assert.equal(B.compare(a, a).similarity, 1);
  assert.equal(B.compare(a, B.snapshotFromHtml(PRODUCT)).similarity, 1);
});

test('expect: string forms and errors', () => {
  const e = B.normalizeExpect(['h1', '.item >= 10', '.x = 2', { selector: '.price', text: '\\d' }, { text: /In stock/ }]);
  assert.deepEqual(e.map((x) => [x.selector, x.min, x.max]), [['h1', 1, null], ['.item', 10, null], ['.x', 2, 2], ['.price', 1, null], [null, 1, null]]);
  const r = B.detectHtml(PRODUCT, { expect: ['.a + .b', 'h1'] });
  assert.ok(r.expect[0].error, 'unsupported selector is reported, not thrown');
  assert.equal(r.ok, true, r.summary);
});

test('threshold changes what counts', () => {
  const html = CASES.find((c) => c.name === 'canonical to home on a short deep page is only a hint').html;
  assert.equal(B.detectHtml(html, { url: 'https://shop.test/item/42' }).ok, true);
  assert.equal(B.detectHtml(html, { url: 'https://shop.test/item/42', threshold: 0.4 }).ok, false);
});

test('detectResponse: fetch Response and axios-style objects', async () => {
  const res = new Response('<html><body><h1>Too many requests</h1></body></html>', { status: 200, headers: { 'content-type': 'text/html' } });
  const r = await B.detectResponse(res, { requestedUrl: 'https://shop.test/a' });
  assert.equal(r.reason, 'rate-limit');
  const r2 = await B.detectResponse({ data: PRODUCT, status: 200, headers: {} });
  assert.equal(r2.ok, true, r2.summary);
});

test('Node entry registers captcha-detector when installed', () => {
  let cd = null;
  try {
    cd = require('captcha-detector');
  } catch (_) {
    /* not installed */
  }
  const html = '<!doctype html><html><head><title>Just a moment...</title></head><body><div id="challenge-running">Checking if the site connection is secure</div><script src="/cdn-cgi/challenge-platform/h/b/orchestrate/chl_page/v1?ray=8a1b2c3d4e5f6a7b"></script><noscript>Enable JavaScript and cookies to continue</noscript></body></html>';
  const r = NodeB.detectHtml(html);
  assert.equal(r.ok, false, r.summary);
  if (cd) {
    assert.ok(r.captcha && r.captcha.challengePage, 'captcha-detector result attached');
    assert.equal(r.reason, 'challenge', r.summary);
  }
  const off = NodeB.detectHtml(html, { useCaptchaDetector: false });
  assert.equal(off.captcha, null);
});

test('HTML parser: implied end tags, raw text and entities', () => {
  const html = '<ul class="l"><li class="i">A<li class="i">B &amp; C<li class="i"><p>x<p>y</ul><script>var s = "<li class=i>";</script><table><tr><td>1<td>2<tr><td>3</table>';
  const r = B.detectHtml(html, { expect: ['ul.l > li.i = 3', 'table td = 3', 'li p = 2', { text: /B & C/ }] });
  for (const e of r.expect) assert.ok(e.ok, JSON.stringify(e));
});
