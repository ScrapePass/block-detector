'use strict';
// Playwright / Puppeteer helper: runs the detector inside the page, with the response status, headers and the
// URL you asked for (before redirects). When captcha-detector is installed, its page helper runs too (it also
// looks inside cross-origin frames) and its result is part of the answer.
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const SOURCE = readFileSync(join(__dirname, '../dist/block-detector.js'), 'utf8');

let captchaPage = null;
try {
  captchaPage = require('captcha-detector/page');
} catch (_) {
  /* optional */
}

/** RegExps do not survive page.evaluate: send them as { source, flags }. */
function serializable(opts) {
  const out = { ...opts };
  if (out.expect) {
    const list = Array.isArray(out.expect) ? out.expect : [out.expect];
    out.expect = list.map((e) => (e && typeof e === 'object' && e.text instanceof RegExp ? { ...e, text: { source: e.text.source, flags: e.text.flags } } : e));
  }
  for (const k of ['window', 'captchaDetector']) delete out[k];
  return out;
}

/** Expression that runs `fn` ('detect' or 'fingerprint') in a page without leaving globals behind. */
function expression(opts, fn = 'detect') {
  return `(() => { const module = { exports: {} }; ${SOURCE}
;const B = module.exports; const r = B.${fn}(${JSON.stringify(serializable(opts || {}))});
return JSON.parse(JSON.stringify(r.fingerprint ? Object.assign({}, r, { fingerprint: r.fingerprint }) : r)); })()`;
}

async function responseInfo(response) {
  if (!response) return {};
  const out = {};
  try {
    out.status = typeof response.status === 'function' ? response.status() : response.status;
    if (typeof response.allHeaders === 'function') out.headers = await response.allHeaders();
    else if (typeof response.headers === 'function') out.headers = response.headers();
    else if (response.headers) out.headers = response.headers;
  } catch (_) {
    /* ignore */
  }
  try {
    let req = response.request();
    if (typeof req.redirectChain === 'function') {
      // Puppeteer
      const chain = req.redirectChain();
      out.requestedUrl = chain.length ? chain[0].url() : req.url();
    } else {
      // Playwright
      while (req.redirectedFrom && req.redirectedFrom()) req = req.redirectedFrom();
      out.requestedUrl = req.url();
    }
  } catch (_) {
    /* ignore */
  }
  return out;
}

function withFingerprint(r) {
  if (r && r.fingerprint) {
    const fp = r.fingerprint;
    delete r.fingerprint;
    Object.defineProperty(r, 'fingerprint', { value: fp, enumerable: false });
  }
  return r;
}

/**
 * Check a Playwright or Puppeteer page.
 * options: { response, requestedUrl, expect, reference, threshold, captcha: true }
 *   response      the Response from page.goto(): gives status, headers and the URL before redirects
 *   requestedUrl  the URL you asked for, if you have no response (JS redirects happen after it)
 *   captcha       false to skip captcha-detector even when it is installed
 */
async function detectInPage(page, options = {}) {
  const { response, captcha = true, ...rest } = options;
  const info = await responseInfo(response);
  const opts = { ...info, ...rest };
  if (!opts.requestedUrl && info.requestedUrl) opts.requestedUrl = info.requestedUrl;
  if (captcha && captchaPage && opts.captcha === undefined) {
    opts.captcha = await withTimeout(captchaPage.detectInPage(page, { response }), 15000).catch(() => null);
  }
  if (!captcha) opts.captcha = null;
  return withFingerprint(await evaluateSettled(page, expression(opts)));
}

function withTimeout(promise, ms) {
  let t;
  return Promise.race([promise, new Promise((_, reject) => (t = setTimeout(() => reject(new Error('timeout')), ms)))]).finally(() => clearTimeout(t));
}

/** Evaluate in the main frame; if the page navigates meanwhile (meta refresh, JS redirect), wait and try again. */
async function evaluateSettled(page, expr, tries = 3) {
  for (let i = 0; ; i++) {
    try {
      return await withTimeout(page.mainFrame().evaluate(expr), 20000);
    } catch (e) {
      const msg = String((e && e.message) || e);
      if (i >= tries - 1 || !/context was destroyed|navigat|detached|timeout|Cannot find context/i.test(msg)) throw e;
      await withTimeout(page.waitForLoadState('load'), 10000).catch(() => {});
    }
  }
}

/** Fingerprint a page you know is good. options: { expect } — selectors to record counts for. */
async function fingerprintPage(page, options = {}) {
  return evaluateSettled(page, expression(options, 'fingerprint'));
}

const WAITING = { loading: 1, 'js-shell': 1, empty: 1 };

/**
 * Wait until the page has content (not loading, not an empty shell) or the timeout passes.
 * Resolves with the last result. options: { timeout: 10000, interval: 500, ...detectInPage options }
 */
async function waitForContent(page, options = {}) {
  const { timeout = 10000, interval = 500, ...rest } = options;
  const end = Date.now() + timeout;
  let last;
  for (;;) {
    try {
      last = await detectInPage(page, rest);
      if (!last.detections.some((d) => WAITING[d.reason])) return last;
    } catch (_) {
      /* navigating */
    }
    if (Date.now() >= end) return last;
    await new Promise((r) => setTimeout(r, interval));
  }
}

/** Source of the browser build, e.g. for page.addInitScript / driver.execute_script. */
const browserScript = SOURCE;

module.exports = { detectInPage, fingerprintPage, waitForContent, browserScript, expression };
