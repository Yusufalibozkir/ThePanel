const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseProductTags, canonicalCondition } = require('../src/services/metadata/tagParser');
const { computeMetadataStatus } = require('../src/services/metadata/status');
const { evaluateRule } = require('../src/engines/rules');

test('tag parser: prefix convention', () => {
  const parsed = parseProductTags(['author:jrr-tolkien', 'condition:vg', 'publisher:penguin', 'year:1965', 'binding:hardcover', 'classic']);
  assert.equal(parsed.author, 'Jrr Tolkien');
  assert.equal(parsed.condition, 'very_good');
  assert.equal(parsed.publisher, 'Penguin');
  assert.equal(parsed.year, 1965);
  assert.equal(parsed.binding, 'Hardcover');
  assert.deepEqual(parsed.other, ['classic']);
});

test('tag parser: accepts REST-style comma string', () => {
  const parsed = parseProductTags('author:george-orwell, condition:ln, year: 1949');
  assert.equal(parsed.author, 'George Orwell');
  assert.equal(parsed.condition, 'like_new');
  assert.equal(parsed.year, 1949);
});

test('tag parser: condition shorthand map', () => {
  assert.equal(canonicalCondition('new'), 'new');
  assert.equal(canonicalCondition('ln'), 'like_new');
  assert.equal(canonicalCondition('VG'), 'very_good');
  assert.equal(canonicalCondition('g'), 'good');
  assert.equal(canonicalCondition('acc'), 'acceptable');
  assert.equal(canonicalCondition('trash'), null);
});

test('tag parser: junk years and empty values ignored', () => {
  const parsed = parseProductTags(['year:abcd', 'year:99999', 'author:', '']);
  assert.equal(parsed.year, null);
  assert.equal(parsed.author, null);
});

test('metadata status lifecycle', () => {
  assert.equal(computeMetadataStatus({ author: 'A', condition: 'good', year: 1965 }), 'ok');
  assert.equal(computeMetadataStatus({ author: 'A', condition: 'good', year: null }), 'partial');
  assert.equal(computeMetadataStatus({ author: null, condition: null, year: null }), 'missing');
  assert.equal(
    computeMetadataStatus({ author: 'A', condition: null, year: 1949, enriched: { author: true } }),
    'unverified'
  );
});

const product = (overrides = {}) => ({
  id: 'p1',
  price: 15,
  quantity: 1,
  condition: 'very_good',
  metadata_status: 'ok',
  metadata: { year: 1965, tags: ['classic', 'fiction'] },
  images: ['https://example.com/1.jpg'],
  ...overrides,
});

test('rules: eligible product gets priced', () => {
  const rule = { enabled: true, conditions: {}, price_modifier: { multiplier: 1.1, min_price: 5, rounding: 'up_x99' } };
  const result = evaluateRule(product(), rule);
  assert.equal(result.eligible, true);
  assert.equal(result.price, 16.99);
});

test('rules: disabled rule never eligible', () => {
  const result = evaluateRule(product(), { enabled: false, conditions: {}, price_modifier: {} });
  assert.equal(result.eligible, false);
  assert.deepEqual(result.reasons, ['rule disabled']);
});

test('rules: out-of-stock skipped (single-copy model)', () => {
  const result = evaluateRule(product({ quantity: 0 }), { enabled: true, conditions: {}, price_modifier: {} });
  assert.equal(result.eligible, false);
  assert.match(result.reasons[0], /not in stock/);
});

test('rules: metadata_status missing + metadata-dependent conditions -> metadata_missing', () => {
  const rule = { enabled: true, conditions: { conditions: ['good'] }, price_modifier: {} };
  const result = evaluateRule(product({ metadata_status: 'missing', condition: null }), rule);
  assert.equal(result.eligible, false);
  assert.equal(result.reasons[0], 'metadata_missing');
});

test('rules: metadata_status missing but rule does not use metadata -> passes gate', () => {
  const rule = { enabled: true, conditions: { min_price: 10 }, price_modifier: {} };
  const result = evaluateRule(product({ metadata_status: 'missing' }), rule);
  assert.equal(result.eligible, true);
});

test('rules: abebooks condition filter', () => {
  const rule = { enabled: true, conditions: { conditions: ['new', 'like_new', 'very_good', 'good'] }, price_modifier: { multiplier: 1.15, min_price: 4.5, rounding: 'up_x99' } };
  assert.equal(evaluateRule(product({ condition: 'acceptable' }), rule).eligible, false);
  const ok = evaluateRule(product({ condition: 'good', price: 10 }), rule);
  assert.equal(ok.eligible, true);
  assert.equal(ok.price, 11.99);
});

test('rules: etsy vintage filter (year <= cutoff, requires year)', () => {
  const rule = { enabled: true, conditions: { vintage_only: true, year_before: 2006 }, price_modifier: {} };
  assert.equal(evaluateRule(product({ metadata: { year: 2004 } }), rule).eligible, true);
  assert.equal(evaluateRule(product({ metadata: { year: 2015 } }), rule).eligible, false);
  const noYear = evaluateRule(product({ metadata: {} }), rule);
  assert.equal(noYear.eligible, false);
  assert.match(noYear.reasons.join(','), /year unknown/);
});

test('rules: tags_any / tags_all', () => {
  const any = { enabled: true, conditions: { tags_any: ['sci-fi'] }, price_modifier: {} };
  assert.equal(evaluateRule(product(), any).eligible, false);
  const all = { enabled: true, conditions: { tags_all: ['classic'] }, price_modifier: {} };
  assert.equal(evaluateRule(product(), all).eligible, true);
});

test('rules: price bounds and requires_images', () => {
  const bounds = { enabled: true, conditions: { min_price: 10, max_price: 20 }, price_modifier: {} };
  assert.equal(evaluateRule(product({ price: 25 }), bounds).eligible, false);
  const images = { enabled: true, conditions: { requires_images: true }, price_modifier: {} };
  assert.equal(evaluateRule(product({ images: [] }), images).eligible, false);
  assert.equal(evaluateRule(product(), images).eligible, true);
});
