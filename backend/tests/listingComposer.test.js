const { test } = require('node:test');
const assert = require('node:assert/strict');

// Listing composition (pure module): template rendering, channel HTML
// sanitization, plain-text derivation, TSV safety, and row composition
// with per-platform notes / title overrides.

const {
  applyTemplate,
  sanitizeHtmlForChannel,
  htmlToPlainText,
  tsvField,
  composeAbebooksRow,
  toAbebooksTSV,
  ABEBOOKS_CONDITIONS,
} = require('../src/services/listingComposer');

const product = () => ({
  id: 'abcdef1234567890abcdef1234567890',
  title: 'The Hobbit',
  author: 'J. R. R. Tolkien',
  isbn: '9780261102217',
  price: 12.5,
  quantity: 1,
  condition: 'very_good',
  description: '<p>There and <b>back</b> again.</p>',
  metadata: { year: 1937, publisher: 'Allen & Unwin', binding: 'hardcover', sku: 'HB-001' },
});

test('applyTemplate renders variables per product', () => {
  const out = applyTemplate('{condition} copy of {title} ({year}, {binding}). Ships boxed.', product());
  assert.equal(out, 'very good copy of The Hobbit (1937, hardcover). Ships boxed.');
});

test('applyTemplate renders price with two decimals and handles missing values', () => {
  const out = applyTemplate('Listed at ${price} by {author}. {publisher}.', {
    title: 'X',
    price: 10,
    metadata: {},
  });
  assert.equal(out, 'Listed at $10.00 by . .');
});

test('applyTemplate leaves unknown placeholders untouched', () => {
  assert.equal(applyTemplate('literal {braces} {title}', { title: 'T', metadata: {} }), 'literal {braces} T');
});

test('sanitizeHtmlForChannel strips scripts, handlers, and javascript URLs', () => {
  const dirty = `<p onclick="steal()">Hi</p><script>alert(1)</script><a href="javascript:x()">l</a><iframe src="x"></iframe>`;
  const clean = sanitizeHtmlForChannel(dirty);
  assert.equal(clean.includes('script'), false);
  assert.equal(clean.includes('iframe'), false);
  assert.equal(/on\w+\s*=/i.test(clean), false);
  assert.equal(/javascript:/i.test(clean), false);
  assert.equal(clean.includes('<p>Hi</p>'), true);
});

test('htmlToPlainText strips tags, decodes entities, collapses whitespace', () => {
  const out = htmlToPlainText('<p>There &amp; <b>back</b>&nbsp;again.</p>\n\n<p>Bilbo.</p>');
  assert.equal(out, 'There & back again. Bilbo.');
});

test('tsvField removes tabs and line breaks', () => {
  assert.equal(tsvField('a\tb\nc\rd'), 'a b c d');
  assert.equal(tsvField(null), '');
});

test('composeAbebooksRow folds notes and title_override in', () => {
  const row = composeAbebooksRow(product(), { notes: 'Ships boxed.', title_override: 'Hobbit, The' }, 14.38);
  assert.equal(row.title, 'Hobbit, The');
  assert.equal(row.description, 'There and back again. Ships boxed.');
  assert.equal(row.book_no, 'HB-001');
  assert.equal(row.condition, ABEBOOKS_CONDITIONS.very_good);
  assert.equal(row.price, '14.38');
  assert.equal(row.quantity, 1);
});

test('composeAbebooksRow derives a stable book number without SKU', () => {
  const noSku = product();
  noSku.metadata = { ...noSku.metadata, sku: null };
  const row = composeAbebooksRow(noSku, null, 5);
  assert.equal(row.book_no, 'AB-abcdef1234');
  // no listing -> base description only, no title override
  assert.equal(row.title, 'The Hobbit');
  assert.equal(row.description, 'There and back again.');
});

test('toAbebooksTSV produces a header + one line per row, tab-separated', () => {
  const rows = [composeAbebooksRow(product(), null, 9.99)];
  const tsv = toAbebooksTSV(rows);
  const lines = tsv.trimEnd().split('\n');
  assert.equal(lines.length, 2);
  assert.equal(lines[0].split('\t').length, 11);
  assert.equal(lines[1].split('\t').length, 11);
  assert.equal(lines[1].includes('\t'), true);
});
