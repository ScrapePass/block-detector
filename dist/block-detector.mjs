/*! block-detector v1.1.0 | MIT License | https://github.com/ScrapePass/block-detector */
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

function decodeEntities(s) {
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
function parseHtml(html) {
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
function hiddenByMarkup(node) {
  const a = node.attrs;
  if ('hidden' in a) return true;
  if (a.type === 'hidden' && node.tag === 'input') return true;
  if (a.style && /(?:^|;)\s*(?:display\s*:\s*none|visibility\s*:\s*hidden)/i.test(a.style)) return true;
  return false;
}

/** Visible text of a subtree, the way innerText roughly reads it. */
function textOf(node, out = [], limit = 400000) {
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

function cleanText(s) {
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

function parseSelector(sel) {
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

function matches(sel, node) {
  return parseSelector(sel).some((parts) => complexMatches(parts, node));
}

function querySelectorAll(all, sel) {
  const parsed = parseSelector(sel);
  return all.filter((n) => parsed.some((parts) => complexMatches(parts, n)));
}

// Wording that means "this is not the real page". Each rule lists patterns for one reason.
// A pattern is a RegExp, or [RegExp, weight] where weight (0..1, default 1) scales its confidence.
// Patterns are tested on the headline (title + h1/h2) and, on short pages only, on the visible text.
// `headlineOnly` patterns are too common in normal text to trust anywhere but the title or a heading.
// Keep them without the g or y flag.

const RULES = [
  {
    reason: 'access-denied',
    patterns: [
      /\baccess (?:to this (?:page|resource|site|website) )?(?:has been |is |was )?denied\b/i,
      /\byou(?: have been|'ve been| are| were)? blocked\b/i,
      /\b(?:your )?request (?:was |has been |is )?(?:blocked|rejected|denied|refused)\b/i,
      /\bnot (?:authori[sz]ed|permitted|allowed) to (?:access|view|see) this\b/i,
      /\byour (?:ip|ip address|network|connection|device|browser|access) (?:address )?(?:has been|is|was|appears to be) (?:blocked|banned|restricted|flagged|blacklisted|denied)\b/i,
      /\b(?:unusual|suspicious|abnormal|automated|irregular) (?:traffic|activity|requests?|queries|behaviou?r|access) (?:from|on|has been|was|detected)\b/i,
      /\bwe(?:'ve| have) (?:detected|noticed|received) (?:unusual|suspicious|automated|abnormal|a high (?:number|volume) of)\b/i,
      /\b(?:bots?|crawlers?|scrapers?|scraping|robots?|automated (?:access|tools?|browsing)) (?:is |are )?(?:not (?:allowed|permitted)|prohibited|forbidden|detected|blocked)\b/i,
      /\b(?:detected|identified|flagged) (?:you )?(?:as )?(?:a |an )?(?:bot|robot|automated|crawler|scraper|spider)\b/i,
      /\b(?:vpn|proxy|proxies|anonymi[sz]er|data ?cent(?:er|re)|hosting provider) (?:ip )?(?:detected|is not (?:allowed|supported|permitted)|not allowed|blocked|usage)\b/i,
      /\bpardon our interruption\b/i,
      /\bblocked by (?:the )?(?:website owner|site owner|security|firewall|web application firewall|our security)\b/i,
      /\bthis (?:website|site|page) is using a security service\b/i,
      /\bsecurity (?:check|service|system|policy) (?:has )?(?:blocked|flagged|denied)\b/i,
      /\bReference #\d{1,3}\.[0-9a-f]{6,}\.\d{6,}/,
      [/\bincident id\b/i, 0.7],
      [/\b(?:request|support|event) id\b.{0,40}\b(?:blocked|denied)\b/i, 0.8],
      /\bnot available in your (?:country|region|location)\b/i,
      /\b(?:this (?:content|site|service|page) is )?(?:not |un)available in your (?:country|region)\b/i,
      // es / fr / de / it / pt / nl / pl / tr / ru / ja / zh / ko / vi
      /\bacceso denegado\b/i,
      /\btr[áa]fico (?:inusual|sospechoso)\b/i,
      /\bacc[eè]s (?:refus[ée]|interdit)\b/i,
      /\btrafic inhabituel\b/i,
      /\bvous avez [ée]t[ée] bloqu[ée]/i,
      /\bzugriff (?:verweigert|gesperrt)\b/i,
      /\bungew[öo]hnliche[nr]? (?:datenverkehr|aktivit[äa]t|anfragen)\b/i,
      /\bsie wurden (?:blockiert|gesperrt)\b/i,
      /\baccesso negato\b/i,
      /\btraffico (?:insolito|anomalo)\b/i,
      /\bacesso negado\b/i,
      /\btr[áa]fego (?:incomum|incomun|suspeito|anormal)\b/i,
      /\btoegang geweigerd\b/i,
      /\bodmowa dost[ęe]pu\b/i,
      /\beri[şs]im (?:engellendi|reddedildi)\b/i,
      /доступ (?:запрещ[её]н|ограничен|заблокирован)/i,
      /необычн(?:ый|ая|ое) (?:трафик|активност)/i,
      /アクセス(?:が|は)?(?:拒否|制限|ブロック)/,
      /不正(?:な)?アクセス|異常なトラフィック/,
      /(?:访问|訪問|存取)(?:被)?(?:拒绝|拒絕|禁止|受限)|拒绝访问|拒絕存取|异常流量|異常流量/,
      /접근(?:이)? (?:거부|차단|제한)|비정상적인 트래픽/,
      /truy c[ậa]p b[ịi] t[ừu] ch[ốo]i|l[ưu]u l[ượu]ng b[ấa]t th[ườu][ờo]ng/i,
    ],
    headlineOnly: [/^\s*(?:403\b|forbidden\b|blocked\b|access denied\b|denied\b)/i, /\b403 forbidden\b/i, /\berror 1020\b/i, /\berror 10(?:0[5-9]|1[0-2])\b/i],
  },
  {
    reason: 'rate-limit',
    patterns: [
      /\btoo many (?:requests|attempts|queries|searches)\b/i,
      /\brate[ -]?limit(?:ed|ing| exceeded| reached)?\b/i,
      /\b(?:request|query|api|usage|daily|hourly|search) limit (?:has been )?(?:exceeded|reached|hit)\b/i,
      /\btemporarily (?:blocked|restricted|limited|banned|suspended)\b/i,
      /\byou(?:'re| are| have been|'ve been) (?:temporarily )?(?:restricted|limited|throttled)\b/i,
      /\b(?:slow down|you(?:'re| are) (?:going|browsing|moving|clicking) too fast|you have made too many|you(?:'ve| have) (?:reached|exceeded) (?:the|your) (?:limit|maximum))\b/i,
      /\bthrottl(?:ed|ing)\b/i,
      [/\bplease (?:try again|wait|come back) (?:later|in (?:a (?:few|couple of) )?(?:\d+ )?(?:seconds?|minutes?|hours?|moment))\b/i, 0.6],
      /\bdemasiadas (?:solicitudes|peticiones)\b/i,
      /\btrop de (?:requ[êe]tes|demandes)\b/i,
      /\bzu viele (?:anfragen|anforderungen)\b/i,
      /\btroppe richieste\b/i,
      /\bmuitas (?:solicita[çc][õo]es|requisi[çc][õo]es)\b/i,
      /\bte veel (?:verzoeken|aanvragen)\b/i,
      /\bçok fazla istek\b/i,
      /слишком много запросов|превышен лимит/i,
      /リクエストが多すぎ|アクセスが集中/,
      /(?:请求|請求|访问|訪問|操作)(?:过于|過於|太)频繁|(?:请求|請求)次数过多/,
      /요청이 너무 많/,
      /qu[áa] nhi[ềe]u y[êe]u c[ầa]u/i,
    ],
    headlineOnly: [/^\s*429\b/, /\b429 too many\b/i],
  },
  {
    reason: 'js-shell',
    patterns: [
      /\b(?:please )?(?:enable|turn on|activate|allow|switch on) javascript\b/i,
      /\bjavascript (?:is |must be |needs to be )?(?:required|disabled|turned off|not enabled|must be enabled|needs to be enabled)\b/i,
      /\byou need to enable javascript\b/i,
      /\bthis (?:app|site|page|website|application) (?:requires|needs|works best with) javascript\b/i,
      /\byour browser (?:does not|doesn'?t) (?:support|have) javascript/i,
      /\b(?:activa|habilita|activar|habilitar) (?:el )?javascript\b/i,
      /\b(?:activez|activer|autorisez) (?:le )?javascript\b/i,
      /\bjavascript (?:aktivieren|ist deaktiviert)\b|\baktivieren sie javascript\b/i,
      /\babilita(?:re)? javascript\b/i,
      /\b(?:ative|habilite|ativar) o javascript\b/i,
      /включите javascript|javascript отключ/i,
      /javascript\s*を有効/i,
      /(?:启用|啟用|开启|開啟|打开)\s*javascript/i,
      /(?:javascript|자바스크립트)를 (?:활성화|사용)/i,
    ],
  },
  {
    reason: 'login',
    patterns: [
      /\b(?:sign|log) ?in (?:to|or (?:sign|register) ?up to) (?:continue|view|see|access|read|keep (?:reading|browsing)|proceed)\b/i,
      /\bplease (?:sign|log) ?in\b/i,
      /\byou (?:must|need to|have to) (?:be )?(?:signed|logged) ?in\b/i,
      /\byou (?:must|need to|have to) (?:sign|log) ?in\b/i,
      /\b(?:login|sign[ -]in|authentication) (?:is )?required\b/i,
      /\bcreate (?:an|a free) account to (?:continue|view|see|access)\b/i,
      /\b(?:members|subscribers) only\b/i,
      /\binicia(?:r)? sesi[óo]n para\b/i,
      /\bconnectez-vous pour\b/i,
      /\bmelden sie sich an,? um\b/i,
      /\baccedi per (?:continuare|visualizzare)\b/i,
      /\b(?:fa[çc]a login|entre) para (?:continuar|ver)\b/i,
      /войдите,? чтобы|требуется (?:вход|авторизация)/i,
      /ログインしてください|ログインが必要/,
      /请(?:先)?登录|請(?:先)?登入|登录后(?:查看|继续)|登入後/,
      /로그인이 필요|로그인 후/,
    ],
  },
  {
    reason: 'not-found',
    patterns: [
      /\bpage (?:not found|cannot be found|could not be found|can'?t be found|doesn'?t exist|does not exist|no longer exists|isn'?t available|is not available|you (?:requested|were looking for|are looking for) (?:could not|cannot|can'?t|does not|doesn'?t|was not|wasn'?t))/i,
      /\b(?:we|i) (?:can'?t|cannot|couldn'?t|could not) (?:seem to )?find (?:that|the|this|what you(?:'re| are| were) looking for)\b/i,
      /\b(?:this|the|that) (?:page|product|item|listing|article|post|job|ad|offer|property|video|profile|user|account) (?:has been|was|is|may have been|might have been) (?:removed|deleted|unavailable|expired|taken down|moved|disabled|suspended)\b/i,
      /\b(?:is|are) no longer (?:available|exists?|listed|for sale|active|online)\b/i,
      /\bno longer (?:available|exists)\b/i,
      /\b(?:product|item|listing|page) (?:not found|unavailable)\b/i,
      /\bnothing (?:was )?found (?:here|at this (?:address|location|url))\b/i,
      /\bthe requested (?:url|page|resource) was not found\b/i,
      /\bp[áa]gina no (?:encontrada|existe)\b/i,
      /\bpage (?:introuvable|non trouv[ée]e|inexistante)\b/i,
      /\bseite (?:nicht gefunden|existiert nicht)\b/i,
      /\bpagina (?:non trovata|non esiste)\b/i,
      /\bp[áa]gina n[ãa]o (?:encontrada|existe)\b/i,
      /\bpagina niet gevonden\b/i,
      /\bnie znaleziono strony\b/i,
      /\bsayfa bulunamad[ıi]\b/i,
      /страница не найдена|страница не существует/i,
      /ページが見つかりません|お探しのページ(?:は|が)(?:見つかりません|存在しません)/,
      /页面不存在|找不到(?:该|該)?(?:页面|網頁|頁面)|頁面不存在|页面未找到|您访问的页面不存在/,
      /페이지를 찾을 수 없/,
      /kh[ôo]ng t[ìi]m th[ấa]y trang/i,
    ],
    headlineOnly: [/^\s*(?:error )?404\b/i, /\b404\b.{0,30}\b(?:not found|error|page)\b/i, /\bnot found\b/i, [/\boops\b/i, 0.6]],
  },
  {
    reason: 'error',
    patterns: [
      /\bsomething went wrong\b/i,
      /\b(?:internal server|application|unexpected|unknown|server-side) error\b/i,
      /\bservice (?:is )?(?:temporarily )?unavailable\b/i,
      /\bbad gateway\b/i,
      /\bgateway time-?out\b/i,
      /\b(?:under|down for|undergoing|scheduled) maintenance\b/i,
      /\b(?:we(?:'re| are)|the site is|site is) (?:experiencing|having) (?:some )?(?:technical )?(?:difficulties|issues|problems)\b/i,
      /\ban (?:unexpected )?error (?:has )?occurred\b/i,
      /\bsorry,? (?:there was|we (?:had|ran into|encountered)) (?:a|an|some) (?:problem|error|issue)\b/i,
      /\balgo (?:sali[óo] mal|deu errado)\b/i,
      /\bune erreur (?:s'est produite|est survenue|inattendue)\b/i,
      /\b(?:ein fehler ist aufgetreten|etwas ist schiefgelaufen)\b/i,
      /\b(?:si [èe] verificato un errore|qualcosa [èe] andato storto)\b/i,
      /\bocorreu um erro\b/i,
      /что-то пошло не так|произошла ошибка/i,
      /エラーが発生しました|問題が発生しました/,
      /出错了|發生錯誤|发生错误|服务器错误|伺服器錯誤|系统繁忙/,
      /오류가 발생/,
      /đ[ãa] x[ảa]y ra l[ỗo]i/i,
    ],
    headlineOnly: [/^\s*(?:error )?(?:500|502|503|504)\b/, /^\s*error\s*$/i],
  },
  {
    reason: 'loading',
    patterns: [],
    // Only when that is (nearly) all the page says; checked separately.
    whole: /^\s*(?:loading|please wait|just a (?:moment|second)|one moment|cargando|chargement|wird geladen|laden|caricamento|carregando|загрузка|読み込み中|加载中|載入中|로딩 중|đang tải)\s*(?:\.{1,3}|…)?\s*$/i,
  },
];

/** Path segments that only ever mean a block, check or error page. */
const BLOCK_PATH = /(?:^|[/_.-])(?:captcha|challenge|blocked|block|denied|access-?denied|forbidden|sorry|verify|validate|validation|robot|robots-check|bot-?check|botdetect|security-?check|interstitial|unavailable|abuse|distil_r_|perimeterx|px-captcha|cdn-cgi\/challenge|errors?|rate-?limit|too-?many|unsupported-?browser|geo-?block)(?:$|[/?#._-])/i;
const LOGIN_PATH = /(?:^|\/)(?:login|log-in|signin|sign-in|sign_in|auth|authenticate|sso|oauth|account\/login|accounts\/login|users\/sign_in|session\/new|ap\/signin)(?:$|[/?#._-])/i;

/** Classes and attributes that mark loading placeholders. */
const SKELETON = /(?:^|[\s_-])(?:skeleton|shimmer|placeholder-glow|placeholder-wave|ghost-?(?:card|item|line)|loading-?(?:card|item|row|block|placeholder)|content-?loader|spinner|loader)(?:$|[\s_-])/i;

/** Ids of the element a JavaScript app renders into. */
const APP_ROOTS = ['root', 'app', '__next', '__nuxt', '___gatsby', 'svelte', 'app-root', 'main-app', 'application', 'react-root', 'ember-application'];


const VERSION = '1.1.0';

/** Every reason a result can give. The first group means the site served something else on purpose. */
const REASONS = {
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
function use(cd) {
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
function normalizeExpect(expect) {
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
function snapshotFromHtml(html, opts = {}) {
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
function snapshotFromDom(win, opts = {}) {
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
function fingerprintOf(s) {
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
function compare(reference, page) {
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
function addressWords(url) {
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
function analyze(s, opts = {}) {
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
function detect(opts = {}) {
  const s = snapshotFromDom(opts.window, opts);
  const captcha = runCaptcha(opts, (cd) => cd.detect({ window: opts.window, status: opts.status, headers: opts.headers }));
  return analyze(s, { ...opts, captcha });
}

/** Check an HTML string. Same options as detect(), plus url (the final URL the HTML came from). */
function detectHtml(html, opts = {}) {
  const s = snapshotFromHtml(html, opts);
  const captcha = runCaptcha(opts, (cd) => cd.detectHtml(html, { url: opts.url, status: opts.status, headers: opts.headers }));
  return analyze(s, { ...opts, captcha });
}

/**
 * Check what an HTTP client returned: a fetch Response, an axios/got-style response ({ data | body, status, headers }),
 * or an HTML string. Returns a Promise. Pass requestedUrl to catch redirects (fetch follows them silently).
 */
async function detectResponse(input, opts = {}) {
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
function fingerprint(opts = {}) {
  return fingerprintOf(snapshotFromDom(opts.window, opts));
}

/** Fingerprint an HTML string. opts: url, expect. */
function fingerprintHtml(html, opts = {}) {
  return fingerprintOf(snapshotFromHtml(html, opts));
}

const BlockDetector = { VERSION, REASONS, detect, detectHtml, detectResponse, analyze, fingerprint, fingerprintHtml, fingerprintOf, compare, snapshotFromDom, snapshotFromHtml, normalizeExpect, addressWords, use, rules: RULES };
export { VERSION, REASONS, detect, detectHtml, detectResponse, analyze, fingerprint, fingerprintHtml, fingerprintOf, compare, snapshotFromDom, snapshotFromHtml, normalizeExpect, addressWords, use, RULES as rules };
export default BlockDetector;
