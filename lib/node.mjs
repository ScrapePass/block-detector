// Node entry (ESM): see node.cjs.
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const BlockDetector = require('./node.cjs');

export const { VERSION, REASONS, detect, detectHtml, detectResponse, analyze, fingerprint, fingerprintHtml, fingerprintOf, compare, snapshotFromDom, snapshotFromHtml, normalizeExpect, addressWords, use, rules } = BlockDetector;
export default BlockDetector;
