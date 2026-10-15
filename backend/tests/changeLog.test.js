const { test, after } = require('node:test');
const assert = require('node:assert/strict');

// Overlay change-log tests: manual edits never touch the truth row, sync
// always overwrites the truth row, deletions peel edits back to truth.
// Uses a temp DB through the patched config module (same pattern as
// syncMapping.test.js).
const path = require('path');
const fs = require('fs');
const os = require('os');
const Database = require('better-sqlite3');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thepanel-changelog-'));
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
const changeLogService = require('../src/services/changeLogService');

const insertProduct = (overrides = {}) => {
  const row = testDb
    .prepare(
      `INSERT INTO products (shopify_product_id, title, description, price, quantity, author)
       VALUES (?, ?, ?, ?, ?, ?) RETURNING *`
    )
    .get(
      overrides.shopify_product_id || '111',
      overrides.title || 'The Hobbit',
      overrides.description || '<p>Original truth</p>',
      overrides.price ?? 10.0,
      overrides.quantity ?? 1,
      overrides.author ?? null
    );
  return row;
};

const truthRow = (id) => testDb.prepare('SELECT * FROM products WHERE id = ?').get(id);

test('manual edit records overlay without touching truth', async () => {
  const row = insertProduct();
  const edited = await productService.applyEdit(row.id, {
    title: 'The Hobbit (Annotated)',
    description: '<p>New description</p>',
  });

  // Truth row unchanged
  const truth = truthRow(row.id);
  assert.equal(truth.title, 'The Hobbit');
  assert.equal(truth.description, '<p>Original truth</p>');

  // Effective view shows the edit + truth snapshot for comparison
  assert.equal(edited.title, 'The Hobbit (Annotated)');
  assert.equal(edited.local_edits.includes('title'), true);
  assert.equal(edited.shopify_truth.title, 'The Hobbit');
  assert.equal(edited.description, '<p>New description</p>');
});

test('edit with unchanged values records nothing', async () => {
  const row = insertProduct({ shopify_product_id: '222' });
  await productService.applyEdit(row.id, { title: 'The Hobbit', price: 10 });

  const history = changeLogService.getHistory(row.id);
  assert.equal(history.length, 0);
});

test('number normalization: string price from form is treated as number', async () => {
  const row = insertProduct({ shopify_product_id: '333', price: 15.5 });
  await productService.applyEdit(row.id, { price: '15.50' });

  const history = changeLogService.getHistory(row.id);
  // 15.50 === 15.5 -> no entry
  assert.equal(history.length, 0);

  await productService.applyEdit(row.id, { price: '20' });
  const history2 = changeLogService.getHistory(row.id);
  assert.equal(history2.length, 1);
  assert.equal(history2[0].changes.find((c) => c.field === 'price').new_value, 20);
});

test('second edit stacks on the overlay, not the truth', async () => {
  const row = insertProduct({ shopify_product_id: '444', price: 10 });
  await productService.applyEdit(row.id, { price: 15 });
  await productService.applyEdit(row.id, { price: 20 });

  const view = await productService.getById(row.id);
  assert.equal(view.price, 20);

  const history = changeLogService.getHistory(row.id);
  assert.equal(history.length, 2);
  const newest = history[0].changes.find((c) => c.field === 'price');
  assert.equal(newest.old_value, 15);
  assert.equal(newest.new_value, 20);
});

test('sync overwrites truth and logs it, overlay survives', async () => {
  const row = insertProduct({ shopify_product_id: '555', price: 10 });
  await productService.applyEdit(row.id, { price: 15 });

  const results = await productService.syncProductsFromShopify(
    [
      {
        id: '555',
        title: 'The Hobbit',
        body_html: '<p>Updated on Shopify</p>',
        tags: [],
        images: [],
        variants: [{ price: '12.00', inventory_quantity: 1 }],
      },
    ],
    { enrich: false }
  );
  assert.equal(results.updated, 1);

  // Truth now reflects Shopify
  const truth = truthRow(row.id);
  assert.equal(truth.price, 12);
  assert.equal(truth.description, '<p>Updated on Shopify</p>');

  // Effective view still shows the local overlay
  const view = await productService.getById(row.id);
  assert.equal(view.price, 15);
  assert.equal(view.local_edits.includes('price'), true);
  assert.equal(view.shopify_truth.price, 12);

  // A 'sync' history entry was recorded for the truth change
  const history = changeLogService.getHistory(row.id);
  const syncEntry = history.find((e) => e.source === 'sync');
  assert.ok(syncEntry, 'sync entry recorded');
  const priceChange = syncEntry.changes.find((c) => c.field === 'price');
  assert.equal(priceChange.old_value, 10);
  assert.equal(priceChange.new_value, 12);
});

test('deleting the newest manual entry peels back to truth', async () => {
  const row = insertProduct({ shopify_product_id: '666', price: 10 });
  await productService.applyEdit(row.id, { price: 15 });

  let view = await productService.getById(row.id);
  assert.equal(view.price, 15);

  const history = changeLogService.getHistory(row.id);
  const deleted = changeLogService.deleteEntry(row.id, history[0].change_id);
  assert.equal(deleted.source, 'manual');

  view = await productService.getById(row.id);
  assert.equal(view.price, 10); // back to truth
  assert.equal(view.local_edits.length, 0);
});

test('deleting newest of stacked edits peels to previous edit', async () => {
  const row = insertProduct({ shopify_product_id: '777', price: 10 });
  await productService.applyEdit(row.id, { price: 15 });
  await productService.applyEdit(row.id, { price: 20 });

  const history = changeLogService.getHistory(row.id);
  changeLogService.deleteEntry(row.id, history[0].change_id); // delete the 15->20 edit

  const view = await productService.getById(row.id);
  assert.equal(view.price, 15); // previous manual value, not truth
});

test('reset removes all manual overlays, keeps sync history', async () => {
  const row = insertProduct({ shopify_product_id: '888', price: 10 });
  await productService.applyEdit(row.id, { price: 15, title: 'Local title' });

  // force a sync truth change so a sync entry exists
  await productService.syncProductsFromShopify(
    [
      {
        id: '888',
        title: 'Shopify title',
        body_html: '<p>d</p>',
        tags: [],
        images: [],
        variants: [{ price: '11.00', inventory_quantity: 1 }],
      },
    ],
    { enrich: false }
  );

  changeLogService.deleteAllManual(row.id);

  const view = await productService.getById(row.id);
  assert.equal(view.price, 11); // truth
  assert.equal(view.title, 'Shopify title');
  assert.equal(view.local_edits.length, 0);

  const history = changeLogService.getHistory(row.id);
  assert.equal(history.length, 1);
  assert.equal(history[0].source, 'sync');
});

test('markSold records quantity overlay and sold truth', async () => {
  const row = insertProduct({ shopify_product_id: '999', quantity: 1 });
  const sold = await productService.markSold(row.id, 'manual');

  const truth = truthRow(row.id);
  assert.equal(truth.sold_at !== null, true);
  assert.equal(truth.sold_via, 'manual');
  assert.equal(truth.quantity, 1); // truth untouched

  assert.equal(sold.quantity, 0); // effective via overlay
});

test('explicitly cleared field stays cleared (does not fall back to truth)', async () => {
  const row = insertProduct({ shopify_product_id: '1010', author: 'Tolkien' });
  await productService.applyEdit(row.id, { author: '' });

  const view = await productService.getById(row.id);
  assert.equal(view.author, null);
  assert.equal(view.local_edits.includes('author'), true);
  assert.equal(view.shopify_truth.author, 'Tolkien');
});

test('create normalizes object images/metadata and missing shopify id', async () => {
  const created = await productService.create({
    title: 'Local book',
    price: '5.99',
    quantity: '2',
    images: ['https://example.com/a.jpg'],
    metadata: { vendor: 'Acme' },
  });
  assert.match(created.shopify_product_id, /^local-/);
  assert.equal(created.price, 5.99);
  assert.equal(created.quantity, 2);
  assert.deepEqual(created.images, ['https://example.com/a.jpg']);
  assert.equal(created.metadata.vendor, 'Acme');
});

test('sync run id stamps entries and filters global history by run', async () => {
  const rowA = insertProduct({ shopify_product_id: 'run-a', price: 10 });
  const rowB = insertProduct({ shopify_product_id: 'run-b', price: 10 });

  await productService.syncProductsFromShopify(
    [
      {
        id: 'run-a',
        title: 'The Hobbit',
        body_html: '<p>a</p>',
        tags: [],
        images: [],
        variants: [{ price: '11.00', inventory_quantity: 1 }],
      },
    ],
    { enrich: false, runId: 'run-111' }
  );
  await productService.syncProductsFromShopify(
    [
      {
        id: 'run-b',
        title: 'The Hobbit',
        body_html: '<p>b</p>',
        tags: [],
        images: [],
        variants: [{ price: '12.00', inventory_quantity: 1 }],
      },
    ],
    { enrich: false, runId: 'run-222' }
  );

  const byRunA = changeLogService.getAllHistory({ runId: 'run-111' });
  assert.equal(byRunA.total, 1);
  assert.equal(byRunA.entries[0].run_id, 'run-111');
  assert.equal(byRunA.entries[0].source, 'sync');
  assert.equal(byRunA.entries[0].product_id, rowA.id);

  const byRunB = changeLogService.getAllHistory({ runId: 'run-222' });
  assert.equal(byRunB.total, 1);
  assert.equal(byRunB.entries[0].product_id, rowB.id);

  // manual entries carry no run id
  await productService.applyEdit(rowA.id, { price: 99 });
  const manual = changeLogService.getHistory(rowA.id).find((e) => e.source === 'manual');
  assert.equal(manual.run_id, null);
});

test('getAllHistory pages entries at the SQL level', async () => {
  for (let i = 0; i < 5; i++) {
    const row = insertProduct({ shopify_product_id: `pg-${i}`, title: `Page Book ${i}` });
    await productService.applyEdit(row.id, { price: 20 + i });
  }

  const page1 = changeLogService.getAllHistory({ search: 'Page Book', limit: 2, offset: 0 });
  assert.equal(page1.total, 5);
  assert.equal(page1.entries.length, 2);

  const page2 = changeLogService.getAllHistory({ search: 'Page Book', limit: 2, offset: 2 });
  assert.equal(page2.entries.length, 2);

  const page3 = changeLogService.getAllHistory({ search: 'Page Book', limit: 2, offset: 4 });
  assert.equal(page3.entries.length, 1);

  // no overlap, all 5 covered, newest insert first
  const titles = [...page1.entries, ...page2.entries, ...page3.entries].map((e) => e.product_title);
  assert.deepEqual(titles, ['Page Book 4', 'Page Book 3', 'Page Book 2', 'Page Book 1', 'Page Book 0']);
});

test('purge supports the run_id scope', async () => {
  const row = insertProduct({ shopify_product_id: 'purge-run', price: 10 });
  await productService.syncProductsFromShopify(
    [
      {
        id: 'purge-run',
        title: 'The Hobbit',
        body_html: '<p>changed</p>',
        tags: [],
        images: [],
        variants: [{ price: '13.00', inventory_quantity: 1 }],
      },
    ],
    { enrich: false, runId: 'purge-run-1' }
  );

  const before = changeLogService.getAllHistory({ runId: 'purge-run-1' });
  assert.equal(before.total, 1);

  const purged = changeLogService.purgeEntries({ runId: 'purge-run-1' });
  assert.equal(purged.deleted_rows > 0, true);

  const after = changeLogService.getAllHistory({ runId: 'purge-run-1' });
  assert.equal(after.total, 0);
});

after(() => {
  testDb.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});
