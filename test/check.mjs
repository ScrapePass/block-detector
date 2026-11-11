import assert from 'node:assert/strict';

export function check(r, expect, label) {
  const reasons = r.detections.map((d) => d.reason);
  const msg = `${label}\n  got: ${r.summary}\n  detections: ${JSON.stringify(r.detections.map((d) => [d.reason, d.confidence]))}\n  hints: ${JSON.stringify(r.hints.map((d) => [d.reason, d.confidence]))}`;
  if (expect.ok !== undefined) assert.equal(r.ok, expect.ok, `ok — ${msg}`);
  if (expect.blocked !== undefined) assert.equal(r.blocked, expect.blocked, `blocked — ${msg}`);
  if (expect.reason !== undefined) assert.equal(r.reason, expect.reason, `reason — ${msg}`);
  for (const x of expect.reasons || []) assert.ok(reasons.includes(x), `missing ${x} — ${msg}`);
  for (const x of expect.absent || []) assert.ok(!reasons.includes(x), `unexpected ${x} — ${msg}`);
  for (const x of expect.hints || []) assert.ok(r.hints.some((d) => d.reason === x), `missing hint ${x} — ${msg}`);
}
