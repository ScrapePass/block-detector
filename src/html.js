// A small, forgiving HTML parser and CSS selector engine, so pages can be checked as raw HTML outside a browser
// (Node, workers, Deno, Bun) with no dependencies. It builds a light tree that is good enough for counting
// elements, reading text and matching selectors; it does not try to be a full HTML5 parser.

const VOID = { area: 1, base: 1, br: 1, col: 1, embed: 1, hr: 1, img: 1, input: 1, link: 1, meta: 1, param: 1, source: 1, track: 1, wbr: 1 };
/** Elements whose content is raw text, not markup. */
const RAW = { script: 1, style: 1, textarea: 1, title: 1, noscript: 1, template: 1, xmp: 1, iframe: 1, noembed: 1, noframes: 1 };
/** Opening one of these closes an open <p>. */
const CLOSES_P = {};
'address article aside blockquote details dialog div dl fieldset figcaption figure footer form h1 h2 h3 h4 h5 h6 header hgroup hr main menu nav ol p pre section table ul'
  .split(' ')
  .forEach((t) => (CLOSES_P[t] = 1));
/** Implied end tags: opening `key` closes an open element in the list, unless a boundary element comes first. */
const IMPLIED = {
  li: [['li'], ['ul', 'ol', 'menu']],
  dt: [['dt', 'dd'], ['dl']],
  dd: [['dt', 'dd'], ['dl']],
  option: [['option'], ['select', 'datalist', 'optgroup']],
  optgroup: [['optgroup', 'option'], ['select']],
  tr: [['tr', 'td', 'th'], ['table', 'thead', 'tbody', 'tfoot']],
  td: [['td', 'th'], ['tr', 'table']],
  th: [['td', 'th'], ['tr', 'table']],
  thead: [['tbody', 'tfoot', 'thead', 'tr', 'td', 'th'], ['table']],
  tbody: [['tbody', 'tfoot', 'thead', 'tr', 'td', 'th'], ['table']],
  tfoot: [['tbody', 'tfoot', 'thead', 'tr', 'td', 'th'], ['table']],
};
const MAX_HTML = 4 * 1024 * 1024;

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', copy: '©', reg: '®', hellip: '…', mdash: '—', ndash: '–', laquo: '«', raquo: '»', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', middot: '·', euro: '€', pound: '£', yen: '¥' };

export function decodeEntities(s) {
  s = String(s);
  if (s.indexOf('&') < 0) return s;
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+\d*);/gi, (m, e) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      try {
        return String.fromCodePoint(code);
      } catch (_) {
        return m;
      }
    }
    const v = ENTITIES[e.toLowerCase()];
    return v != null ? v : m;
  });
}

function el(tag, attrs, parent) {
  return { tag, attrs, children: [], parent, raw: null };
}

const TAG_RE = /<([a-zA-Z][a-zA-Z0-9:-]*)((?:\s+[^\s"'>\/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*)\s*(\/?)>/y;
const END_RE = /<\/([a-zA-Z][a-zA-Z0-9:-]*)\s*>/y;
const ATTR_RE = /([^\s"'>\/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;

function parseAttrs(src) {
  const attrs = {};
  if (!src) return attrs;
  ATTR_RE.lastIndex = 0;
  let a;
  while ((a = ATTR_RE.exec(src))) {
    const name = a[1].toLowerCase();
    if (!(name in attrs)) attrs[name] = decodeEntities(a[2] != null ? a[2] : a[3] != null ? a[3] : a[4] != null ? a[4] : '');
  }
  return attrs;
}

/** Parse HTML into { root, all } — `all` is every element in document order. */
export function parseHtml(html) {
  html = String(html == null ? '' : html);
  if (html.length > MAX_HTML) html = html.slice(0, MAX_HTML);
  const root = el('#document', {}, null);
  const all = [];
  const stack = [root];
  const top = () => stack[stack.length - 1];
  const addText = (t) => {
    if (t) top().children.push(decodeEntities(t));
  };
  const closeTo = (i) => {
    stack.length = i;
  };
  const open = (tag, attrs) => {
    if (tag === 'p' || CLOSES_P[tag]) {
      for (let i = stack.length - 1; i > 0; i--) {
        const t = stack[i].tag;
        if (t === 'p') {
          closeTo(i);
          break;
        }
        if (t === 'button' || t === 'td' || t === 'th' || t === 'li' || t === 'div' || t === 'table') break;
      }
    }
    const rule = IMPLIED[tag];
    if (rule) {
      for (let i = stack.length - 1; i > 0; i--) {
        const t = stack[i].tag;
        if (rule[0].includes(t)) {
          closeTo(i);
          break;
        }
        if (rule[1].includes(t)) break;
      }
    }
    const node = el(tag, attrs, top());
    top().children.push(node);
    all.push(node);
    return node;
  };

  let pos = 0;
  const len = html.length;
  while (pos < len) {
    const lt = html.indexOf('<', pos);
    if (lt < 0) {
      addText(html.slice(pos));
      break;
    }
    if (lt > pos) addText(html.slice(pos, lt));
    pos = lt;
    if (html.startsWith('<!--', pos)) {
      const end = html.indexOf('-->', pos + 4);
      pos = end < 0 ? len : end + 3;
      continue;
    }
    if (html[pos + 1] === '!' || html[pos + 1] === '?') {
      const end = html.indexOf('>', pos);
      pos = end < 0 ? len : end + 1;
      continue;
    }
    END_RE.lastIndex = pos;
    let m = END_RE.exec(html);
    if (m) {
      const tag = m[1].toLowerCase();
      pos = END_RE.lastIndex;
      for (let i = stack.length - 1; i > 0; i--) {
        if (stack[i].tag === tag) {
          closeTo(i);
          break;
        }
      }
      continue;
    }
    TAG_RE.lastIndex = pos;
    m = TAG_RE.exec(html);
    if (!m) {
      addText('<');
      pos += 1;
      continue;
    }
    pos = TAG_RE.lastIndex;
    const tag = m[1].toLowerCase();
    const node = open(tag, parseAttrs(m[2]));
    if (VOID[tag] || m[3]) continue;
    if (RAW[tag]) {
      const endRe = new RegExp('</' + tag + '\\s*>', 'ig');
      endRe.lastIndex = pos;
      const e = endRe.exec(html);
      const body = html.slice(pos, e ? e.index : len);
      node.raw = tag === 'title' || tag === 'textarea' ? decodeEntities(body) : body;
      pos = e ? endRe.lastIndex : len;
      continue;
    }
    stack.push(node);
  }
  return { root, all };
}

// ───────────────────────────── Text ─────────────────────────────

const BLOCK = {};
'address article aside blockquote br dd details dialog div dl dt fieldset figcaption figure footer form h1 h2 h3 h4 h5 h6 header hr li main nav ol p pre section table td th tr ul'
  .split(' ')
  .forEach((t) => (BLOCK[t] = 1));
const SKIP_TEXT = { script: 1, style: 1, noscript: 1, template: 1, head: 1, svg: 1, iframe: 1, object: 1, select: 1, datalist: 1 };

/** Is this element hidden by markup alone (no CSS available)? */
export function hiddenByMarkup(node) {
  const a = node.attrs;
  if ('hidden' in a) return true;
  if (a.type === 'hidden' && node.tag === 'input') return true;
  if (a.style && /(?:^|;)\s*(?:display\s*:\s*none|visibility\s*:\s*hidden)/i.test(a.style)) return true;
  return false;
}

/** Visible text of a subtree, the way innerText roughly reads it. */
export function textOf(node, out = [], limit = 400000) {
  for (const c of node.children) {
    if (out.length > limit) break;
    if (typeof c === 'string') out.push(c);
    else {
      if (SKIP_TEXT[c.tag] || hiddenByMarkup(c)) continue;
      if (c.tag === 'textarea' || c.tag === 'title') continue;
      if (BLOCK[c.tag]) out.push('\n');
      textOf(c, out, limit);
      if (BLOCK[c.tag]) out.push('\n');
    }
  }
  return out;
}

export function cleanText(s) {
  return String(s)
    .replace(/[ \t\f\v\r ​]+/g, ' ')
    .replace(/ *\n[\s]*/g, '\n')
    .trim();
}

// ───────────────────────────── Selectors ─────────────────────────────
// Supports: tag, *, #id, .class, [attr], [attr=v] (= ~= ^= $= *= |=, with i flag), :not(compound),
// :first-child, :last-child, :empty, descendant (space) and child (>) combinators, and comma lists.

const selectorCache = new Map();

function parseCompound(src) {
  const c = { tag: null, ids: [], classes: [], attrs: [], nots: [], pseudo: [] };
  const re = /(\*|[a-zA-Z][\w-]*)|#((?:[\w-]|\\.)+)|\.((?:[\w-]|\\.)+)|\[\s*([\w:-]+)\s*(?:([~^$*|]?=)\s*(?:"([^"]*)"|'([^']*)'|([^\]\s]+))\s*([iI])?)?\s*\]|:not\(([^)]*)\)|:(first-child|last-child|empty|only-child)/y;
  let pos = 0;
  src = src.trim();
  if (!src) throw new Error('Empty selector');
  while (pos < src.length) {
    re.lastIndex = pos;
    const m = re.exec(src);
    if (!m || m.index !== pos) throw new Error('Unsupported selector: ' + src);
    const unesc = (s) => s.replace(/\\(.)/g, '$1');
    if (m[1]) c.tag = m[1] === '*' ? null : m[1].toLowerCase();
    else if (m[2]) c.ids.push(unesc(m[2]));
    else if (m[3]) c.classes.push(unesc(m[3]));
    else if (m[4]) c.attrs.push({ name: m[4].toLowerCase(), op: m[5] || null, value: m[6] != null ? m[6] : m[7] != null ? m[7] : m[8], i: !!m[9] });
    else if (m[10] != null) c.nots.push(parseCompound(m[10]));
    else if (m[11]) c.pseudo.push(m[11]);
    pos = re.lastIndex;
  }
  return c;
}

/** Split "a > b c" into compounds and combinators, respecting [..] and (..). */
function parseComplex(src) {
  const parts = [];
  let cur = '';
  let depth = 0;
  let quote = null;
  const flush = (comb) => {
    if (cur.trim()) parts.push({ c: parseCompound(cur), comb });
    cur = '';
  };
  let pending = ' ';
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quote) {
      cur += ch;
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      cur += ch;
      continue;
    }
    if (ch === '[' || ch === '(') depth++;
    if (ch === ']' || ch === ')') depth--;
    if (depth === 0 && (ch === '>' || /\s/.test(ch))) {
      if (cur.trim()) {
        flush(pending);
        pending = ' ';
      }
      if (ch === '>') pending = '>';
      continue;
    }
    if (depth === 0 && (ch === '+' || ch === '~')) throw new Error('Unsupported combinator in selector: ' + src);
    cur += ch;
  }
  flush(pending);
  if (!parts.length) throw new Error('Empty selector');
  return parts;
}

function splitList(sel) {
  const out = [];
  let cur = '';
  let depth = 0;
  let quote = null;
  for (const ch of sel) {
    if (quote) {
      if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '[' || ch === '(') depth++;
    else if (ch === ']' || ch === ')') depth--;
    else if (ch === ',' && depth === 0) {
      out.push(cur);
      cur = '';
      continue;
    }
    cur += ch;
  }
  out.push(cur);
  return out.filter((s) => s.trim());
}

export function parseSelector(sel) {
  let parsed = selectorCache.get(sel);
  if (!parsed) {
    parsed = splitList(String(sel)).map(parseComplex);
    if (selectorCache.size > 500) selectorCache.clear();
    selectorCache.set(sel, parsed);
  }
  return parsed;
}

function attrMatches(a, actual) {
  if (actual == null) return false;
  if (!a.op) return true;
  let v = a.value;
  let s = actual;
  if (a.i) {
    v = v.toLowerCase();
    s = s.toLowerCase();
  }
  switch (a.op) {
    case '=':
      return s === v;
    case '~=':
      return s.split(/\s+/).includes(v);
    case '^=':
      return v !== '' && s.startsWith(v);
    case '$=':
      return v !== '' && s.endsWith(v);
    case '*=':
      return v !== '' && s.includes(v);
    case '|=':
      return s === v || s.startsWith(v + '-');
    default:
      return false;
  }
}

function elementChildren(node) {
  return node.children.filter((c) => typeof c !== 'string');
}

function compoundMatches(c, node) {
  if (c.tag && node.tag !== c.tag) return false;
  for (const id of c.ids) if (node.attrs.id !== id) return false;
  if (c.classes.length) {
    const list = (node.attrs.class || '').split(/\s+/);
    for (const cl of c.classes) if (!list.includes(cl)) return false;
  }
  for (const a of c.attrs) if (!attrMatches(a, node.attrs[a.name])) return false;
  for (const n of c.nots) if (compoundMatches(n, node)) return false;
  for (const p of c.pseudo) {
    const sibs = node.parent ? elementChildren(node.parent) : [node];
    if (p === 'first-child' && sibs[0] !== node) return false;
    if (p === 'last-child' && sibs[sibs.length - 1] !== node) return false;
    if (p === 'only-child' && sibs.length !== 1) return false;
    if (p === 'empty' && (node.raw || node.children.some((x) => typeof x !== 'string' || x.length))) return false;
  }
  return true;
}

/** Does `node` match parts[0..i], with parts[i] matching `node` itself? (right to left, backtracking) */
function matchFrom(parts, i, node) {
  if (!node || node.tag === '#document' || !compoundMatches(parts[i].c, node)) return false;
  if (i === 0) return true;
  if (parts[i].comb === '>') return matchFrom(parts, i - 1, node.parent);
  for (let a = node.parent; a && a.tag !== '#document'; a = a.parent) if (matchFrom(parts, i - 1, a)) return true;
  return false;
}

const complexMatches = (parts, node) => matchFrom(parts, parts.length - 1, node);

export function matches(sel, node) {
  return parseSelector(sel).some((parts) => complexMatches(parts, node));
}

export function querySelectorAll(all, sel) {
  const parsed = parseSelector(sel);
  return all.filter((n) => parsed.some((parts) => complexMatches(parts, n)));
}
