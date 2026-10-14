const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const os = require('os');
const Database = require('better-sqlite3');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thepanel-facets-'));
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
  );

  CREATE TABLE IF NOT EXISTS product_changes (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    change_id TEXT NOT NULL,
    product_id TEXT NOT NULL,
    field TEXT NOT NULL,
    old_value TEXT,
    new_value TEXT,
    source TEXT NOT NULL DEFAULT 'manual' CHECK(source IN ('manual', 'sync')),
    changed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
  )
`);

const dbConfig = require('../src/config/database');
dbConfig.db = testDb;
dbConfig.query = (sql, params = []) => {
  const stmt = testDb.prepare(sql);
  return stmt.reader ? { rows: stmt.all(params) } : { rows: [{ id: 0, changes: stmt.run(params).changes }] };
};

const productService = require('../src/services/productService');

const insert = async (shopifyId, metadata) => {
  const mapped = await productService.mapShopifyToProduct(
    {
      id: shopifyId,
      title: `Book ${shopifyId}`,
      tags: [],
      images: [],
      variants: [{ price: '10.00' }],
    },
    { enrich: false }
  );
  const meta = { ...JSON.parse(mapped.metadata), ...metadata };
  return productService.create({ ...mapped, metadata: JSON.stringify(meta) });
};

test('mapShopifyToProduct stores shopify category in metadata', async () => {
  const mapped = await productService.mapShopifyToProduct(
    {
      id: '900',
      title: 'Categorized book',
      product_type: 'Antiquarian',
      category: 'Fiction > Classics',
      tags: [],
      images: [],
      variants: [{ price: '5.00' }],
    },
    { enrich: false }
  );
  const meta = JSON.parse(mapped.metadata);
  assert.equal(meta.category, 'Fiction > Classics');
  assert.equal(meta.product_type, 'Antiquarian');
});

test('facets aggregate tags, categories, vendors with counts', async () => {
  await insert('1', {
    tags: ['classic', 'fiction'],
    category: 'Fiction > Classics',
    vendor: 'Penguin',
    product_type: 'Book',
    binding: 'Hardcover',
    year: 1965,
  });
  await insert('2', {
    tags: ['classic'],
    product_type: 'Book',
    vendor: 'Penguin',
    publisher: 'Penguin',
    year: 1965,
  });
  await insert('3', { tags: [], vendor: null });

  const facets = await productService.getFacets();

  assert.deepEqual(
    facets.tags,
    [
      { value: 'classic', count: 2 },
      { value: 'fiction', count: 1 },
    ],
    'tags sorted by count desc'
  );
  assert.ok(facets.categories.some((c) => c.value === 'Fiction > Classics' && c.count === 1));
  assert.ok(facets.categories.some((c) => c.value === 'Book' && c.count === 2));
  assert.deepEqual(facets.vendors, [{ value: 'Penguin', count: 2 }]);
  assert.deepEqual(facets.years, [
    { value: 1965, count: 2 },
  ]);
  assert.ok(facets.bindings.some((b) => b.value === 'Hardcover'));
  assert.ok(facets.publishers.some((p) => p.value === 'Penguin'));
});

test('getAll filters by tag (any-match, case-insensitive)', async () => {
  const byTag = await productService.getAll({ tags: 'CLASSIC, nonexistent' });
  assert.equal(byTag.length, 2);
  assert.ok(byTag.every((p) => p.metadata.tags.includes('classic')));
});

test('getAll category filter matches category or product_type', async () => {
  const byTaxonomy = await productService.getAll({ category: 'fiction > classics' });
  assert.equal(byTaxonomy.length, 1);
  assert.equal(byTaxonomy[0].shopify_product_id, '1');

  const byType = await productService.getAll({ category: 'book' });
  assert.equal(byType.length, 2);
});

test('getAll vendor filter', async () => {
  const byVendor = await productService.getAll({ vendor: 'penguin' });
  assert.equal(byVendor.length, 2);
});

after(() => {
  testDb.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});
