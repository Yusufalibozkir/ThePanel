const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { parseProductTags } = require('../src/services/metadata/tagParser');
const { computeMetadataStatus } = require('../src/services/metadata/status');
const { extractYear } = require('../src/services/metadata/openLibrary');

// productService.mapShopifyToProduct is exercised with enrichment disabled so
// tests stay offline. Uses a temp DB through the patched config module.
const path = require('path');
const fs = require('fs');
const os = require('os');
const Database = require('better-sqlite3');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thepanel-sync-'));
const testDb = new Database(path.join(tmpDir, 'test.db'));
testDb.exec(`
  CREATE TABLE IF NOT EXISTS products (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    shopify_product_id TEXT NOT NULL UNIQUE,
    isbn TEXT,
    title TEXT NOT NULL,
    author TEXT,
    description TEXT,
    price REAL NOT NULL,
    cost REAL,
    condition TEXT,
    quantity INTEGER NOT NULL DEFAULT 0,
    images TEXT DEFAULT '[]',
    metadata TEXT DEFAULT '{}',
    sold_at DATETIME,
    sold_via TEXT,
    metadata_status TEXT NOT NULL DEFAULT 'missing',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

const dbConfig = require('../src/config/database');
dbConfig.db = testDb;
dbConfig.query = (sql, params = []) => {
  const stmt = testDb.prepare(sql);
  return stmt.reader ? { rows: stmt.all(params) } : { rows: [{ id: 0, changes: stmt.run(params).changes }] };
};

const productService = require('../src/services/productService');

test('mapShopifyToProduct fills author/condition from tags', async () => {
  const mapped = await productService.mapShopifyToProduct(
    {
      id: '111',
      title: 'The Hobbit',
      body_html: '<p>hi</p>',
      vendor: 'Penguin',
      product_type: 'Book',
      tags: ['author:jrr-tolkien', 'condition:vg', 'year:1965', 'fantasy'],
      images: [{ src: 'https://example.com/hobbit.jpg' }],
      variants: [{ price: '12.50', barcode: '9780261102217', inventory_quantity: 3 }],
    },
    { enrich: false }
  );

  assert.equal(mapped.author, 'Jrr Tolkien');
  assert.equal(mapped.condition, 'very_good');
  assert.equal(mapped.quantity, 1, 'single-copy model clamps positive stock to 1');
  assert.equal(mapped.isbn, '9780261102217');
  assert.equal(mapped.metadata_status, 'ok', 'author+condition+year from tags');

  const meta = JSON.parse(mapped.metadata);
  assert.equal(meta.year, 1965);
  assert.deepEqual(meta.tags, ['author:jrr-tolkien', 'condition:vg', 'year:1965', 'fantasy']);
});

test('mapShopifyToProduct without tags -> missing; out of stock -> qty 0', async () => {
  const mapped = await productService.mapShopifyToProduct(
    {
      id: '222',
      title: 'Bare book',
      tags: [],
      images: [],
      variants: [{ price: '5.00', barcode: null, inventory_quantity: 0 }],
    },
    { enrich: false }
  );
  assert.equal(mapped.author, null);
  assert.equal(mapped.condition, null);
  assert.equal(mapped.metadata_status, 'missing');
  assert.equal(mapped.quantity, 0);
});

test('mapShopifyToProduct partial metadata -> partial status', async () => {
  const mapped = await productService.mapShopifyToProduct(
    {
      id: '333',
      title: 'Half book',
      tags: ['author:someone'],
      images: [],
      variants: [{ price: '5.00' }],
    },
    { enrich: false }
  );
  assert.equal(mapped.metadata_status, 'partial');
});

test('update preserves locally confirmed values', async () => {
  const created = await productService.create({
    shopify_product_id: '444',
    title: 'Kept',
    price: 9,
    author: 'Manual Author',
    condition: 'good',
    quantity: 1,
    metadata: JSON.stringify({ year: 1950, tags: [] }),
    metadata_status: 'partial',
  });

  const mapped = await productService.mapShopifyToProduct(
    {
      id: '444',
      title: 'Kept (updated)',
      tags: [],
      images: [],
      variants: [{ price: '9.00' }],
    },
    { existing: created, enrich: false }
  );

  assert.equal(mapped.author, 'Manual Author', 'existing author not clobbered by empty tags');
  assert.equal(JSON.parse(mapped.metadata).year, 1950, 'existing year not clobbered');
  assert.notEqual(mapped.metadata_status, 'missing');
});

test('openLibrary year extraction', () => {
  assert.equal(extractYear('1965'), 1965);
  assert.equal(extractYear('March 3, 1949'), 1949);
  assert.equal(extractYear('n.d.'), null);
  assert.equal(extractYear('year 99999'), null);
});

test('tag parser handles GraphQL array and REST string identically', () => {
  const a = parseProductTags(['author:lea-guin']);
  const b = parseProductTags('author:lea-guin');
  assert.deepEqual(a.author, b.author);
});

after(() => {
  testDb.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});
