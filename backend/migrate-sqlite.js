const Database = require('better-sqlite3');
const path = require('path');

// Create database directory if it doesn't exist
const fs = require('fs');
const dbDir = path.join(__dirname, '../database');
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const dbPath = path.join(dbDir, 'thepanel.db');

// Initialize SQLite database
const db = new Database(dbPath, { verbose: console.log });

// Enable foreign keys
db.pragma('foreign_keys = ON');

console.log('Running SQLite migrations...');

try {
  // Create products table
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
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  console.log('✓ Created products table');

  // Create indexes for products
  db.exec(`CREATE INDEX IF NOT EXISTS idx_products_isbn ON products(isbn)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_products_shopify_id ON products(shopify_product_id)`);
  console.log('✓ Created products indexes');

  // Create platform_listings table
  db.exec(`
    CREATE TABLE IF NOT EXISTS platform_listings (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      product_id TEXT NOT NULL,
      platform TEXT NOT NULL CHECK(platform IN ('ebay', 'abebooks', 'etsy')),
      platform_listing_id TEXT,
      status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft', 'active', 'sold', 'error', 'delisted')),
      platform_price REAL,
      platform_url TEXT,
      sync_enabled INTEGER NOT NULL DEFAULT 1,
      last_synced_at DATETIME,
      error_message TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
      UNIQUE(product_id, platform)
    )
  `);
  console.log('✓ Created platform_listings table');

  // Create indexes for platform_listings
  db.exec(`CREATE INDEX IF NOT EXISTS idx_listings_product ON platform_listings(product_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_listings_platform ON platform_listings(platform)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_listings_status ON platform_listings(status)`);
  console.log('✓ Created platform_listings indexes');

  // Create sync_rules table
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
  console.log('✓ Created sync_rules table');

  // Create sync_logs table
  db.exec(`
    CREATE TABLE IF NOT EXISTS sync_logs (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      product_id TEXT,
      platform TEXT NOT NULL CHECK(platform IN ('ebay', 'abebooks', 'etsy')),
      action TEXT NOT NULL CHECK(action IN ('create', 'update', 'delete')),
      status TEXT NOT NULL CHECK(status IN ('success', 'failed')),
      details TEXT DEFAULT '{}',
      error_message TEXT,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE SET NULL
    )
  `);
  console.log('✓ Created sync_logs table');

  // Create indexes for sync_logs
  db.exec(`CREATE INDEX IF NOT EXISTS idx_logs_product ON sync_logs(product_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_logs_platform ON sync_logs(platform)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_logs_status ON sync_logs(status)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_logs_timestamp ON sync_logs(timestamp)`);
  console.log('✓ Created sync_logs indexes');

  // Create platform_credentials table
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
  console.log('✓ Created platform_credentials table');

  // Create trigger to update updated_at timestamp
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

  console.log('✓ Created triggers');
  console.log('\n✅ All migrations completed successfully!');
  console.log('Database ready at: database/thepanel.db\n');

} catch (error) {
  console.error('❌ Migration failed:', error);
  process.exit(1);
}
