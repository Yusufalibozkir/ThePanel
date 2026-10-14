const { test } = require('node:test');
const assert = require('node:assert/strict');
const { computePrice } = require('../src/engines/pricing');

test('applies multiplier and fixed fee', () => {
  const result = computePrice(10, { multiplier: 1.15, fixed_fee: 0.5, rounding: 'none' });
  assert.deepEqual(result, { ok: true, price: 12 });
});

test('rounds up to X.99', () => {
  const result = computePrice(10, { multiplier: 1.1, rounding: 'up_x99' });
  assert.equal(result.price, 11.99);
});

test('rounding example: 6.20 -> 6.99, whole 7.00 -> 7.99, 6.99 stays', () => {
  assert.equal(computePrice(6.2, { multiplier: 1, rounding: 'up_x99' }).price, 6.99);
  assert.equal(computePrice(7.0, { multiplier: 1, rounding: 'up_x99' }).price, 7.99);
  assert.equal(computePrice(6.99, { multiplier: 1, rounding: 'up_x99' }).price, 6.99);
});

test('min_price guardrail: never lists below it; rounds up from the floor', () => {
  const result = computePrice(3, { multiplier: 1.1, min_price: 5, rounding: 'up_x99' });
  // raw 3.30 -> clamped to 5.00 -> up_x99 -> 5.99 (>= min)
  assert.ok(result.ok);
  assert.equal(result.price, 5.99);
});

test('skips when computed price is below cost', () => {
  const result = computePrice(10, { multiplier: 1.1, cost: 15 });
  assert.equal(result.ok, false);
  assert.match(result.reason, /below cost/);
});

test('rejects invalid inputs instead of throwing', () => {
  assert.equal(computePrice(-5, {}).ok, false);
  assert.equal(computePrice('abc', {}).ok, false);
  assert.equal(computePrice(10, { multiplier: -1 }).ok, false);
  assert.equal(computePrice(10, { rounding: 'bogus' }).ok, false);
});

test('plan defaults: ebay x1.10 min 5, etsy x1.20 min 10, abebooks x1.15 min 4.50', () => {
  const ebay = computePrice(20, { multiplier: 1.1, min_price: 5, rounding: 'up_x99' });
  assert.equal(ebay.price, 22.99);
  const etsy = computePrice(20, { multiplier: 1.2, min_price: 10, rounding: 'up_x99' });
  assert.equal(etsy.price, 24.99);
  const abe = computePrice(20, { multiplier: 1.15, min_price: 4.5, rounding: 'up_x99' });
  assert.equal(abe.price, 23.99);
});
