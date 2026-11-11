// Plain fetch: is this the real page? Run: node examples/fetch.mjs https://example.com/
import { detectResponse } from 'block-detector';

const url = process.argv[2] || 'https://example.com/';
const res = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0' } });
const r = await detectResponse(res, { requestedUrl: url });
console.log(r.summary);
if (r.blocked) process.exitCode = 1;
