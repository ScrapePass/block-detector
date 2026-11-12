// Bundles src/ into dist/block-detector.js (UMD: <script>, require, page.evaluate) and dist/block-detector.mjs (ESM).
// No dependencies.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

const strip = (src) =>
  src
    .replace(/^import [^\n]*;\n/gm, '')
    .replace(/^export \{[^}]*\};?\n/gm, '')
    .replace(/^export (async function|const|function|let|class) /gm, '$1 ');

const body = ['src/html.js', 'src/patterns.js', 'src/engine.js'].map((f) => strip(readFileSync(join(root, f), 'utf8'))).join('\n');
if (!body.includes(`VERSION = '${pkg.version}'`)) throw new Error(`src/engine.js VERSION does not match package.json ${pkg.version}`);

const names = ['VERSION', 'REASONS', 'detect', 'detectHtml', 'detectResponse', 'analyze', 'fingerprint', 'fingerprintHtml', 'fingerprintOf', 'compare', 'snapshotFromDom', 'snapshotFromHtml', 'normalizeExpect', 'addressWords', 'use'];
const api = `{ ${names.join(', ')}, rules: RULES }`;
const banner = `/*! block-detector v${pkg.version} | MIT License | ${pkg.homepage} */\n`;

const umd = `${banner}(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else if (typeof define === 'function' && define.amd) define([], factory);
  else root.BlockDetector = factory();
})(typeof globalThis !== 'undefined' ? globalThis : typeof self !== 'undefined' ? self : this, function () {
'use strict';
${body}
return ${api};
});
`;

const esm = `${banner}${body}
const BlockDetector = ${api};
export { ${names.join(', ')}, RULES as rules };
export default BlockDetector;
`;

mkdirSync(join(root, 'dist'), { recursive: true });
writeFileSync(join(root, 'dist/block-detector.js'), umd);
writeFileSync(join(root, 'dist/block-detector.mjs'), esm);
console.log(`built dist/block-detector.js (${(umd.length / 1024).toFixed(1)} KB) and dist/block-detector.mjs`);
