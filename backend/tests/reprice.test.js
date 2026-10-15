const { test, after } = require('node:test');
const assert = require('node:assert/strict');

// PricePartner-style bulk reprice: dry-run diff vs commit, overlay semantics
// (Shopify truth untouched), guards. Patched-config temp DB pattern.
const path = require('path');
const fs = require('fs');
const os = require('os');
const Database = require('better-sqlite3');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thepanel-reprice-'));
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

const repriceService = require('../src/services/repriceService');
const productService = require('../src/services/productService');

const insertProduct = (price) => {
  const row = testDb
    .prepare(
      `INSERT INTO products (shopify_product_id, title, price, quantity)
       VALUES (?, ?, ?, 1) RETURNING *`
    )
    .get(String(Math.random()).slice(2), 'A Book', price);
  return row;
};

const truthPrice = (id) => testDb.prepare('SELECT price FROM products WHERE id = ?').get(id).price;

test('dry run returns the diff and applies nothing', async () => {
  const a = insertProduct(10.0);
  const b = insertProduct(25.0);

  const result = await repriceService.reprice([a.id, b.id], 'percent', 10, { dryRun: true });

  assert.equal(result.dry_run, true);
  assert.equal(result.applied, 0);
  const byId = Object.fromEntries(result.rows.map((r) => [r.product_id, r]));
  assert.equal(byId[a.id].from, 10);
  assert.equal(byId[a.id].to, 11);
  assert.equal(byId[b.id].to, 27.5);
  // Truth untouched, no overlay entries
  assert.equal(truthPrice(a.id), 10);
  assert.equal(
    testDb.prepare('SELECT COUNT(*) n FROM product_changes').get().n,
    0
  );
});

test('commit applies local price overrides (truth untouched, journaled)', async () => {
  const a = insertProduct(20.0);

  const result = await repriceService.reprice([a.id], 'set', 14.5);

  assert.equal(result.applied, 1);
  const effective = await productService.getById(a.id);
  assert.equal(effective.price, 14.5);
  assert.equal(truthPrice(a.id), 20); // Shopify truth untouched
  const entries = testDb
    .prepare("SELECT * FROM product_changes WHERE product_id = ? AND field = 'price'")
    .all(a.id);
  assert.equal(entries.length, 1);
  assert.equal(Number(entries[0].new_value), 14.5);
});

test('reprice chains on the effective (overlay) price', async () => {
  const a = insertProduct(10.0);
  await repriceService.reprice([a.id], 'set', 20); // override to 20

  await repriceService.reprice([a.id], 'amount', -5);

  const effective = await productService.getById(a.id);
  assert.equal(effective.price, 15); // (20) - 5, not truth(10) - 5
  assert.equal(truthPrice(a.id), 10);
});

test('guards: invalid mode rejected, non-positive results skipped', async () => {
  const a = insertProduct(10.0);
  const b = insertProduct(3.0);

  await assert.rejects(() => repriceService.reprice([a.id], 'bogus', 1), /invalid mode/);
  await assert.rejects(() => repriceService.reprice([], 'set', 5), /no products/);

  const result = await repriceService.reprice([a.id, b.id], 'amount', -5);
  // a: 10-5=5 ok · b: 3-5=-2 skipped
  assert.equal(result.applied, 1);
  assert.equal(result.skipped, 1);
  const skippedRow = result.rows.find((r) => r.product_id === b.id);
  assert.equal(skippedRow.skipped, true);
  assert.match(skippedRow.reason, /not positive/);
});

after(() => {
  testDb.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});
