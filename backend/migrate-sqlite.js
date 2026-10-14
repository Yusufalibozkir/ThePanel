const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const dbDir = path.join(__dirname, 'database');
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const dbPath = path.join(dbDir, 'thepanel.db');
const db = new Database(dbPath);
db.pragma('foreign_keys = ON');

console.log('Running SQLite migrations...');

const hasColumn = (table, column) =>
  db.prepare(`SELECT 1 FROM pragma_table_info('${table}') WHERE name = ?`).get(column) !== undefined;

const hasTable = (table) =>
  db.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?`).get(table) !== undefined;

try {
  db.exec(`
    CREATE TABLE IF NOT EXISTS products (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      shopify_product_id TEXT NOT NULL UNIQUE,
      isbn TEXT,
      title TEXT NOT NULL,
      author TEXT,
      description TEXT,
      price REAL NOT NULL,
      cost REAL,
      condition TEXT CHECK(condition IN ('new', 'like_new', 'very_good', 'good', 'acceptable')),
      quantity INTEGER NOT NULL DEFAULT 0,
      images TEXT DEFAULT '[]',
      metadata TEXT DEFAULT '{}',
      sold_at DATETIME,
      sold_via TEXT,
      metadata_status TEXT NOT NULL DEFAULT 'missing' CHECK(metadata_status IN ('ok', 'partial', 'unverified', 'missing')),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  if (hasTable('products')) {
    if (!hasColumn('products', 'sold_at')) {
      db.exec('ALTER TABLE products ADD COLUMN sold_at DATETIME');
    }
    if (!hasColumn('products', 'sold_via')) {
      db.exec("ALTER TABLE products ADD COLUMN sold_via TEXT");
    }
    if (!hasColumn('products', 'metadata_status')) {
      db.exec("ALTER TABLE products ADD COLUMN metadata_status TEXT NOT NULL DEFAULT 'missing' CHECK(metadata_status IN ('ok', 'partial', 'unverified', 'missing'))");
    }
  }
  console.log('✓ products table ready (v2 columns ensured)');

  db.exec(`CREATE INDEX IF NOT EXISTS idx_products_isbn ON products(isbn)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_products_shopify_id ON products(shopify_product_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_products_metadata_status ON products(metadata_status)`);

  // platform_listings: v2 renames platform_price -> external_price, adds 'exported'
  // status and last_exported_at. Rebuild from v1 shape if needed (only safe when empty).
  const needsListingsRebuild =
    hasTable('platform_listings') &&
    (!hasColumn('platform_listings', 'external_price') || !hasColumn('platform_listings', 'last_exported_at'));

  if (needsListingsRebuild) {
    const count = db.prepare('SELECT COUNT(*) AS n FROM platform_listings').get().n;
    if (count > 0) {
      throw new Error('platform_listings has rows but needs a v1->v2 rebuild; refusing to drop data');
    }
    db.exec('DROP TABLE platform_listings');
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS platform_listings (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      product_id TEXT NOT NULL,
      platform TEXT NOT NULL CHECK(platform IN ('ebay', 'abebooks', 'etsy')),
      platform_listing_id TEXT,
      status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft', 'exported', 'active', 'sold', 'error', 'delisted')),
      external_price REAL,
      platform_url TEXT,
      sync_enabled INTEGER NOT NULL DEFAULT 1,
      last_synced_at DATETIME,
      last_exported_at DATETIME,
      error_message TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
      UNIQUE(product_id, platform)
    )
  `);
  console.log('✓ platform_listings table ready (v2)');

  db.exec(`CREATE INDEX IF NOT EXISTS idx_listings_product ON platform_listings(product_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_listings_platform ON platform_listings(platform)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_listings_status ON platform_listings(status)`);

  db.exec(`
    CREATE TABLE IF NOT EXISTS sync_rules (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      platform TEXT NOT NULL UNIQUE CHECK(platform IN ('ebay', 'abebooks', 'etsy')),
      enabled INTEGER NOT NULL DEFAULT 0,
      conditions TEXT DEFAULT '{}',
      price_modifier TEXT DEFAULT '{}',
      auto_sync INTEGER NOT NULL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  const seedRule = db.prepare(`
    INSERT OR IGNORE INTO sync_rules (platform, enabled, conditions, price_modifier) VALUES (?, 0, ?, ?)
  `);
  seedRule.run('ebay', '{}', JSON.stringify({ multiplier: 1.10, fixed_fee: 0, min_price: 5.0, rounding: 'up_x99' }));
  seedRule.run('etsy', JSON.stringify({ vintage_only: true, year_before: 2006 }), JSON.stringify({ multiplier: 1.20, fixed_fee: 0, min_price: 10.0, rounding: 'up_x99' }));
  seedRule.run('abebooks', JSON.stringify({ conditions: ['new', 'like_new', 'very_good', 'good'] }), JSON.stringify({ multiplier: 1.15, fixed_fee: 0, min_price: 4.5, rounding: 'up_x99' }));
  console.log('✓ sync_rules table ready (defaults seeded)');

  // sync_logs: v2 adds platform 'shopify' and actions 'export'/'sync' to the CHECK
  // constraints. Rebuild from v1 shape, copying rows (old values are all valid in v2).
  const logsV1 =
    hasTable('sync_logs') &&
    !db
      .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'sync_logs'")
      .get()
      .sql.includes("'shopify'");

  if (logsV1) {
    db.exec('ALTER TABLE sync_logs RENAME TO sync_logs_v1');
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS sync_logs (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      product_id TEXT,
      platform TEXT NOT NULL CHECK(platform IN ('ebay', 'abebooks', 'etsy', 'shopify')),
      action TEXT NOT NULL CHECK(action IN ('create', 'update', 'delete', 'export', 'sync')),
      status TEXT NOT NULL CHECK(status IN ('success', 'failed', 'skipped')),
      details TEXT DEFAULT '{}',
      error_message TEXT,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE SET NULL
    )
  `);
  console.log('✓ sync_logs table ready');

  if (logsV1) {
    db.exec(`
      INSERT INTO sync_logs (id, product_id, platform, action, status, details, error_message, timestamp)
      SELECT id, product_id, platform, action, status, details, error_message, timestamp FROM sync_logs_v1
    `);
    db.exec('DROP TABLE sync_logs_v1');
    console.log('✓ migrated v1 sync_logs rows into v2 table');
  }

  db.exec(`CREATE INDEX IF NOT EXISTS idx_logs_product ON sync_logs(product_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_logs_platform ON sync_logs(platform)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_logs_status ON sync_logs(status)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_logs_timestamp ON sync_logs(timestamp)`);

  db.exec(`
    CREATE TABLE IF NOT EXISTS platform_credentials (
      platform TEXT PRIMARY KEY CHECK(platform IN ('ebay', 'abebooks', 'etsy')),
      credentials TEXT NOT NULL DEFAULT '{}',
      token_expires_at DATETIME,
      last_validated_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  console.log('✓ platform_credentials table ready');

  db.exec(`
    CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      type TEXT NOT NULL CHECK(type IN ('list', 'update', 'end_listing', 'sync_shopify', 'export_abebooks', 'backfill_metadata')),
      payload TEXT DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'running', 'done', 'failed')),
      attempts INTEGER NOT NULL DEFAULT 0,
      max_attempts INTEGER NOT NULL DEFAULT 3,
      next_run_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      last_error TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_jobs_status_next ON jobs(status, next_run_at)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_jobs_type ON jobs(type)`);
  console.log('✓ jobs table ready');

  db.exec(`
    CREATE TRIGGER IF NOT EXISTS update_products_timestamp
    AFTER UPDATE ON products
    BEGIN
      UPDATE products SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
    END
  `);
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS update_listings_timestamp
    AFTER UPDATE ON platform_listings
    BEGIN
      UPDATE platform_listings SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
    END
  `);
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS update_jobs_timestamp
    AFTER UPDATE ON jobs
    BEGIN
      UPDATE jobs SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
    END
  `);
  console.log('✓ triggers ready');

  console.log('\n✅ All migrations completed successfully!');
  console.log(`Database ready at: ${dbPath}\n`);
} catch (error) {
  console.error('❌ Migration failed:', error);
  process.exit(1);
} finally {
  db.close();
}
