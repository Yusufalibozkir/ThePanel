const { test, after } = require('node:test');
const assert = require('node:assert/strict');

// AbeBooks export flow: full / delta / selection modes, rule evaluation with
// a skip report, TSV generation, and the export baseline (generate marks
// books 'exported'; delta then only includes new or changed books).

const path = require('path');
const fs = require('fs');
const os = require('os');
const Database = require('better-sqlite3');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thepanel-abebooks-'));
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
  CREATE TABLE platform_listings (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    product_id TEXT NOT NULL,
    platform TEXT NOT NULL CHECK(platform IN ('ebay', 'abebooks', 'etsy')),
    platform_listing_id TEXT,
    status TEXT NOT NULL DEFAULT 'draft',
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
  CREATE TABLE product_changes (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    change_id TEXT NOT NULL,
    product_id TEXT NOT NULL,
    platform TEXT,
    field TEXT NOT NULL,
    old_value TEXT,
    new_value TEXT,
    source TEXT NOT NULL DEFAULT 'manual',
    run_id TEXT,
    changed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
  );
  CREATE TABLE sync_rules (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    platform TEXT NOT NULL UNIQUE,
    enabled INTEGER NOT NULL DEFAULT 0,
    conditions TEXT DEFAULT '{}',
    price_modifier TEXT DEFAULT '{}',
    auto_sync INTEGER NOT NULL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE sync_logs (
    id TEXT PRIMARY KEY,
    product_id TEXT,
    platform TEXT NOT NULL,
    action TEXT NOT NULL,
    status TEXT NOT NULL,
    details TEXT DEFAULT '{}',
    error_message TEXT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
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
const platformListingService = require('../src/services/platformListingService');
const exportService = require('../src/services/abebooksExportService');

// Seed the plan's default AbeBooks rule: x1.15, min $4.50, condition filter
testDb
  .prepare(
    `INSERT INTO sync_rules (platform, enabled, conditions, price_modifier)
     VALUES ('abebooks', 1, ?, ?)`
  )
  .run(
    JSON.stringify({ conditions: ['new', 'like_new', 'very_good', 'good'] }),
    JSON.stringify({ multiplier: 1.15, fixed_fee: 0, min_price: 4.5, rounding: 'up_x99' })
  );

const insertProduct = (overrides = {}) =>
  testDb
    .prepare(
      `INSERT INTO products (shopify_product_id, title, description, price, quantity, condition, author, metadata, metadata_status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`
    )
    .get(
      overrides.shopify_product_id || `ab-${Math.random().toString(36).slice(2)}`,
      overrides.title || 'A Book',
      overrides.description || '<p>A fine copy.</p>',
      overrides.price ?? 10,
      overrides.quantity ?? 1,
      overrides.condition ?? 'very_good',
      overrides.author || 'Author Name',
      JSON.stringify(overrides.metadata || {}),
      overrides.metadata_status || 'ok'
    );

test('full export includes only rule-eligible books and reports skips', async () => {
  const ok = insertProduct({ title: 'Eligible Book' });
  // Note: a $1 book is NOT skipped — the pricing engine's min_price floor
  // lifts it to $4.50. Only condition/stock filters actually block books.
  insertProduct({ title: 'Cheap Floor Book', price: 1 });
  insertProduct({ title: 'Acceptable Condition', condition: 'acceptable' });
  insertProduct({ title: 'Sold Copy', quantity: 0 });

  const result = await exportService.buildExport({ mode: 'full' });

  assert.equal(result.rows.length, 2);
  assert.ok(result.rows.some((r) => r.title === 'Eligible Book' && r.price === '11.99')); // 10 × 1.15, rounded up to x.99
  assert.ok(result.rows.some((r) => r.title === 'Cheap Floor Book' && r.price === '4.99')); // lifted to the floor, then x.99
  assert.equal(result.skipped.length, 2);
});

test('generate marks books exported and logs the run', async () => {
  const book = insertProduct({ title: 'Export Me' });
  const result = await exportService.generate({ mode: 'full' });

  assert.ok(result.content.includes('Export Me'));
  assert.equal(result.filename.endsWith('.tsv'), true);

  const listing = platformListingService.getListingByPlatform(book.id, 'abebooks');
  assert.equal(listing.status, 'exported');
  assert.ok(listing.last_exported_at);

  const log = testDb
    .prepare("SELECT * FROM sync_logs WHERE platform = 'abebooks' AND action = 'export'")
    .all();
  assert.equal(log.length, 1);
  assert.equal(JSON.parse(log[0].details).exported >= 1, true);
});

test('delta export starts empty after a full export, then picks up changes', async () => {
  const book = insertProduct({ title: 'Delta Book', price: 20 });
  await exportService.generate({ mode: 'full' });

  // Freshly exported: nothing new
  const empty = await exportService.buildExport({ mode: 'delta' });
  assert.equal(empty.rows.length, 0);

  // A local edit (overlay entry) marks the book changed since export
  await productService.applyEdit(book.id, { price: 21 });
  const changed = await exportService.buildExport({ mode: 'delta' });
  assert.equal(changed.rows.length, 1);
  assert.equal(changed.rows[0].title, 'Delta Book');
});

test('delta export picks up per-platform notes changes', async () => {
  const book = insertProduct({ title: 'Notes Delta', price: 20 });
  await exportService.generate({ mode: 'full' });

  // Freshly exported: this book is not pending (other books edited within
  // the 1-second look-back guard may legitimately reappear — check by title)
  const empty = await exportService.buildExport({ mode: 'delta' });
  assert.equal(empty.rows.filter((r) => r.title === 'Notes Delta').length, 0);

  platformListingService.savePlatformFields(book.id, 'abebooks', { notes: 'New notes make it changed.' });
  const changed = await exportService.buildExport({ mode: 'delta' });
  const row = changed.rows.find((r) => r.title === 'Notes Delta');
  assert.ok(row, 'notes change makes the book pending again');
  assert.ok(row.description.includes('New notes make it changed.'));
});

test('selection mode overrides rule conditions but never stock', async () => {
  const blocked = insertProduct({ title: 'Condition Blocked', condition: 'acceptable' });
  const sold = insertProduct({ title: 'Sold Book', quantity: 0 });

  const result = await exportService.buildExport({
    mode: 'selection',
    productIds: [blocked.id, sold.id],
  });

  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].title, 'Condition Blocked');
  assert.equal(result.rows[0].warnings.length > 0, true); // surfaces why the rule would have skipped it
  assert.equal(result.skipped.length, 1);
  assert.equal(result.skipped[0].reasons[0].includes('stock'), true);
});

test('preview has no side effects', async () => {
  const book = insertProduct({ title: 'Preview Only', price: 30 });
  const before = platformListingService.getListingByPlatform(book.id, 'abebooks');
  assert.equal(before, null);

  await exportService.buildExport({ mode: 'selection', productIds: [book.id] });

  const after = platformListingService.getListingByPlatform(book.id, 'abebooks');
  assert.equal(after, null); // no listing row, no export stamp
});

after(() => {
  testDb.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});
