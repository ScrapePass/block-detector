#!/usr/bin/env node
'use strict';
const { readFileSync, writeFileSync } = require('node:fs');
const B = require('../lib/node.cjs');

const HELP = `block-detector ${B.VERSION} — is this the real page, or did the site block you with a 200?

Usage
  block-detector <url | file.html | ->  [options]

Options
  --browser             open the page in a real browser (needs: npm i playwright) instead of fetching the HTML
  --headful             show the browser window (with --browser)
  --wait <ms>           wait after the page loads, with --browser (default 2000)
  --expect <selector>   a selector the real page must have; repeat it, e.g. --expect h1 --expect ".item >= 10"
  --reference <file>    a fingerprint JSON of a good page of the same kind (see --save-reference)
  --save-reference <f>  save this page's fingerprint to a file, to use later with --reference
  --url <url>           with a file or stdin: the URL the HTML came from
  --json                print the full result as JSON
  --fail                exit with code 1 when the page is not OK (for CI and shell scripts)
  --threshold <0..1>    confidence a reason needs to count (default 0.5)
  -h, --help            show this help

Examples
  block-detector https://example.com/item/42
  block-detector https://example.com/item/1 --expect h1 --expect .price --save-reference item.json
  block-detector https://example.com/item/2 --reference item.json --fail
  curl -s https://example.com | block-detector - --url https://example.com/
`;

function parseArgs(argv) {
  const a = { input: null, browser: false, headful: false, wait: 2000, json: false, fail: false, expect: [] };
  for (let i = 0; i < argv.length; i++) {
    const v = argv[i];
    const next = () => {
      if (i + 1 >= argv.length) throw new Error(`${v} needs a value`);
      return argv[++i];
    };
    if (v === '-h' || v === '--help') a.help = true;
    else if (v === '--browser') a.browser = true;
    else if (v === '--headful') a.headful = true;
    else if (v === '--json') a.json = true;
    else if (v === '--fail') a.fail = true;
    else if (v === '--wait') a.wait = Number(next());
    else if (v === '--threshold') a.threshold = Number(next());
    else if (v === '--expect') a.expect.push(next());
    else if (v === '--reference') a.reference = next();
    else if (v === '--save-reference') a.saveReference = next();
    else if (v === '--url') a.url = next();
    else if (!a.input) a.input = v;
    else throw new Error('Unexpected argument: ' + v);
  }
  return a;
}

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

async function fromUrl(url, opts) {
  const res = await fetch(url, {
    redirect: 'follow',
    headers: { 'user-agent': UA, accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8', 'accept-language': 'en-US,en;q=0.9' },
  });
  return B.detectResponse(res, { ...opts, requestedUrl: url });
}

async function fromBrowser(url, opts, a) {
  let chromium;
  try {
    ({ chromium } = require('playwright'));
  } catch (_) {
    throw new Error('--browser needs Playwright: npm i -D playwright && npx playwright install chromium');
  }
  const { detectInPage } = require('../lib/page.cjs');
  const browser = await chromium.launch({ headless: !a.headful });
  try {
    const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
    const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForLoadState('load', { timeout: 15000 }).catch(() => {});
    if (a.wait > 0) await page.waitForTimeout(a.wait);
    return await detectInPage(page, { ...opts, response, requestedUrl: url });
  } finally {
    await browser.close();
  }
}

function readStdin() {
  return new Promise((resolve, reject) => {
    let s = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (d) => (s += d));
    process.stdin.on('end', () => resolve(s));
    process.stdin.on('error', reject);
  });
}

function print(r) {
  const mark = r.ok ? 'OK' : r.blocked ? 'BLOCKED' : 'NOT THE REAL PAGE';
  console.log(`${mark}  ${r.page.url || ''}`);
  console.log(`  ${r.summary}`);
  for (const d of r.detections) {
    console.log(`  - ${d.reason} (${d.confidence}): ${d.description}`);
    for (const e of d.evidence.slice(0, 3)) console.log(`      ${e.type}: ${e.value}`);
  }
  for (const e of r.expect) console.log(`  ${e.ok ? '✓' : '✗'} expect ${e.selector || 'page text'}${e.text ? ` ~ ${e.text}` : ''}: ${e.error ? e.error : e.count}`);
  if (r.reference) console.log(`  reference similarity: ${r.reference.similarity} ${JSON.stringify(r.reference.parts)}`);
  if (r.hints.length) console.log(`  hints: ${r.hints.map((d) => `${d.reason} ${d.confidence}`).join(', ')}`);
}

async function main() {
  const a = parseArgs(process.argv.slice(2));
  if (a.help || !a.input) {
    process.stdout.write(HELP);
    process.exit(a.help ? 0 : 2);
  }
  const opts = { threshold: a.threshold };
  if (a.expect.length) opts.expect = a.expect;
  if (a.reference) opts.reference = JSON.parse(readFileSync(a.reference, 'utf8'));
  let r;
  if (/^https?:\/\//i.test(a.input)) r = a.browser ? await fromBrowser(a.input, opts, a) : await fromUrl(a.input, opts);
  else {
    const html = a.input === '-' ? await readStdin() : readFileSync(a.input, 'utf8');
    r = B.detectHtml(html, { ...opts, url: a.url || '' });
  }
  if (a.saveReference) {
    writeFileSync(a.saveReference, JSON.stringify(r.fingerprint, null, 2));
    if (!a.json) console.log(`saved fingerprint to ${a.saveReference}${r.ok ? '' : ' (careful: this page did not look OK)'}`);
  }
  if (a.json) console.log(JSON.stringify(r, null, 2));
  else print(r);
  if (a.fail && !r.ok) process.exit(1);
}

main().catch((e) => {
  console.error('block-detector: ' + (e && e.message ? e.message : e));
  process.exit(2);
});
