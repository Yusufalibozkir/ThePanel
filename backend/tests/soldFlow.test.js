const { test, after } = require('node:test');
const assert = require('node:assert/strict');

// W3 closeBook tests: a sale closes the book exactly once — channel order
// idempotency via channel_orders, first-sale-wins sold_at, quantity overlay,
// and platform_listings fanned out to 'sold'. Uses the patched-config temp DB
// pattern from changeLog.test.js.
const path = require('path');
const fs = require('fs');
const os = require('os');
const Database = require('better-sqlite3');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thepanel-sold-'));
const testDb = new Database(path.join(tmpDir, 'test.db'));
testDb.exec(`
  CREATE TABLE products (
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
  CREATE TABLE product_changes (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    change_id TEXT NOT NULL,
    product_id TEXT NOT NULL,
    platform TEXT,
    field TEXT NOT NULL,
    old_value TEXT,
    new_value TEXT,
    source TEXT NOT NULL DEFAULT 'manual' CHECK(source IN ('manual', 'sync')),
    run_id TEXT,
    changed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
  );
  CREATE TABLE platform_listings (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    product_id TEXT NOT NULL,
    platform TEXT NOT NULL CHECK(platform IN ('ebay', 'abebooks', 'etsy')),
    platform_listing_id TEXT,
    status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft', 'publishing', 'exported', 'active', 'sold', 'error', 'delisted')),
    external_price REAL,
    platform_url TEXT,
    notes TEXT,
    title_override TEXT,
    sync_enabled INTEGER NOT NULL DEFAULT 1,
    last_synced_at DATETIME,
    last_exported_at DATETIME,
    error_message TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
    UNIQUE(product_id, platform)
  );
  CREATE TABLE channel_orders (
    platform TEXT NOT NULL,
    external_order_id TEXT NOT NULL,
    product_id TEXT NOT NULL,
    closed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (platform, external_order_id),
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
  );
`);

const dbConfig = require('../src/config/database');
dbConfig.db = testDb;
dbConfig.query = (sql, params = []) => {
  const stmt = testDb.prepare(sql);
  return stmt.reader
    ? { rows: stmt.all(params) }
    : { rows: [{ id: 0, changes: stmt.run(params).changes }] };
};

const productService = require('../src/services/productService');

const insertProduct = (overrides = {}) => {
  const row = testDb
    .prepare(
      `INSERT INTO products (shopify_product_id, title, price, quantity)
       VALUES (?, ?, ?, ?) RETURNING *`
    )
    .get(
      overrides.shopify_product_id || String(Math.random()).slice(2),
      overrides.title || 'The Hobbit',
      overrides.price ?? 10.0,
      overrides.quantity ?? 1
    );
  return row;
};

const insertListing = (productId, platform, status) => {
  testDb
    .prepare(
      'INSERT INTO platform_listings (product_id, platform, status) VALUES (?, ?, ?)'
    )
    .run(productId, platform, status);
};

const truthRow = (id) => testDb.prepare('SELECT * FROM products WHERE id = ?').get(id);
const listingStatus = (productId, platform) =>
  testDb
    .prepare('SELECT status FROM platform_listings WHERE product_id = ? AND platform = ?')
    .get(productId, platform)?.status;
const orderCount = (productId) =>
  testDb
    .prepare(productId ? 'SELECT COUNT(*) AS n FROM channel_orders WHERE product_id = ?' : 'SELECT COUNT(*) AS n FROM channel_orders')
    .get(...(productId ? [productId] : [])).n;

test('a sale closes the book: sold_at set, quantity overlay, listings fanned out', async () => {
  const row = insertProduct();
  insertListing(row.id, 'abebooks', 'exported');
  insertListing(row.id, 'ebay', 'active');
  insertListing(row.id, 'etsy', 'draft');

  const sold = await productService.markSold(row.id, 'abebooks', {
    platform: 'abebooks',
    externalOrderId: 'AB-1001',
  });

  const truth = truthRow(row.id);
  assert.ok(truth.sold_at);
  assert.equal(truth.sold_via, 'abebooks');
  assert.equal(sold.quantity, 0); // effective view via overlay
  assert.equal(listingStatus(row.id, 'abebooks'), 'sold');
  assert.equal(listingStatus(row.id, 'ebay'), 'sold');
  assert.equal(listingStatus(row.id, 'etsy'), 'sold');
  assert.equal(orderCount(row.id), 1);
});

test('same channel order reported twice closes the book exactly once', async () => {
  const row = insertProduct();
  insertListing(row.id, 'abebooks', 'exported');

  const first = await productService.markSold(row.id, 'abebooks', {
    platform: 'abebooks',
    externalOrderId: 'AB-2002',
  });
  const second = await productService.markSold(row.id, 'abebooks', {
    platform: 'abebooks',
    externalOrderId: 'AB-2002',
  });

  assert.equal(first.already_closed, undefined);
  assert.equal(second.already_closed, true);
  assert.equal(orderCount(row.id), 1);

  // First sale wins: sold_at unchanged by the duplicate report.
  assert.equal(truthRow(row.id).sold_at, first.sold_at);
});

test('a second platform reports the same sale: order recorded, closure untouched', async () => {
  const row = insertProduct();
  insertListing(row.id, 'ebay', 'active');
  insertListing(row.id, 'etsy', 'active');

  await productService.markSold(row.id, 'ebay', {
    platform: 'ebay',
    externalOrderId: 'EB-3003',
  });
  const soldViaBefore = truthRow(row.id).sold_via;
  const soldAtBefore = truthRow(row.id).sold_at;

  await productService.markSold(row.id, 'etsy', {
    platform: 'etsy',
    externalOrderId: 'ET-3004',
  });

  assert.equal(orderCount(row.id), 2);
  assert.equal(truthRow(row.id).sold_via, soldViaBefore);
  assert.equal(truthRow(row.id).sold_at, soldAtBefore);
  assert.equal(listingStatus(row.id, 'etsy'), 'sold');
});

test('manual mark (no order id) is repeatable without double journaling', async () => {
  const row = insertProduct();

  await productService.markSold(row.id, 'manual');
  const journalCount = testDb
    .prepare("SELECT COUNT(*) AS n FROM product_changes WHERE product_id = ? AND field = 'quantity'")
    .get(row.id).n;

  await productService.markSold(row.id, 'manual');

  // No second quantity entry: the book was already closed locally.
  const journalCountAfter = testDb
    .prepare("SELECT COUNT(*) AS n FROM product_changes WHERE product_id = ? AND field = 'quantity'")
    .get(row.id).n;
  assert.equal(journalCount, 1);
  assert.equal(journalCountAfter, 1);
});

test('error and delisted listings are not fanned out to sold', async () => {
  const row = insertProduct();
  insertListing(row.id, 'ebay', 'error');
  insertListing(row.id, 'etsy', 'delisted');

  await productService.markSold(row.id, 'ebay', {
    platform: 'ebay',
    externalOrderId: 'EB-4004',
  });

  assert.equal(listingStatus(row.id, 'ebay'), 'error');
  assert.equal(listingStatus(row.id, 'etsy'), 'delisted');
});

after(() => {
  testDb.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});
