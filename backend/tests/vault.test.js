const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');

// Vault tests run against an in-memory DB via a fresh require cache with env set.
process.env.APP_ENCRYPTION_KEY = crypto.randomBytes(32).toString('hex');

// encryption helpers are private to credentialService; test via the module
// with a temporary database path override
const path = require('path');
const fs = require('fs');
const os = require('os');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thepanel-test-'));
process.env.THISPANEL_DB_PATH = path.join(tmpDir, 'test.db');

// Re-init database module against the temp path by monkey-patching before require.
// Simplest: copy the migrate logic's table creation for platform_credentials.
const Database = require('better-sqlite3');
const testDb = new Database(process.env.THISPANEL_DB_PATH);
testDb.exec(`
  CREATE TABLE IF NOT EXISTS platform_credentials (
    platform TEXT PRIMARY KEY CHECK(platform IN ('ebay', 'abebooks', 'etsy')),
    credentials TEXT NOT NULL DEFAULT '{}',
    token_expires_at DATETIME,
    last_validated_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

// Patch the shared database module to point at our test DB before requiring services
const dbConfig = require('../src/config/database');
const originalQuery = dbConfig.query;
dbConfig.db = testDb;
dbConfig.query = (sql, params = []) => {
  const stmt = testDb.prepare(sql);
  return stmt.reader ? { rows: stmt.all(params) } : { rows: [{ id: 0, changes: stmt.run(params).changes }] };
};

// credentialService captured {db, query} at require time — require AFTER patching
const credentialService = require('../src/services/credentialService');

test('vault: save encrypts at rest and masked output has no raw secrets', () => {
  const secret = 'shpss_super_secret_value_123456';
  const masked = credentialService.save('ebay', { client_id: 'abc123', client_secret: secret });

  const row = testDb.prepare('SELECT credentials FROM platform_credentials WHERE platform = ?').get('ebay');
  assert.ok(!row.credentials.includes(secret), 'ciphertext must not contain the secret');
  const envelope = JSON.parse(row.credentials);
  assert.equal(envelope.alg, 'aes-256-gcm');
  assert.ok(envelope.iv && envelope.tag && envelope.data);

  assert.ok(!JSON.stringify(masked).includes(secret));
  assert.equal(masked.preview.client_secret, 'shpss_…3456');
});

test('vault: get decrypts server-side', () => {
  const stored = credentialService.get('ebay');
  assert.equal(stored.credentials.client_id, 'abc123');
  assert.equal(stored.credentials.client_secret, 'shpss_super_secret_value_123456');
});

test('vault: wrong key fails decryption instead of leaking garbage', () => {
  process.env.APP_ENCRYPTION_KEY = crypto.randomBytes(32).toString('hex');
  const masked = credentialService.getMasked('ebay');
  assert.ok(masked.preview._error);
  const stored = credentialService.get('ebay');
  assert.equal(stored.credentials._error !== undefined, true);
});

test('vault: remove deletes the row', () => {
  credentialService.remove('ebay');
  assert.equal(credentialService.get('ebay'), null);
});

test('vault: missing/invalid APP_ENCRYPTION_KEY rejected with guidance', () => {
  delete process.env.APP_ENCRYPTION_KEY;
  assert.throws(() => credentialService.save('etsy', { x: 1 }), /APP_ENCRYPTION_KEY/);
  process.env.APP_ENCRYPTION_KEY = 'too-short';
  assert.throws(() => credentialService.save('etsy', { x: 1 }), /APP_ENCRYPTION_KEY/);
});

test('vault: test-connection stubs', async () => {
  process.env.APP_ENCRYPTION_KEY = crypto.randomBytes(32).toString('hex');
  credentialService.save('abebooks', { api_key: 'k' });
  const none = await credentialService.testConnection('etsy');
  assert.equal(none.success, false);
  const abe = await credentialService.testConnection('abebooks');
  assert.equal(abe.success, true);
});

test('db: query paths sanity (SELECT vs write) on patched module', () => {
  const result = dbConfig.query('SELECT COUNT(*) AS n FROM platform_credentials');
  assert.ok(Array.isArray(result.rows));
});

after(() => {
  testDb.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});
