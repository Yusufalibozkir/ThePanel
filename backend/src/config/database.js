const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

// Create database directory if it doesn't exist
const dbDir = path.join(__dirname, '../../database');
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const dbPath = path.join(dbDir, 'thepanel.db');

// SQL logging only in development
const verbose = process.env.NODE_ENV === 'development' ? console.log : undefined;
const db = new Database(dbPath, verbose ? { verbose } : {});

// Enable foreign keys
db.pragma('foreign_keys = ON');

console.log(`Connected to SQLite database at ${dbPath}`);

// Helper for SELECT-style calls kept from v1; prefer prepare()/RETURNING in new code.
const query = (sql, params = []) => {
  try {
    const stmt = db.prepare(sql);
    if (stmt.reader) {
      return { rows: stmt.all(params) };
    }
    const info = stmt.run(params);
    return { rows: [{ id: info.lastInsertRowid, changes: info.changes }] };
  } catch (error) {
    console.error('Database query error:', error);
    throw error;
  }
};

module.exports = {
  db,
  query,
};
