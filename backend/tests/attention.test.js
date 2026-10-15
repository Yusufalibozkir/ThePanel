const { test, after } = require('node:test');
const assert = require('node:assert/strict');

// Attention aggregation: error listings + failed jobs + metadata gaps.
const path = require('path');
const fs = require('fs');
const os = require('os');
const Database = require('better-sqlite3');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thepanel-attention-'));
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
    quantity INTEGER NOT NULL DEFAULT 0,
    images TEXT DEFAULT '[]',
    metadata TEXT DEFAULT '{}',
    metadata_status TEXT NOT NULL DEFAULT 'missing',
    sold_at DATETIME,
    sold_via TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
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
  CREATE TABLE jobs (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    type TEXT NOT NULL,
    payload TEXT DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'running', 'done', 'failed')),
    attempts INTEGER NOT NULL DEFAULT 0,
    max_attempts INTEGER NOT NULL DEFAULT 3,
    next_run_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_error TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
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

const attentionService = require('../src/services/attentionService');

test('aggregates error listings, failed jobs, and metadata gaps', () => {
  const product = testDb
    .prepare('INSERT INTO products (shopify_product_id, title, price, quantity, metadata_status) VALUES (?, ?, ?, 1, ?) RETURNING *')
    .get('1', 'Failing Book', 10, 'missing');
  testDb
    .prepare("INSERT INTO platform_listings (product_id, platform, status, error_message) VALUES (?, 'ebay', 'error', ?)")
    .run(product.id, 'category required');
  testDb
    .prepare("INSERT INTO jobs (type, status, attempts, max_attempts, last_error) VALUES ('list', 'failed', 3, 3, 'publish failed')")
    .run();
  testDb
    .prepare("INSERT INTO products (shopify_product_id, title, price, quantity, metadata_status) VALUES ('2', 'Unverified Book', 5, 1, 'unverified')")
    .run();
  // A sold book with missing metadata should not demand attention
  testDb
    .prepare("INSERT INTO products (shopify_product_id, title, price, quantity, metadata_status, sold_at) VALUES ('3', 'Sold Book', 5, 0, 'missing', CURRENT_TIMESTAMP)")
    .run();

  const attention = attentionService.build();

  assert.equal(attention.listings_error.count, 1);
  assert.equal(attention.listings_error.items[0].title, 'Failing Book');
  assert.equal(attention.listings_error.items[0].error_message, 'category required');
  assert.equal(attention.failed_jobs.count, 1);
  assert.equal(attention.failed_jobs.items[0].last_error, 'publish failed');
  assert.equal(attention.metadata_missing.count, 1); // sold book excluded
  assert.equal(attention.metadata_unverified.count, 1);
  assert.equal(attention.total, 4);
});

test('clean panel reports zero attention', () => {
  testDb.exec('DELETE FROM platform_listings');
  testDb.exec('DELETE FROM jobs');
  testDb.exec('DELETE FROM products');

  const attention = attentionService.build();
  assert.equal(attention.total, 0);
  assert.deepEqual(attention.listings_error.items, []);
  assert.deepEqual(attention.failed_jobs.items, []);
});

after(() => {
  testDb.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});
