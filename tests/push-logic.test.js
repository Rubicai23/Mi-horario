import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { splitDue } = createRequire(import.meta.url)('../functions/logic.js');

test('splitDue: envía lo vencido reciente, descarta lo muy antiguo y conserva lo futuro', () => {
  const now = 1_000_000_000;
  const r = splitDue([{ at: now - 1000 }, { at: now - 20 * 60000 }, { at: now + 5000 }, { at: now + 9000 }, null, { at: 'x' }], now);
  assert.equal(r.due.length, 1);
  assert.equal(r.keep.length, 2);
  assert.equal(r.nextAt, now + 5000);
});
test('splitDue: sin avisos futuros nextAt es 0', () => {
  assert.deepEqual(splitDue(undefined, 5), { due: [], keep: [], nextAt: 0 });
});
