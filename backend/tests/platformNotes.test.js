const { test, after } = require('node:test');
const assert = require('node:assert/strict');

// Per-platform versioning tests: platform notes are written directly to
// platform_listings (they have no Shopify counterpart) and every change is
// journaled into product_changes scoped to the platform. Deleting a platform
// entry peels the fields back to the previous version. Base-field overlays
// ignore platform-scoped entries entirely.

const path = require('path');
const fs = require('fs');
const os = require('os');
const Database = require('better-sqlite3');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thepanel-platformnotes-'));
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
    status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft', 'exported', 'active', 'sold', 'error', 'delisted')),
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
    source TEXT NOT NULL DEFAULT 'manual' CHECK(source IN ('manual', 'sync')),
    run_id TEXT,
    changed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
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

const changeLogService = require('../src/services/changeLogService');
const platformListingService = require('../src/services/platformListingService');

const insertProduct = (shopifyId) =>
  testDb
    .prepare(
      `INSERT INTO products (shopify_product_id, title, description, price, quantity)
       VALUES (?, ?, ?, ?, ?) RETURNING *`
    )
    .get(shopifyId, 'The Hobbit', '<p>Truth</p>', 10.0, 1);

test('saving notes creates the listing row and journals a platform-scoped version', () => {
  const row = insertProduct('pn-100');

  const listing = platformListingService.savePlatformFields(row.id, 'ebay', {
    notes: 'Ships in a box, not a bag.',
  });

  assert.equal(listing.platform, 'ebay');
  assert.equal(listing.status, 'draft');
  assert.equal(listing.notes, 'Ships in a box, not a bag.');

  const history = changeLogService.getHistory(row.id);
  assert.equal(history.length, 1);
  assert.equal(history[0].platform, 'ebay');
  assert.equal(history[0].source, 'manual');
  assert.equal(history[0].changes[0].field, 'notes');
  assert.equal(history[0].changes[0].old_value, null);
  assert.equal(history[0].changes[0].new_value, 'Ships in a box, not a bag.');
});

test('second save stacks a new version; unchanged values record nothing', () => {
  const row = insertProduct('pn-101');
  platformListingService.savePlatformFields(row.id, 'abebooks', { notes: 'First note' });
  platformListingService.savePlatformFields(row.id, 'abebooks', { notes: 'First note' }); // no-op

  let history = changeLogService.getHistory(row.id);
  assert.equal(history.length, 1);

  platformListingService.savePlatformFields(row.id, 'abebooks', { notes: 'Second note' });
  history = changeLogService.getHistory(row.id);
  assert.equal(history.length, 2);
  assert.equal(history[0].platform, 'abebooks');
  assert.equal(history[0].changes[0].old_value, 'First note');
  assert.equal(history[0].changes[0].new_value, 'Second note');
});

test('deleting the newest platform entry peels notes back to the previous version', () => {
  const row = insertProduct('pn-102');
  platformListingService.savePlatformFields(row.id, 'etsy', { notes: 'v1' });
  platformListingService.savePlatformFields(row.id, 'etsy', { notes: 'v2' });

  const history = changeLogService.getHistory(row.id);
  const deleted = platformListingService.deletePlatformChangeEntry(row.id, history[0].change_id);
  assert.equal(deleted.platform, 'etsy');

  const listing = platformListingService.getListingByPlatform(row.id, 'etsy');
  assert.equal(listing.notes, 'v1');

  // and peeling the last version clears the field
  const remaining = changeLogService.getHistory(row.id);
  platformListingService.deletePlatformChangeEntry(row.id, remaining[0].change_id);
  const cleared = platformListingService.getListingByPlatform(row.id, 'etsy');
  assert.equal(cleared.notes, null);
});

test('platform entries never overlay base fields', () => {
  const row = insertProduct('pn-103');
  platformListingService.savePlatformFields(row.id, 'ebay', { notes: 'ebay-only' });

  const overrides = changeLogService.getOverrides(row.id);
  assert.equal(overrides.has('notes'), false);
  assert.equal(overrides.size, 0);
});

test('platform versions are isolated per platform', () => {
  const row = insertProduct('pn-104');
  platformListingService.savePlatformFields(row.id, 'ebay', { notes: 'ebay note' });
  platformListingService.savePlatformFields(row.id, 'abebooks', { notes: 'abebooks note' });

  const ebay = platformListingService.getListingByPlatform(row.id, 'ebay');
  const abebooks = platformListingService.getListingByPlatform(row.id, 'abebooks');
  assert.equal(ebay.notes, 'ebay note');
  assert.equal(abebooks.notes, 'abebooks note');

  const history = changeLogService.getHistory(row.id);
  assert.equal(history.length, 2);
  assert.equal(new Set(history.map((e) => e.platform)).size, 2);
});

test('global history filters by platform, including base-only', () => {
  const base = insertProduct('pn-105');
  const withNotes = insertProduct('pn-106');

  changeLogService.record(base.id, 'manual', [{ field: 'price', oldValue: 10, newValue: 12 }]);
  platformListingService.savePlatformFields(withNotes.id, 'ebay', { notes: 'note' });

  const all = changeLogService.getAllHistory({ productId: base.id });
  assert.equal(all.total, 1);

  const ebayOnly = changeLogService.getAllHistory({ platform: 'ebay' });
  assert.equal(ebayOnly.total >= 1, true);
  assert.ok(
    ebayOnly.entries.some((e) => e.product_id === withNotes.id && e.platform === 'ebay'),
    'ebay filter finds this product entry'
  );

  const baseOnly = changeLogService.getAllHistory({ platform: 'base' });
  assert.equal(baseOnly.total, 1);
  assert.equal(baseOnly.entries[0].platform, null);

  // search matches product title
  const searched = changeLogService.getAllHistory({ search: 'Hobbit' });
  assert.equal(searched.total >= 2, true);
});

test('invalid platform is rejected', () => {
  const row = insertProduct('pn-107');
  assert.throws(() => platformListingService.savePlatformFields(row.id, 'shopify', { notes: 'x' }));
});

after(() => {
  testDb.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});
