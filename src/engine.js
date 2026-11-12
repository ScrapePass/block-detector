import { parseHtml, textOf, cleanText, querySelectorAll, hiddenByMarkup } from './html.js';
import { RULES, BLOCK_PATH, LOGIN_PATH, SKELETON, APP_ROOTS } from './patterns.js';

export const VERSION = '1.1.0';

/** Every reason a result can give. The first group means the site served something else on purpose. */
export const REASONS = {
  challenge: 'A bot check or captcha page instead of the content',
  'access-denied': 'An access-denied or "you have been blocked" page',
  'rate-limit': 'A rate-limit or "too many requests" page',
  login: 'A sign-in wall instead of the content',
  redirected: 'Sent to another page (home page, block page, another site)',
  'js-shell': 'An empty JavaScript app shell, or a page that asks for JavaScript',
  empty: 'A blank or nearly blank page',
  loading: 'Only loading placeholders, the content never arrived',
  stripped: 'The page layout is there, but the expected data is missing',
  different: 'A different page: not like the reference fingerprint, or about none of what the address names',
  'not-found': 'A "page not found" or "no longer available" page',
  error: 'An error or maintenance page',
};
const NOT_BLOCK = { 'not-found': 1, error: 1 };
/** Evidence that is only wording, which a strong reference match overrules. */
const WORDING = { text: 1, headline: 1, canonical: 1, 'captcha-wording': 1 };
const DEFAULT_THRESHOLD = 0.5;
const MAX_TEXT = 200000;
const MAX_WALK = 30000;
const TOP_TAGS = 160;
const TOP_CLASSES = 220;

let captchaDetector = null;
/** Register captcha-detector (the module object) so its checks run too. Node entry points do this on their own. */
export function use(cd) {
  captchaDetector = cd && typeof cd.detectHtml === 'function' ? cd : null;
  return captchaDetector;
}

// ───────────────────────────── Small helpers ─────────────────────────────

const short = (s, n = 140) => {
  s = String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
};

function lowerHeaders(h) {
  const out = {};
  if (!h) return out;
  const add = (k, v) => {
    k = String(k).toLowerCase();
    v = Array.isArray(v) ? v.join('\n') : String(v);
    out[k] = out[k] ? out[k] + '\n' + v : v;
  };
  if (typeof h.forEach === 'function' && typeof h.get === 'function') h.forEach((v, k) => add(k, v));
  else if (Array.isArray(h)) h.forEach(([k, v]) => add(k, v));
  else for (const k of Object.keys(h)) if (h[k] != null) add(k, h[k]);
  return out;
}

function parseUrl(u, base) {
  if (!u) return null;
  try {
    return new URL(String(u).trim(), base || undefined);
  } catch (_) {
    return null;
  }
}

const hostKey = (u) => u.hostname.toLowerCase().replace(/^www\d?\./, '').replace(/^m\./, '');
const pathKey = (u) => (u.pathname.replace(/\/(?:index\.(?:html?|php|aspx?))?$/i, '').replace(/\/+$/, '') || '/').toLowerCase();
/** A home page: "/", "/en", "/en-us", "/index.html". */
const isHome = (u) => /^\/(?:[a-z]{2}(?:[-_][a-z]{2,4})?)?$/i.test(pathKey(u));
/** Registrable-ish domain (last two labels, three for co.uk-style). Good enough to tell "another site". */
function siteKey(u) {
  const parts = hostKey(u).split('.');
  if (parts.length <= 2) return parts.join('.');
  const two = parts.slice(-2).join('.');
  return /^(?:co|com|org|net|gov|edu|ac|ne|or)\.[a-z]{2}$/.test(two) ? parts.slice(-3).join('.') : two;
}

function toRegExp(t) {
  if (t == null || t === '') return null;
  if (t instanceof RegExp) return new RegExp(t.source, t.flags.replace(/[gy]/g, ''));
  if (typeof t === 'object' && t.source != null) return new RegExp(t.source, String(t.flags || '').replace(/[gy]/g, ''));
  return new RegExp(String(t), 'i');
}

/**
 * Normalise `expect` into [{ selector, min, max, text }]. Accepts:
 *   'h1'                       at least one h1
 *   '.item >= 10'              at least 10
 *   { selector, min, max, text }   text: RegExp (or its source) the element text must match, e.g. /\d/ for a price
 *   { text: /In stock/ }       no selector: the page text must match
 */
export function normalizeExpect(expect) {
  if (!expect) return [];
  const list = Array.isArray(expect) ? expect : [expect];
  return list
    .map((e) => {
      if (typeof e === 'string') {
        const m = /^(.*?)\s+(>=|=)\s*(\d+)\s*$/.exec(e);
        if (m) return { selector: m[1].trim(), min: Number(m[3]), max: m[2] === '=' ? Number(m[3]) : null, text: null };
        return { selector: e.trim(), min: 1, max: null, text: null };
      }
      if (e && typeof e === 'object') {
        const text = e.text != null ? toRegExp(e.text) : null;
        return { selector: e.selector ? String(e.selector) : null, min: e.min != null ? Number(e.min) : 1, max: e.max != null ? Number(e.max) : null, text, label: e.label || null };
      }
      return null;
    })
    .filter((e) => e && (e.selector || e.text));
}

/** Expect entries derived from a reference fingerprint: every selector the good page had must be there again. */
function expectFromReference(reference) {
  const refs = Array.isArray(reference) ? reference : reference ? [reference] : [];
  const seen = new Map();
  for (const r of refs)
    for (const e of (r && r.expect) || []) {
      if (!e.selector || e.count <= 0) continue;
      const min = Math.max(1, Math.floor(e.count * 0.2));
      if (!seen.has(e.selector) || seen.get(e.selector).min > min) seen.set(e.selector, { selector: e.selector, min, max: null, text: null, fromReference: true });
    }
  return [...seen.values()];
}

function normClass(c) {
  // Hashed CSS-module classes (css-1x2y3z, sc-AxjAm) keep their stable prefix.
  return c
    .toLowerCase()
    .replace(/[0-9]+/g, '#')
    .replace(/^(css|sc|jsx|svelte|emotion|styled|chakra|mui[a-z]*)-[a-z#_-]{4,}$/, '$1-*')
    .slice(0, 48);
}

function topN(map, n) {
  return Object.fromEntries(
    Object.entries(map)
      .sort((a, b) => b[1] - a[1])
      .slice(0, n),
  );
}

// ───────────────────────────── Snapshots ─────────────────────────────

/** Walk the body and count what a fingerprint and the checks need. `ad` adapts DOM nodes or parsed HTML nodes. */
/** Site chrome (header, footer, menus): the same on every page, so fingerprints leave it out. */
const CHROME_TAGS = { header: 1, footer: 1, nav: 1, aside: 1 };
const CHROME_ROLES = { banner: 1, contentinfo: 1, navigation: 1, complementary: 1 };
const CHROME_NAME = /^(?:(?:site|page|global|main|top|bottom)[-_]?)?(?:header|footer|nav|navbar|navigation|menu|menubar|megamenu|sidebar|masthead|breadcrumbs?|cookie[-_]?(?:banner|notice|consent))$/i;
function isChrome(ad, k, tag) {
  if (CHROME_TAGS[tag]) return true;
  const role = ad.attr(k, 'role');
  if (role && CHROME_ROLES[role]) return true;
  const id = ad.attr(k, 'id');
  if (id && CHROME_NAME.test(id)) return true;
  const cls = ad.attr(k, 'class');
  return !!cls && String(cls).split(/\s+/).some((c) => CHROME_NAME.test(c));
}

function walkBody(body, ad) {
  const counts = { elements: 0, contentElements: 0, contentLinks: 0, links: 0, images: 0, forms: 0, inputs: 0, passwordInputs: 0, buttons: 0, tables: 0, listItems: 0, headings: 0, iframes: 0, videos: 0 };
  const tags = {};
  const classes = {};
  let skeletons = 0;
  const h1 = [];
  const h2 = [];
  if (!body) return { counts, tags, classes, skeletons, h1, h2 };
  const stack = [[body, 'body', false]];
  while (stack.length && counts.elements < MAX_WALK) {
    const [node, parentTag, inChrome] = stack.pop();
    const kids = ad.kids(node);
    for (let i = kids.length - 1; i >= 0; i--) {
      const k = kids[i];
      const tag = ad.tag(k);
      if (!tag || tag === 'script' || tag === 'style' || tag === 'noscript' || tag === 'template' || tag === 'link' || tag === 'meta') continue;
      counts.elements++;
      const chrome = inChrome || isChrome(ad, k, tag);
      const cls = ad.attr(k, 'class');
      if (!chrome) {
        counts.contentElements++;
        const pair = parentTag + '>' + tag;
        tags[pair] = (tags[pair] || 0) + 1;
        if (cls) for (const c of String(cls).split(/\s+/)) if (c) classes[normClass(c)] = (classes[normClass(c)] || 0) + 1;
        if (tag === 'a' && ad.attr(k, 'href')) counts.contentLinks++;
      }
      if (cls && SKELETON.test(cls)) skeletons++;
      if (ad.attr(k, 'aria-busy') === 'true') skeletons++;
      switch (tag) {
        case 'a':
          if (ad.attr(k, 'href')) counts.links++;
          break;
        case 'img':
          counts.images++;
          break;
        case 'form':
          counts.forms++;
          break;
        case 'input': {
          const type = String(ad.attr(k, 'type') || 'text').toLowerCase();
          if (type === 'password') counts.passwordInputs++;
          // A submit button is a button, not a field to fill in.
          if (type === 'submit' || type === 'button' || type === 'image' || type === 'reset') counts.buttons++;
          else if (type !== 'hidden') counts.inputs++;
          break;
        }
        case 'textarea':
        case 'select':
          counts.inputs++;
          break;
        case 'button':
          counts.buttons++;
          break;
        case 'table':
          counts.tables++;
          break;
        case 'li':
          counts.listItems++;
          break;
        case 'iframe':
          counts.iframes++;
          break;
        case 'video':
          counts.videos++;
          break;
        case 'h1':
        case 'h2':
        case 'h3':
        case 'h4':
        case 'h5':
        case 'h6': {
          counts.headings++;
          const list = tag === 'h1' ? h1 : tag === 'h2' ? h2 : null;
          if (list && list.length < 3 && !ad.hidden(k)) {
            const t = short(ad.text(k), 160);
            if (t) list.push(t);
          }
          break;
        }
        default:
      }
      stack.push([k, tag, chrome]);
    }
  }
  return { counts, tags: topN(tags, TOP_TAGS), classes: topN(classes, TOP_CLASSES), skeletons, h1, h2 };
}

function evalExpect(list, queryAll, textOfEl, pageText) {
  return list.map((e) => {
    const out = { selector: e.selector, min: e.min, max: e.max, text: e.text ? String(e.text) : null, count: 0, ok: false, sample: null };
    if (e.label) out.label = e.label;
    if (e.fromReference) out.fromReference = true;
    try {
      if (!e.selector) {
        out.count = e.text.test(pageText) ? 1 : 0;
      } else {
        let els = queryAll(e.selector);
        if (e.text) els = els.filter((x) => e.text.test(textOfEl(x)));
        out.count = els.length;
        if (els.length) out.sample = short(textOfEl(els[0]), 80) || null;
      }
      out.ok = out.count >= e.min && (e.max == null || out.count <= e.max);
    } catch (err) {
      out.error = String((err && err.message) || err);
    }
    return out;
  });
}

function baseSnapshot(opts) {
  const headers = lowerHeaders(opts.headers);
  return {
    requestedUrl: opts.requestedUrl || '',
    status: opts.status != null && opts.status !== '' ? Number(opts.status) : null,
    headers,
  };
}

/** Build a snapshot from an HTML string (Node, workers, anywhere). opts: url, requestedUrl, status, headers, expect, reference */
export function snapshotFromHtml(html, opts = {}) {
  html = String(html == null ? '' : html);
  const { root, all } = parseHtml(html);
  const find = (tag) => all.filter((n) => n.tag === tag);
  const body = find('body')[0] || root;
  const ad = {
    kids: (n) => n.children.filter((c) => typeof c !== 'string'),
    tag: (n) => n.tag,
    attr: (n, a) => (n.attrs[a] != null ? n.attrs[a] : null),
    hidden: (n) => hiddenByMarkup(n),
    text: (n) => cleanText(textOf(n).join('')),
  };
  const walked = walkBody(body, ad);
  const text = cleanText(textOf(body).join('')).slice(0, MAX_TEXT);
  const titleEl = find('title')[0];
  const metas = find('meta');
  const meta = (name) => {
    const m = metas.find((x) => (x.attrs.name || x.attrs.property || '').toLowerCase() === name);
    return m ? m.attrs.content || '' : '';
  };
  const refresh = metas.find((x) => (x.attrs['http-equiv'] || '').toLowerCase() === 'refresh');
  const canonical = find('link').find((l) => /\bcanonical\b/i.test(l.attrs.rel || ''));
  const noscript = find('noscript')
    .filter((n) => {
      for (let p = n.parent; p; p = p.parent) if (p.tag === 'head') return false;
      return true;
    })
    .map((n) => cleanText((n.raw || '').replace(/<[^>]*>/g, ' ')))
    .join(' ');
  let appRoot = null;
  for (const n of all) {
    if ((n.attrs.id && APP_ROOTS.includes(n.attrs.id)) || n.tag === 'app-root') {
      const t = cleanText(textOf(n).join(''));
      appRoot = { id: n.attrs.id || n.tag, textLength: t.length, children: ad.kids(n).length };
      break;
    }
  }
  const s = {
    mode: 'html',
    url: opts.url || '',
    ...baseSnapshot(opts),
    title: titleEl ? cleanText(titleEl.raw || '') : '',
    h1: walked.h1,
    h2: walked.h2,
    text,
    textLength: text.replace(/\s+/g, ' ').length,
    htmlLength: html.length,
    scripts: find('script').length,
    counts: walked.counts,
    tags: walked.tags,
    classes: walked.classes,
    skeletons: walked.skeletons,
    canonical: canonical ? canonical.attrs.href || '' : '',
    ogUrl: meta('og:url'),
    robots: meta('robots'),
    refresh: refresh ? refresh.attrs.content || '' : '',
    noscript,
    appRoot,
  };
  const exp = normalizeExpect(opts.expect).concat(opts.expect ? [] : expectFromReference(opts.reference));
  s.expect = exp.length ? evalExpect(exp, (sel) => querySelectorAll(all, sel), (n) => cleanText(textOf(n).join('')), text) : [];
  return s;
}

/** Build a snapshot from a live page (browser, extension, Playwright evaluate). */
export function snapshotFromDom(win, opts = {}) {
  win = win || (typeof window !== 'undefined' ? window : null);
  if (!win || !win.document) throw new Error('block-detector: no window/document; use detectHtml() outside a browser');
  const doc = win.document;
  const body = doc.body;
  const visible = (el) => {
    try {
      if (typeof el.checkVisibility === 'function') return el.checkVisibility({ opacityProperty: true, visibilityProperty: true });
      const cs = win.getComputedStyle(el);
      return cs.display !== 'none' && cs.visibility !== 'hidden';
    } catch (_) {
      return true;
    }
  };
  const elText = (el) => cleanText(el.innerText != null ? el.innerText : el.textContent || '');
  const ad = {
    kids: (n) => n.children || [],
    tag: (n) => (n.tagName ? n.tagName.toLowerCase() : ''),
    attr: (n, a) => (n.getAttribute ? n.getAttribute(a) : null),
    hidden: (n) => !visible(n),
    text: elText,
  };
  const walked = walkBody(body, ad);
  let text = '';
  try {
    text = cleanText(body ? body.innerText || body.textContent || '' : '').slice(0, MAX_TEXT);
  } catch (_) {
    /* ignore */
  }
  const q = (sel) => {
    try {
      return doc.querySelector(sel);
    } catch (_) {
      return null;
    }
  };
  const metaContent = (sel) => {
    const m = q(sel);
    return m ? m.getAttribute('content') || '' : '';
  };
  const canonical = q('link[rel~="canonical"]');
  let noscript = '';
  try {
    noscript = [...(body ? body.querySelectorAll('noscript') : [])].map((n) => cleanText((n.textContent || '').replace(/<[^>]*>/g, ' '))).join(' ');
  } catch (_) {
    /* ignore */
  }
  let appRoot = null;
  for (const id of APP_ROOTS) {
    const n = doc.getElementById(id);
    if (n && n !== body) {
      appRoot = { id, textLength: elText(n).length, children: n.children.length };
      break;
    }
  }
  if (!appRoot) {
    const n = q('app-root');
    if (n) appRoot = { id: 'app-root', textLength: elText(n).length, children: n.children.length };
  }
  let htmlLength = 0;
  try {
    htmlLength = doc.documentElement.outerHTML.length;
  } catch (_) {
    /* ignore */
  }
  let url = '';
  try {
    url = win.location.href;
  } catch (_) {
    /* ignore */
  }
  const s = {
    mode: 'dom',
    url,
    ...baseSnapshot(opts),
    title: cleanText(doc.title || ''),
    h1: walked.h1,
    h2: walked.h2,
    text,
    textLength: text.replace(/\s+/g, ' ').length,
    htmlLength,
    scripts: doc.scripts ? doc.scripts.length : 0,
    counts: walked.counts,
    tags: walked.tags,
    classes: walked.classes,
    skeletons: walked.skeletons,
    canonical: canonical ? canonical.getAttribute('href') || '' : '',
    ogUrl: metaContent('meta[property="og:url"]'),
    robots: metaContent('meta[name="robots" i]'),
    refresh: metaContent('meta[http-equiv="refresh" i]'),
    noscript,
    appRoot,
  };
  const exp = normalizeExpect(opts.expect).concat(opts.expect ? [] : expectFromReference(opts.reference));
  s.expect = exp.length
    ? evalExpect(
        exp,
        (sel) => [...doc.querySelectorAll(sel)],
        (el) => elText(el),
        text,
      )
    : [];
  return s;
}

// ───────────────────────────── Fingerprints ─────────────────────────────

/** A small JSON fingerprint of a page you know is good. Save it, then pass it as `reference` when checking others. */
export function fingerprintOf(s) {
  return {
    v: 1,
    url: s.url || '',
    title: s.title || '',
    textLength: s.textLength,
    counts: { links: s.counts.links, contentLinks: s.counts.contentLinks, contentElements: s.counts.contentElements, images: s.counts.images, headings: s.counts.headings, listItems: s.counts.listItems, tables: s.counts.tables, forms: s.counts.forms, inputs: s.counts.inputs, elements: s.counts.elements },
    tags: s.tags,
    classes: s.classes,
    expect: (s.expect || []).filter((e) => e.selector && !e.error).map((e) => ({ selector: e.selector, count: e.count })),
  };
}

function cosine(a, b) {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (const k of Object.keys(a)) {
    const x = Math.log1p(a[k]);
    na += x * x;
    if (b[k]) dot += x * Math.log1p(b[k]);
  }
  for (const k of Object.keys(b)) {
    const y = Math.log1p(b[k]);
    nb += y * y;
  }
  if (!na && !nb) return 1;
  if (!na || !nb) return 0;
  return dot / Math.sqrt(na * nb);
}

/** 1 when equal; drops as `cur` gets smaller than `ref`; up to `grow` times bigger still counts as 1. */
function sizeScore(cur, ref, grow = 3) {
  cur = cur || 0;
  ref = ref || 0;
  if (ref <= 0) return 1;
  const r = cur / ref;
  if (r >= 1) return r <= grow ? 1 : Math.sqrt(grow / r);
  return Math.sqrt(r);
}

const round = (x) => Math.round(x * 1000) / 1000;

/**
 * How similar is a page to a reference fingerprint (or a list of them, best match wins)? 0..1.
 * `page` is a snapshot, a fingerprint, or a detect() result's fingerprint.
 */
export function compare(reference, page) {
  const refs = (Array.isArray(reference) ? reference : [reference]).filter(Boolean);
  if (!refs.length) throw new Error('block-detector: compare() needs a reference fingerprint');
  const cur = page && page.v ? page : fingerprintOf(page);
  let best = null;
  for (const ref of refs) {
    const parts = {
      classes: round(cosine(ref.classes || {}, cur.classes || {})),
      structure: round(cosine(ref.tags || {}, cur.tags || {})),
      text: round(sizeScore(cur.textLength, ref.textLength)),
      links: round(sizeScore(cur.counts.contentLinks, ref.counts.contentLinks)),
    };
    // A page with no classes at all (plain HTML) is judged on structure alone.
    const noClasses = !Object.keys(ref.classes || {}).length && !Object.keys(cur.classes || {}).length;
    const similarity = noClasses ? 0.55 * parts.structure + 0.3 * parts.text + 0.15 * parts.links : 0.35 * parts.classes + 0.3 * parts.structure + 0.2 * parts.text + 0.15 * parts.links;
    const r = { similarity: round(similarity), parts, textRatio: ref.textLength ? round((cur.textLength || 0) / ref.textLength) : null, referenceUrl: ref.url || '' };
    if (!best || r.similarity > best.similarity) best = r;
  }
  return best;
}

// ───────────────────────────── Analysis ─────────────────────────────

/** How much to trust wording found in the visible text, by page length (block pages are short). */
function textWeight(len) {
  if (len <= 800) return 0.8;
  if (len <= 2000) return 0.7;
  if (len <= 4000) return 0.55;
  if (len <= 8000) return 0.4;
  return 0;
}

function matchRule(list, str) {
  for (const p of list) {
    const re = Array.isArray(p) ? p[0] : p;
    const w = Array.isArray(p) ? p[1] : 1;
    const m = re.exec(str);
    if (m) return { w, match: m[0] };
  }
  return null;
}

/** The sentence around a match, for evidence. */
function around(text, match) {
  const i = text.indexOf(match);
  if (i < 0) return short(match);
  const start = Math.max(0, text.lastIndexOf('\n', i) + 1, i - 80);
  let end = text.indexOf('\n', i + match.length);
  if (end < 0 || end - i > 120) end = Math.min(text.length, i + match.length + 80);
  return short(text.slice(start, end), 160);
}

function addTo(found, reason, confidence, type, value) {
  if (!(confidence > 0)) return;
  (found[reason] || (found[reason] = [])).push({ confidence: Math.min(0.99, confidence), type, value: short(value, 200) });
}

function checkText(s, found) {
  const headline = [s.title, ...s.h1, ...s.h2.slice(0, 1)].filter(Boolean).join('\n');
  const tw = textWeight(s.textLength);
  // A heading can name a film or a book ("Access Denied"), so on a long page it counts for less.
  const hw = s.textLength <= 3000 ? 0.85 : s.textLength <= 8000 ? 0.65 : 0.4;
  const text = s.text.length > 8000 ? s.text.slice(0, 8000) : s.text;
  for (const rule of RULES) {
    if (rule.whole) {
      if (s.textLength < 120 && rule.whole.test(s.text)) addTo(found, rule.reason, 0.6, 'text', s.text);
      continue;
    }
    const h = matchRule(rule.patterns, headline) || (rule.headlineOnly && matchRule(rule.headlineOnly, headline));
    if (h) addTo(found, rule.reason, hw * h.w, 'headline', around(headline, h.match));
    if (tw) {
      const t = matchRule(rule.patterns, text);
      if (t) addTo(found, rule.reason, tw * t.w, 'text', around(text, t.match));
    }
  }
}

function checkStructure(s, found) {
  const len = s.textLength;
  const jsRule = RULES.find((r) => r.reason === 'js-shell');
  let shell = false;
  if (s.appRoot && s.appRoot.textLength < 20 && len < 300) {
    shell = true;
    addTo(found, 'js-shell', s.mode === 'dom' ? 0.7 : 0.75, 'structure', `#${s.appRoot.id} is empty (${s.appRoot.children} child elements)`);
  }
  if (s.noscript && len < 500 && matchRule(jsRule.patterns, s.noscript)) {
    shell = true;
    addTo(found, 'js-shell', 0.8, 'noscript', s.noscript);
  }
  if (s.mode === 'html' && len < 150 && s.scripts >= 3 && !shell) {
    shell = true;
    addTo(found, 'js-shell', 0.6, 'structure', `${len} characters of text and ${s.scripts} scripts`);
  }
  if (s.skeletons >= 3 && len < 600) addTo(found, 'loading', 0.65, 'structure', `${s.skeletons} loading placeholders and ${len} characters of text`);
  if (/\bnoindex\b/i.test(s.robots) && len < 2000) addTo(found, 'not-found', 0.3, 'meta', `robots: ${s.robots}`);
}

/**
 * A gate: a short page whose only content is a form with no fields to fill in (hidden values only) and a button,
 * "click to continue" (Amazon's "continue shopping" check, consent and age gates, many bot checks). Real pages have
 * text and links around their forms.
 */
function checkGate(s, found) {
  const c = s.counts;
  if (s.textLength >= 400 || !c.forms || c.inputs || !c.buttons || c.passwordInputs || c.links > 8) return;
  addTo(found, 'challenge', 0.65, 'structure', `a gate page: ${s.textLength} characters of text and a form with only hidden fields and ${c.buttons === 1 ? 'a button' : `${c.buttons} buttons`}`);
}

/** Words of an address that say nothing about the page itself. */
const PATH_STOP = new Set(['html', 'shtml', 'php', 'aspx', 'index', 'default', 'page', 'pages', 'product', 'products', 'item', 'items', 'detail', 'details', 'view', 'show', 'category', 'categories', 'catalog', 'shop', 'store', 'search', 'list', 'listing', 'listings', 'browse', 'with', 'from', 'your', 'this', 'that', 'what', 'news', 'blog', 'post', 'posts', 'article', 'articles', 'story', 'stories', 'main', 'home', 'info', 'amp', 'mobile', 'desktop', 'www', 'online', 'official', 'best', 'sellers', 'bestsellers', 'deals', 'sale', 'buy']);

/** The words an address names (its path, not ids), e.g. /Wearable-Blanket-Sherpa/dp/B0F… → wearable, blanket, sherpa. */
export function addressWords(url) {
  const u = parseUrl(url);
  if (!u) return [];
  let path = u.pathname;
  try {
    path = decodeURIComponent(path);
  } catch (_) {
    /* keep it encoded */
  }
  const site = new Set(u.hostname.toLowerCase().split(/[^\p{L}\p{N}]+/u));
  const words = new Set();
  for (const seg of path.split('/')) {
    // A segment with digits and no word breaks is an id (B0FGTRB7ZG, 123456, ref=zg_bs_1).
    if (/\d/.test(seg) && !/[-_ +]/.test(seg)) continue;
    if (seg.includes('=')) continue;
    for (const w of seg.toLowerCase().split(/[^\p{L}]+/u)) {
      const latin = /^[a-z]+$/.test(w);
      if (latin ? w.length < 4 : w.length < 2) continue;
      if (PATH_STOP.has(w) || site.has(w)) continue;
      words.add(w);
    }
  }
  return [...words].slice(0, 12);
}

/**
 * Relevance: an address that names what it is about (2+ words in its path) and a page that says none of them, in its
 * title, headings or text, is a stand-in page. Counted strongly only on short pages (real pages are rarely short).
 */
function checkRelevance(s, found) {
  const words = addressWords(s.requestedUrl || s.url);
  if (words.length < 2) return;
  const hay = [s.title, ...s.h1, ...s.h2, s.text.slice(0, 50000)].join(' ').toLowerCase();
  const seen = (w) => hay.includes(w) || (w.length > 5 && hay.includes(w.replace(/(?:ies|es|s)$/, '')));
  if (words.some(seen)) return;
  addTo(found, 'different', s.textLength < 1500 ? 0.6 : 0.35, 'address', `none of "${words.slice(0, 5).join(' ')}" from the address is on the page`);
}

/** Blank: the fallback when nothing else explains a page with (almost) no text, media or form fields. Runs last. */
function checkBlank(s, found) {
  const len = s.textLength;
  const explained = Object.values(found).some((list) => list.some((e) => e.confidence >= 0.5));
  if (!explained && len < 40 && !s.counts.images && !s.counts.videos && !s.counts.iframes && !s.counts.inputs) {
    addTo(found, 'empty', s.htmlLength < 400 ? 0.85 : 0.75, 'structure', len ? `only "${short(s.text, 60)}"` : 'no visible text');
  }
}

function checkUrls(s, found) {
  const final = parseUrl(s.url);
  const req = parseUrl(s.requestedUrl, s.url || undefined);
  const reqIsLogin = req && LOGIN_PATH.test(req.pathname);
  if (final && req) {
    const same = hostKey(final) === hostKey(req) && pathKey(final) === pathKey(req);
    if (!same) {
      const from = short(req.href, 90);
      const to = short(final.href, 90);
      const finalPath = final.pathname + final.search;
      if (BLOCK_PATH.test(finalPath) && !BLOCK_PATH.test(req.pathname + req.search)) addTo(found, 'redirected', 0.85, 'url', `${from} → ${to} (a block or check page)`);
      else if (LOGIN_PATH.test(final.pathname) && !reqIsLogin) addTo(found, 'login', 0.85, 'url', `${from} → ${to} (a sign-in page)`);
      else if (isHome(final) && !isHome(req) && siteKey(final) === siteKey(req)) addTo(found, 'redirected', 0.8, 'url', `${from} → ${to} (the home page)`);
      else if (siteKey(final) !== siteKey(req)) addTo(found, 'redirected', 0.55, 'url', `${from} → ${to} (another site)`);
      else addTo(found, 'redirected', 0.25, 'url', `${from} → ${to}`);
    }
  } else if (final && LOGIN_PATH.test(final.pathname) && s.counts.passwordInputs) {
    addTo(found, 'login', 0.6, 'url', `${short(final.href, 90)} is a sign-in page`);
  }
  const page = req || final;
  // A deep page whose canonical URL is the site's home page is usually a stand-in page.
  const canon = parseUrl(s.canonical, s.url || undefined);
  if (page && canon && isHome(canon) && !isHome(page) && siteKey(canon) === siteKey(page)) addTo(found, 'redirected', 0.45, 'canonical', `canonical is ${short(canon.href, 90)}`);
  if (s.refresh) {
    const m = /url\s*=\s*['"]?([^'";]+)/i.exec(s.refresh);
    const target = m && parseUrl(m[1], s.url || undefined);
    if (target && (!final || target.href !== final.href)) {
      if (BLOCK_PATH.test(target.pathname + target.search)) addTo(found, 'redirected', 0.85, 'meta-refresh', `refresh to ${short(target.href, 90)} (a block or check page)`);
      else if (s.textLength < 500) addTo(found, 'redirected', 0.6, 'meta-refresh', `refresh to ${short(target.href, 90)}`);
    }
  }
  // Password field on a short page that is not a sign-in page you asked for.
  if (s.counts.passwordInputs && s.textLength < 2500 && !reqIsLogin && !(final && !req && LOGIN_PATH.test(final.pathname))) addTo(found, 'login', 0.65, 'structure', 'a password field on a short page');
}

function checkHttp(s, found) {
  const h = s.headers;
  const st = s.status;
  if (st === 429) addTo(found, 'rate-limit', 0.9, 'status', 'HTTP 429');
  else if (st === 403) addTo(found, 'access-denied', 0.8, 'status', 'HTTP 403');
  else if (st === 401 || st === 407) addTo(found, 'login', 0.75, 'status', `HTTP ${st}`);
  else if (st === 404 || st === 410) addTo(found, 'not-found', 0.9, 'status', `HTTP ${st}`);
  else if (st >= 500 && st <= 599) addTo(found, 'error', 0.8, 'status', `HTTP ${st}`);
  if (/\bchallenge\b/i.test(h['cf-mitigated'] || '')) addTo(found, 'challenge', 0.95, 'header', `cf-mitigated: ${h['cf-mitigated']}`);
  const waf = h['x-amzn-waf-action'] || '';
  if (/captcha|challenge/i.test(waf)) addTo(found, 'challenge', 0.9, 'header', `x-amzn-waf-action: ${waf}`);
  else if (/block/i.test(waf)) addTo(found, 'access-denied', 0.9, 'header', `x-amzn-waf-action: ${waf}`);
  if (h['x-sucuri-block']) addTo(found, 'access-denied', 0.9, 'header', `x-sucuri-block: ${h['x-sucuri-block']}`);
  if (h['retry-after'] && (st == null || st < 300) && s.textLength < 3000) addTo(found, 'rate-limit', 0.5, 'header', `retry-after: ${h['retry-after']}`);
}

function checkCaptcha(s, cd, found) {
  if (!cd || !Array.isArray(cd.detections)) return;
  for (const d of cd.detections) {
    const what = `${d.name}${d.subtype ? ` (${d.subtype})` : ''}`;
    // Generic rules match wording only, so a good reference match can overrule them like our own wording rules.
    const type = /^generic/.test(d.id || '') ? 'captcha-wording' : 'captcha-detector';
    const label = (kind) => (/\bpage\b/i.test(what) ? what : `${what} ${kind}`);
    if (d.kind === 'challenge-page') addTo(found, 'challenge', d.confidence, type, label('challenge page'));
    else if (d.kind === 'block-page') addTo(found, 'access-denied', d.confidence, type, label('block page'));
    else if ((d.kind === 'widget' || d.kind === 'image' || d.kind === 'question') && d.visible !== false && s.textLength < 3000)
      addTo(found, 'challenge', Math.min(d.confidence, 0.7), type, `${what} on a short page`);
  }
}

function checkExpect(s, found) {
  const list = (s.expect || []).filter((e) => !e.error);
  if (!list.length) return;
  const failed = list.filter((e) => !e.ok);
  if (!failed.length) return;
  const own = failed.filter((e) => !e.fromReference);
  const frac = failed.length / list.length;
  const conf = own.length ? 0.6 + 0.35 * frac : 0.5 + 0.3 * frac;
  const desc = failed
    .slice(0, 4)
    .map((e) => `${e.selector || 'page text'}${e.text ? ` ~ ${e.text}` : ''}: ${e.count}${e.max != null ? `/${e.min}-${e.max}` : ` (need ${e.min})`}`)
    .join('; ');
  addTo(found, 'stripped', conf, own.length ? 'expect' : 'reference-expect', desc);
}

function checkReference(s, reference, found) {
  const cmp = compare(reference, s);
  const sim = cmp.similarity;
  if (sim < 0.35) addTo(found, 'different', 0.85, 'reference', `similarity ${sim} to the reference`);
  else if (sim < 0.5) addTo(found, 'different', 0.7, 'reference', `similarity ${sim} to the reference`);
  else if (sim < 0.65) addTo(found, 'different', 0.45, 'reference', `similarity ${sim} to the reference`);
  if (cmp.textRatio != null && cmp.textRatio < 0.25) {
    const refs = Array.isArray(reference) ? reference : [reference];
    if (Math.max(...refs.map((r) => r.textLength || 0)) > 500) addTo(found, 'stripped', 0.7, 'reference', `only ${Math.round(cmp.textRatio * 100)}% of the reference text`);
  }
  return cmp;
}

function combine(list) {
  // Independent signals add up a little; the strongest one leads.
  const sorted = list.slice().sort((a, b) => b.confidence - a.confidence);
  let miss = 1;
  for (const e of sorted) miss *= 1 - e.confidence;
  const top = sorted[0].confidence;
  return Math.min(0.99, top + 0.1, 1 - miss);
}

/**
 * Score a snapshot. Options:
 *   threshold   0..1, default 0.5 — a reason counts at or above this
 *   reference   a fingerprint (or a list) of a good page of the same kind
 *   captcha     a captcha-detector result for the same page (detect()/detectHtml() fill it in when registered)
 */
export function analyze(s, opts = {}) {
  const threshold = opts.threshold != null ? Number(opts.threshold) : DEFAULT_THRESHOLD;
  const found = {};
  checkHttp(s, found);
  checkText(s, found);
  checkStructure(s, found);
  checkUrls(s, found);
  checkCaptcha(s, opts.captcha, found);
  checkGate(s, found);
  checkRelevance(s, found);
  checkExpect(s, found);
  const reference = opts.reference && (!Array.isArray(opts.reference) || opts.reference.length) ? opts.reference : null;
  const cmp = reference ? checkReference(s, reference, found) : null;
  checkBlank(s, found);

  // A page that matches its reference well and passes every expect check is the real page: wording alone
  // (a product named "Access Denied", a review saying "something went wrong") does not overturn that.
  const strongOk = cmp && cmp.similarity >= 0.75 && !(s.expect || []).some((e) => !e.ok && !e.error);
  const all = Object.entries(found).map(([reason, evidence]) => {
    let confidence = combine(evidence);
    if (strongOk && evidence.every((e) => WORDING[e.type])) confidence = Math.min(confidence, threshold - 0.05);
    return { reason, confidence: round(confidence), blocking: !NOT_BLOCK[reason], description: REASONS[reason], evidence: evidence.sort((a, b) => b.confidence - a.confidence).map((e) => ({ ...e, confidence: round(e.confidence) })) };
  });
  all.sort((a, b) => b.confidence - a.confidence);
  const detections = all.filter((d) => d.confidence >= threshold);
  const hints = all.filter((d) => d.confidence < threshold);
  const top = detections[0] || null;
  const result = {
    ok: !top,
    // Blocked when the main reason is a block, or a block signal is strong on its own (a 404 page that also says
    // "log in to edit" is a 404, not a sign-in wall).
    blocked: detections.some((d) => d.blocking && (d === detections[0] || d.confidence >= 0.7)),
    reason: top ? top.reason : null,
    confidence: top ? top.confidence : 0,
    summary: '',
    detections,
    hints,
    expect: s.expect || [],
    reference: cmp,
    captcha: opts.captcha ? { captcha: !!opts.captcha.captcha, challengePage: !!opts.captcha.challengePage, blocked: !!opts.captcha.blocked, summary: opts.captcha.summary || '' } : null,
    page: { url: s.url, requestedUrl: s.requestedUrl, status: s.status, title: s.title, textLength: s.textLength, links: s.counts.links, images: s.counts.images, elements: s.counts.elements },
    mode: s.mode,
    version: VERSION,
  };
  Object.defineProperty(result, 'fingerprint', { value: fingerprintOf(s), enumerable: false });
  result.summary = summarize(result);
  return result;
}

function summarize(r) {
  if (r.ok) {
    const extra = [];
    if (r.reference) extra.push(`similarity ${r.reference.similarity} to the reference`);
    const exp = r.expect.filter((e) => !e.error);
    if (exp.length) extra.push(`${exp.length}/${exp.length} expected elements found`);
    return `OK: looks like the real page${extra.length ? ` (${extra.join(', ')})` : ''}`;
  }
  const head = r.blocked ? 'Blocked' : 'Not the real page';
  const parts = r.detections.slice(0, 3).map((d) => `${d.reason} ${d.confidence}${d.evidence[0] ? ` — ${short(d.evidence[0].value, 90)}` : ''}`);
  return `${head}: ${parts.join('; ')}`;
}

// ───────────────────────────── Public entry points ─────────────────────────────

function runCaptcha(opts, fn) {
  if (opts.captcha !== undefined || opts.useCaptchaDetector === false) return opts.captcha || null;
  const cd = opts.captchaDetector || captchaDetector || (typeof globalThis !== 'undefined' && globalThis.CaptchaDetector) || null;
  if (!cd) return null;
  try {
    return fn(cd);
  } catch (_) {
    return null;
  }
}

/**
 * Check the current page (browser, extension, Playwright evaluate). Options:
 *   requestedUrl  the URL you asked for (to catch redirects); default: none
 *   status, headers  the HTTP response status and headers, if you have them
 *   expect        selectors the real page must have, e.g. ['h1', '.price', '.item >= 10']
 *   reference     a fingerprint (or a list) of a good page of the same kind
 *   threshold     0..1, default 0.5
 *   window        the window to check (default: the global window)
 */
export function detect(opts = {}) {
  const s = snapshotFromDom(opts.window, opts);
  const captcha = runCaptcha(opts, (cd) => cd.detect({ window: opts.window, status: opts.status, headers: opts.headers }));
  return analyze(s, { ...opts, captcha });
}

/** Check an HTML string. Same options as detect(), plus url (the final URL the HTML came from). */
export function detectHtml(html, opts = {}) {
  const s = snapshotFromHtml(html, opts);
  const captcha = runCaptcha(opts, (cd) => cd.detectHtml(html, { url: opts.url, status: opts.status, headers: opts.headers }));
  return analyze(s, { ...opts, captcha });
}

/**
 * Check what an HTTP client returned: a fetch Response, an axios/got-style response ({ data | body, status, headers }),
 * or an HTML string. Returns a Promise. Pass requestedUrl to catch redirects (fetch follows them silently).
 */
export async function detectResponse(input, opts = {}) {
  let html = input;
  let status;
  let headers;
  let url;
  if (input && typeof input === 'object' && typeof input.text === 'function' && 'status' in input) {
    const r = typeof input.clone === 'function' && !input.bodyUsed ? input.clone() : input;
    html = await r.text();
    status = input.status;
    headers = input.headers;
    url = input.url;
  } else if (input && typeof input === 'object' && ('data' in input || 'body' in input)) {
    html = 'data' in input ? input.data : input.body;
    status = input.status != null ? input.status : input.statusCode;
    headers = input.headers;
    url = (input.request && input.request.res && input.request.res.responseUrl) || input.url;
  }
  if (html != null && typeof html !== 'string') html = typeof html === 'object' && !(html instanceof Uint8Array) ? JSON.stringify(html) : new TextDecoder().decode(html);
  return detectHtml(html, { ...opts, url: opts.url || url || '', status: opts.status != null ? opts.status : status, headers: opts.headers || headers });
}

/** Fingerprint the current page (browser). opts.expect: selectors to record counts for. */
export function fingerprint(opts = {}) {
  return fingerprintOf(snapshotFromDom(opts.window, opts));
}

/** Fingerprint an HTML string. opts: url, expect. */
export function fingerprintHtml(html, opts = {}) {
  return fingerprintOf(snapshotFromHtml(html, opts));
}
