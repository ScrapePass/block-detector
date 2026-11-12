// Test pages. expect: ok / blocked / reason (top reason) / reasons (must be among detections) /
// absent (must not be detections) / hints (must be weak hints only).
const page = (title, body, head = '') => `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title>${head}</head><body>${body}</body></html>`;

const nav =
  '<header class="site-header"><a class="logo" href="/">Shop</a><nav class="main-nav"><ul class="nav-list">' +
  ['Home', 'Women', 'Men', 'Kids', 'Home & Garden', 'Electronics', 'Sports', 'Toys', 'Books', 'Deals', 'Gift cards', 'Help'].map((x, i) => `<li class="nav-item"><a class="nav-link" href="/c/${i}">${x}</a></li>`).join('') +
  '</ul></nav><form class="search" action="/search"><input name="q" placeholder="Search"><button>Search</button></form></header>';
const footer =
  '<footer class="site-footer"><div class="footer-cols">' +
  ['About us', 'Careers', 'Press', 'Contact', 'Shipping', 'Returns', 'Privacy', 'Terms', 'Cookies', 'Accessibility'].map((x, i) => `<div class="footer-col"><a class="footer-link" href="/p/${i}">${x}</a></div>`).join('') +
  '</div><p class="copyright">© 2026 Example Shop. All rights reserved. Prices in USD.</p></footer>';
const layout = (title, main, head = '') => page(title, `${nav}<main class="content">${main}</main>${footer}`, head);

const lorem = 'Built from recycled aluminium with a soft-touch finish, it keeps drinks cold for 24 hours and hot for 12. The lid is leak-proof and dishwasher safe, and the handle folds flat for packing. ';
const product = (name, price, n = 6) =>
  layout(
    `${name} | Example Shop`,
    `<nav class="breadcrumbs"><a href="/">Home</a> / <a href="/c/5">Kitchen</a></nav>
     <section class="product"><div class="gallery"><img class="product-img" src="/i/1.jpg" alt=""><img class="product-img" src="/i/2.jpg" alt=""></div>
     <div class="product-info"><h1 class="product-title">${name}</h1>${price ? `<div class="price-box"><span class="price">${price}</span></div>` : '<div class="price-box"></div>'}
     <div class="rating"><span class="stars">4.6</span> <a href="#reviews">212 reviews</a></div>
     <button class="add-to-cart">Add to cart</button><div class="description"><p>${lorem.repeat(3)}</p><p>${lorem.repeat(2)}</p></div></div></section>
     <section class="related"><h2>You may also like</h2><ul class="cards">${Array.from({ length: n }, (_, i) => `<li class="card"><a class="card-link" href="/item/${i}"><img class="card-img" src="/t/${i}.jpg" alt=""><span class="card-name">Bottle ${i}</span><span class="card-price">$${10 + i}.99</span></a></li>`).join('')}</ul></section>
     <section id="reviews" class="reviews"><h2>Reviews</h2>${Array.from({ length: 4 }, (_, i) => `<article class="review"><h3 class="review-title">Great bottle ${i}</h3><p class="review-body">${lorem}</p></article>`).join('')}</section>`,
  );
const article =
  layout(
    'Why websites block scrapers | Example Blog',
    `<article class="post"><h1>Why websites block scrapers</h1>` +
      Array.from({ length: 30 }, () => '<p>When a site sees too many requests from one address it may answer with an access denied page, a rate limit message, or ask you to sign in to continue. Something went wrong is another message you might see when a server is overloaded, and some sites say you have been blocked without giving a reason. Good scrapers slow down and respect robots.txt.</p>').join('') +
      '</article>',
  );

const gate = (text, extra = '') => page('Shop', `<div class="box"><h4>${text}</h4><form method="get" action="/errors/check"><input type="hidden" name="t" value="abc"><input type="hidden" name="r" value="/dp/X"><button type="submit">Continue shopping</button></form>${extra}</div><div class="foot"><a href="/terms">Conditions of Use</a> <a href="/privacy">Privacy Policy</a> © 1996-2025, Shop Inc.</div>`);
export const PRODUCT = product('Steel Water Bottle 750 ml', '$24.99');
export const PRODUCT_2 = product('Insulated Travel Mug 400 ml', '$18.50', 8);

export const CASES = [
  // ───── Blocked, served with HTTP 200 ─────
  {
    name: 'rate-limit page',
    html: page('Too Many Requests', '<h1>Too many requests</h1><p>You have sent too many requests in a given amount of time. Please try again later.</p>'),
    opts: { status: 200 },
    expect: { ok: false, blocked: true, reason: 'rate-limit' },
  },
  {
    name: 'unusual traffic page',
    html: page('Sorry...', '<div><h1>We are sorry...</h1><p>Our systems have detected unusual traffic from your computer network. This page checks to see if it\'s really you sending the requests, and not a robot.</p></div>'),
    // captcha-detector (when installed) names it a challenge page; on its own it is access-denied wording.
    expect: { ok: false, blocked: true, reasons: ['access-denied'] },
  },
  {
    name: 'Akamai access denied with reference id',
    html: page('Access Denied', '<h1>Access Denied</h1>You don\'t have permission to access "http://www.shop.test/item/1" on this server.<p>Reference #18.6b2d1402.1731320000.1a2b3c4d</p>'),
    expect: { ok: false, blocked: true, reason: 'access-denied' },
  },
  {
    name: 'block page inside the full site layout',
    html: layout('Example Shop', '<div class="notice"><h2>Your request has been blocked</h2><p>We detected automated access from your network. If you think this is a mistake, contact support.</p></div>'),
    expect: { ok: false, blocked: true, reasons: ['access-denied'] },
  },
  {
    name: 'VPN / proxy block',
    html: page('Shop', '<main><p>VPN detected. Please turn off your VPN or proxy to continue browsing.</p></main>'),
    expect: { ok: false, blocked: true, reason: 'access-denied' },
  },
  {
    name: 'empty React shell',
    html: page('Shop', '<div id="root"></div><script src="/static/js/runtime.js"></script><script src="/static/js/vendor.js"></script><script src="/static/js/main.js"></script>'),
    expect: { ok: false, blocked: true, reason: 'js-shell' },
  },
  {
    name: 'enable JavaScript page',
    html: page('Shop', '<noscript>You need to enable JavaScript to run this app.</noscript><div id="app"></div>'),
    expect: { ok: false, blocked: true, reason: 'js-shell' },
  },
  {
    name: 'blank page',
    html: '<html><head></head><body></body></html>',
    expect: { ok: false, blocked: true, reason: 'empty' },
  },
  {
    name: 'loading skeletons only',
    html: page('Shop', '<div class="grid">' + '<div class="card skeleton"><div class="skeleton-line"></div></div>'.repeat(6) + '</div>'),
    expect: { ok: false, blocked: true, reasons: ['loading'] },
  },
  {
    name: '"Loading…" only',
    html: page('Shop', '<div class="wrap"><img src="/logo.png" alt=""><p>Loading...</p></div>'),
    expect: { ok: false, blocked: true, reason: 'loading' },
  },
  {
    name: 'redirected to sign-in',
    html: page('Sign in', '<form action="/session"><h1>Sign in</h1><input name="email"><input type="password" name="password"><button>Sign in</button></form>'),
    opts: { url: 'https://shop.test/login?next=%2Fitem%2F42', requestedUrl: 'https://shop.test/item/42' },
    expect: { ok: false, blocked: true, reason: 'login' },
  },
  {
    name: 'sign-in wall without redirect',
    html: page('Item 42', '<h2>Sign in to continue</h2><p>Create a free account to see prices.</p><form><input name="email"><input type="password"><button>Continue</button></form>'),
    opts: { url: 'https://shop.test/item/42', requestedUrl: 'https://shop.test/item/42' },
    expect: { ok: false, blocked: true, reason: 'login' },
  },
  {
    name: 'redirected to the home page',
    html: layout('Example Shop', '<section class="hero"><h1>Welcome</h1><p>New season, new deals.</p></section>'),
    opts: { url: 'https://www.shop.test/', requestedUrl: 'https://shop.test/item/42' },
    expect: { ok: false, blocked: true, reason: 'redirected' },
  },
  {
    name: 'redirected to a /sorry/ page',
    html: page('Sorry', '<p>Please wait.</p>'),
    opts: { url: 'https://www.search.test/sorry/index?continue=https://www.search.test/search%3Fq%3Dx', requestedUrl: 'https://www.search.test/search?q=x' },
    expect: { ok: false, blocked: true, reason: 'redirected' },
  },
  {
    name: 'meta refresh to a block page',
    html: page('Redirecting', '<p>Redirecting…</p>', '<meta http-equiv="refresh" content="0; url=/blocked?id=123">'),
    opts: { url: 'https://shop.test/item/42' },
    expect: { ok: false, blocked: true, reason: 'redirected' },
  },
  {
    name: 'Cloudflare challenge header with 200',
    html: page('Shop', '<div class="main-wrapper"><p>One moment, please...</p></div>'),
    opts: { headers: { 'cf-mitigated': 'challenge', server: 'cloudflare' } },
    expect: { ok: false, blocked: true, reason: 'challenge' },
  },
  {
    name: 'HTTP 429 status',
    html: page('Shop', '<p>Slow down.</p>'),
    opts: { status: 429 },
    expect: { ok: false, blocked: true, reason: 'rate-limit' },
  },
  {
    name: 'rate limit in Chinese',
    html: page('提示', '<div class="tip"><p>访问过于频繁，请稍后再试。</p></div>'),
    expect: { ok: false, blocked: true, reason: 'rate-limit' },
  },
  {
    name: 'access denied in German',
    html: page('Fehler', '<h1>Zugriff verweigert</h1><p>Bitte versuchen Sie es später erneut.</p>'),
    expect: { ok: false, blocked: true, reason: 'access-denied' },
  },
  {
    name: 'stripped: no price (expect .price)',
    html: product('Steel Water Bottle 750 ml', null),
    opts: { expect: ['h1', '.price'] },
    expect: { ok: false, blocked: true, reason: 'stripped' },
  },
  {
    name: 'stripped: too few items (expect .card >= 10)',
    html: product('Steel Water Bottle 750 ml', '$24.99', 2),
    opts: { expect: ['.card >= 10'] },
    expect: { ok: false, blocked: true, reason: 'stripped' },
  },
  {
    name: 'stripped: price without a number (expect text)',
    html: product('Steel Water Bottle 750 ml', 'Sign in to see price'),
    opts: { expect: [{ selector: '.price', text: /\d/ }] },
    expect: { ok: false, blocked: true, reasons: ['stripped'] },
  },
  {
    name: 'stripped: descendant selector',
    html: product('Steel Water Bottle 750 ml', '$24.99', 0),
    opts: { expect: ['.related ul.cards > li.card a .card-price'] },
    expect: { ok: false, reason: 'stripped' },
  },
  {
    name: 'gate page: a form with only hidden fields and a button (click to continue)',
    html: gate('Click the button below to continue shopping'),
    opts: { status: 200, url: 'https://shop.test/Wearable-Blanket-Sherpa-Pockets/dp/B0FGTRB7ZG', requestedUrl: 'https://shop.test/Wearable-Blanket-Sherpa-Pockets/dp/B0FGTRB7ZG' },
    expect: { ok: false, blocked: true, reasons: ['challenge', 'different'] },
  },
  {
    name: 'gate page with a submit input, at an address with only ids',
    html: page('Shop', '<p>Please continue to the site.</p><form method="post" action="/go"><input type="hidden" name="k" value="1"><input type="submit" value="Continue"></form>'),
    opts: { status: 200, url: 'https://shop.test/p/123456', requestedUrl: 'https://shop.test/p/123456' },
    expect: { ok: false, blocked: true, reason: 'challenge', absent: ['different'] },
  },
  {
    name: 'short page about none of what the address names',
    html: page('Shop', '<main><h1>Welcome to Shop</h1><p>Find great deals on everything you need, every day. Free delivery on orders over $35.</p><a href="/">Start shopping</a></main>'),
    opts: { status: 200, url: 'https://shop.test/insulated-travel-mug-400ml/p/77', requestedUrl: 'https://shop.test/insulated-travel-mug-400ml/p/77' },
    expect: { ok: false, blocked: true, reason: 'different' },
  },
  // ───── Not the real page, not a block ─────
  {
    name: 'soft 404 inside the site layout',
    html: layout('Page not found | Example Shop', '<div class="error"><h1>Sorry, we couldn\'t find that page</h1><p>Try searching or go back to the home page.</p></div>'),
    expect: { ok: false, blocked: false, reason: 'not-found' },
  },
  {
    name: 'listing removed',
    html: layout('Example Shop', '<div class="notice"><h1>This listing has been removed</h1><p>The seller ended this listing.</p></div>'),
    expect: { ok: false, blocked: false, reason: 'not-found' },
  },
  {
    name: 'page not found in Japanese',
    html: page('エラー', '<h1>ページが見つかりません</h1><p>お探しのページは移動または削除された可能性があります。</p>'),
    expect: { ok: false, blocked: false, reason: 'not-found' },
  },
  {
    name: 'error page',
    html: page('Oops', '<h1>Something went wrong</h1><p>We\'re working on it. Please refresh the page.</p>'),
    expect: { ok: false, blocked: false, reason: 'error' },
  },
  // ───── Real pages (must be OK) ─────
  { name: 'normal product page', html: PRODUCT, expect: { ok: true } },
  { name: 'product page at an address that names it', html: PRODUCT, opts: { url: 'https://shop.test/steel-water-bottles/750ml/p/123', requestedUrl: 'https://shop.test/steel-water-bottles/750ml/p/123' }, expect: { ok: true } },
  // A long page that doesn't use the address's words is only a hint (a translated page, an old slug).
  { name: 'long page whose address uses other words', html: PRODUCT, opts: { url: 'https://shop.test/trinkflasche-edelstahl/p/123', requestedUrl: 'https://shop.test/trinkflasche-edelstahl/p/123' }, expect: { ok: true, hints: ['different'] } },
  {
    name: 'newsletter page: a form with a field to fill in is no gate',
    html: page('Newsletter', '<h1>Newsletter</h1><p>Get our weekly deals.</p><form action="/subscribe"><input type="hidden" name="src" value="web"><input type="email" name="email" placeholder="Email"><button>Sign up</button></form>'),
    opts: { url: 'https://shop.test/newsletter', requestedUrl: 'https://shop.test/newsletter' },
    expect: { ok: true },
  },
  {
    name: 'cart page with a checkout button and real content',
    html: layout('Your cart | Example Shop', '<h1>Your cart</h1><ul class="cart">' + Array.from({ length: 3 }, (_, i) => `<li class="cart-item"><a href="/item/${i}">Steel bottle ${i}</a> <span class="price">$2${i}.99</span></li>`).join('') + '</ul><form action="/checkout" method="post"><input type="hidden" name="cart" value="abc"><button>Checkout</button></form>'),
    opts: { url: 'https://shop.test/cart', requestedUrl: 'https://shop.test/cart' },
    expect: { ok: true },
  },
  { name: 'normal product page with expect', html: PRODUCT, opts: { expect: ['h1', '.price', '.card >= 3', { selector: '.price', text: /\$\d/ }] }, expect: { ok: true } },
  { name: 'long article that mentions block messages', html: article, expect: { ok: true } },
  { name: 'long docs page titled "429 Too Many Requests"', html: article.replace(/<title>[^<]*<\/title>/, '<title>429 Too Many Requests - HTTP | Docs</title>'), expect: { ok: true } },
  {
    name: 'server-rendered Next.js page',
    html: page('Docs', '<noscript>You need to enable JavaScript to run this app.</noscript><div id="__next"><main><h1>Getting started</h1>' + `<p>${lorem}</p>`.repeat(8) + '</main></div><script src="/_next/a.js"></script><script src="/_next/b.js"></script><script src="/_next/c.js"></script>'),
    expect: { ok: true },
  },
  {
    name: 'a sign-in page you asked for',
    html: page('Sign in', '<form><h1>Sign in</h1><input name="email"><input type="password"><button>Sign in</button></form>'),
    opts: { url: 'https://shop.test/login', requestedUrl: 'https://shop.test/login' },
    expect: { ok: true },
  },
  {
    name: 'short real page (contact)',
    html: layout('Contact | Example Shop', '<h1>Contact us</h1><p>Email support@shop.test or call 555-0100, Monday to Friday 9am–5pm.</p><form><input name="name"><textarea name="msg"></textarea><button>Send</button></form>'),
    expect: { ok: true },
  },
  {
    name: 'http → https and www redirect',
    html: PRODUCT,
    opts: { url: 'https://www.shop.test/item/42/', requestedUrl: 'http://shop.test/item/42' },
    expect: { ok: true },
  },
  {
    name: 'locale redirect',
    html: PRODUCT,
    opts: { url: 'https://shop.test/en-us/item/42', requestedUrl: 'https://shop.test/item/42' },
    expect: { ok: true, hints: ['redirected'] },
  },
  {
    name: 'canonical to home on a short deep page is only a hint',
    html: page('Shop', '<h1>Steel Bottle</h1><p>' + lorem.repeat(4) + '</p>', '<link rel="canonical" href="https://shop.test/">'),
    opts: { url: 'https://shop.test/item/42' },
    expect: { ok: true, hints: ['redirected'] },
  },
];
