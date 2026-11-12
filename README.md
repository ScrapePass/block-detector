# block-detector

**Did the site block your scraper with HTTP 200?** Many sites don't answer a scraper with a 403. They answer `200 OK` with something else: a "too many requests" page, an empty JavaScript shell, a sign-in wall, a redirect to the home page, or the real layout with the data removed. block-detector looks at the page you got and tells you whether it is the real one.

```js
import { detectResponse } from 'block-detector';

const res = await fetch(url);
const r = await detectResponse(res, { requestedUrl: url });
if (!r.ok) console.log(r.summary);
// → "Blocked: redirected 0.85 — https://shop.example/ip/42 → https://shop.example/blocked?url=… (a block or check page)"
```

- **Catches silent blocks:** rate-limit and access-denied pages served as 200, empty app shells, "enable JavaScript" pages, loading placeholders that never fill, sign-in walls, redirects to the home page or a `/blocked` page, block messages inside the site's normal layout, and pages that only *look* normal.
- **Needs no rule per site:** a "click to continue" gate (a short page whose only content is a form with hidden fields and a button) is a check page, and a short page about none of what its address names (`/wearable-sherpa-blanket/dp/…` with no "blanket" anywhere) is a different page, whatever the site.
- **Learns what a good page looks like:** fingerprint one good page, then check every other page of the same kind against it. Decoy pages and stripped data stand out even when they contain no block wording.
- **Checks what you need:** list the selectors the real page must have (`'.price'`, `'.item >= 10'`, `{ selector: '.price', text: /\d/ }`).
- **Works with [captcha-detector](https://github.com/ScrapePass/captcha-detector):** when it is installed, captchas, bot checks and named block pages from about 70 products are part of the answer.
- **Runs anywhere:** in the browser, in a browser extension, in Playwright and Puppeteer, or on raw HTML in Node, Deno, Bun or a worker. **Zero dependencies**, MIT licensed.

## Install

```bash
npm install block-detector
npm install captcha-detector   # optional: also catch captchas and named bot checks
```

## What it answers

```js
r.ok          // true: looks like the real page
r.blocked     // true: the site most likely served something else on purpose
r.reason      // the main reason (below), or null
r.confidence  // 0..1
r.summary     // one line for logs
r.detections  // every reason found, with evidence
r.hints       // weaker signals, below the threshold
r.expect      // your expect checks, with counts
r.reference   // similarity to the reference fingerprint, if you gave one
r.fingerprint // this page's fingerprint (save it to use as a reference later)
```

| reason | What the site served | blocked |
|---|---|---|
| `challenge` | A bot check or captcha page (header `cf-mitigated`, AWS WAF, captcha-detector), or a "click to continue" gate: a short page whose only content is a form with no fields to fill in and a button | yes |
| `access-denied` | "Access denied", "you have been blocked", "unusual traffic", "VPN detected" | yes |
| `rate-limit` | "Too many requests", "slow down", HTTP 429, `retry-after` | yes |
| `login` | A sign-in wall, a password form, or a redirect to `/login` | yes |
| `redirected` | Sent to the home page, a `/blocked`, `/sorry`, `/captcha` page, or another site | yes |
| `js-shell` | An empty `#root` / `#app` / `#__next`, or "please enable JavaScript" | yes |
| `empty` | A blank page | yes |
| `loading` | Only skeletons / spinners / "Loading…" | yes |
| `stripped` | The layout is there but `expect` selectors are missing, or far less text than the reference | yes |
| `different` | Not the same kind of page as the reference fingerprint, or a short page that mentions none of the words its address names (only a hint on longer pages) | yes |
| `not-found` | "Page not found", "this listing has been removed", HTTP 404 | no |
| `error` | "Something went wrong", maintenance, HTTP 5xx | no |

Wording is matched in English and in Spanish, French, German, Italian, Portuguese, Dutch, Polish, Turkish, Russian, Japanese, Chinese, Korean and Vietnamese. Wording in the visible text only counts on short pages (block pages are short), so an article *about* rate limits is not flagged.

## Usage

### Plain HTTP (fetch, axios, got)

```js
import { detectResponse, detectHtml } from 'block-detector';

const r = await detectResponse(await fetch(url), { requestedUrl: url });   // fetch follows redirects silently: pass requestedUrl
const r2 = await detectResponse(await axios.get(url), { requestedUrl: url });
const r3 = detectHtml(html, { url: finalUrl, requestedUrl: url, status: 200, headers });
```

Raw HTML can't run JavaScript. A site that renders in the browser shows up as `js-shell` there: the content isn't in the HTML you fetched.

### Playwright or Puppeteer

```js
import { detectInPage, waitForContent } from 'block-detector/page';

const response = await page.goto(url);
const r = await detectInPage(page, { response });          // status, headers and the URL before redirects come from response
const r2 = await waitForContent(page, { response, timeout: 10000 }); // waits while the page is loading or an empty shell
```

The helper runs the detector inside the page. When captcha-detector is installed, it also runs captcha-detector, which looks inside cross-origin frames too. If the page navigates while it is being checked (meta refresh, JavaScript redirect), it waits and tries again.

### In the browser or an extension

```html
<script src="https://cdn.jsdelivr.net/npm/block-detector@1/dist/block-detector.js"></script>
<script>console.log(BlockDetector.detect({ expect: ['h1'] }).summary)</script>
```

Load `captcha-detector.js` first, and its checks are used too (`window.CaptchaDetector`).

## Catch stripped data: `expect`

Tell it what the real page must have:

```js
detectHtml(html, {
  expect: [
    'h1',                                   // at least one
    '.product .price',                      // descendant and child (>) selectors work on raw HTML too
    '.result-item >= 10',                   // at least 10
    { selector: '.price', text: /\d/ },     // the price must contain a number, not "Sign in to see price"
    { text: /Add to cart/i },               // no selector: the page text must match
  ],
});
```

A failed expect gives `stripped`. On raw HTML, selectors support tag, `#id`, `.class`, `[attr]`, `[attr=v]` (and `~= ^= $= *= |=`), `:not()`, `:first-child`, `:last-child`, `:only-child`, `:empty`, and the descendant and `>` combinators. An unsupported selector is reported in `r.expect[i].error`, not thrown.

## Catch decoys: reference fingerprints

Some sites serve a page that looks fine but isn't the real one. It might be a stand-in with no data, a different template, or the site layout around a short notice. Fingerprint a page you know is good, then compare:

```js
import { fingerprintHtml, detectHtml } from 'block-detector';

const reference = fingerprintHtml(goodHtml, { expect: ['.price', '.review'] }); // small JSON: save it
const r = detectHtml(otherHtml, { reference });
r.reference // { similarity: 0.95, parts: { classes, structure, text, links }, textRatio }
```

- A fingerprint records the page's **content area** (header, footer, nav and sidebars are left out, because they are the same on every page): which CSS classes it uses, how its elements nest, how much text it has and how many links. Pages of the same kind score about 0.9–1.0. A block notice inside the normal site layout scores below 0.3.
- Under 0.5 gives `different`; text under 25% of the reference gives `stripped`.
- Selectors recorded with `expect` at fingerprint time must be found again (at least 20% as many).
- A strong match (≥ 0.75, all `expect` checks pass) overrules wording, so a film called *Access Denied* is not a block page.
- Pass a list of fingerprints (`reference: [productRef, listRef]`): the best match is used.
- In Playwright: `fingerprintPage(page, { expect })`. In a browser: `fingerprint({ expect })`. Every result also has `r.fingerprint`.

## Command line

```bash
npx block-detector https://example.com/item/42
npx block-detector https://example.com/item/1 --expect h1 --expect .price --save-reference item.json
npx block-detector https://example.com/item/2 --reference item.json --fail
npx block-detector https://example.com/item/2 --browser          # real browser (needs playwright)
curl -s https://example.com | npx block-detector - --url https://example.com/
```

## Options

| Option | Meaning |
|---|---|
| `requestedUrl` | The URL you asked for, before redirects (the Playwright helper reads it from `response`) |
| `url` | `detectHtml`: the final URL the HTML came from |
| `status`, `headers` | The HTTP response status and headers |
| `expect` | Selectors the real page must have |
| `reference` | A fingerprint (or a list) of good pages of the same kind |
| `threshold` | 0..1, default 0.5: confidence a reason needs to count (lower: more sensitive) |
| `useCaptchaDetector` | `false` to skip captcha-detector even when installed |
| `captcha` | A captcha-detector result you already have |

## Limits

- It judges the page you got; it cannot know what the site would have shown a person. A decoy with the same template and plausible fake values passes unless `expect` checks the values (`text: /…/`).
- Wording rules are for the languages listed above; structure, redirects, `expect` and reference checks work in any language.
- Raw HTML has no CSS: text hidden by a stylesheet still counts there (in a browser it doesn't).

## Tests

```bash
npm test          # raw-HTML cases, with and without captcha-detector, then the same cases in real Chromium
npm run test:live # real sites with a plain fetch: normal pages must be OK; sites that often block are shown
```

## License

MIT
