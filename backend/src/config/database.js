const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

// Create database directory if it doesn't exist
const dbDir = path.join(__dirname, '../../database');
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const dbPath = path.join(dbDir, 'thepanel.db');

// Initialize SQLite database
const db = new Database(dbPath, { verbose: console.log });

// Enable foreign keys
db.pragma('foreign_keys = ON');

console.log(`Connected to SQLite database at ${dbPath}`);

// Helper function to run queries
const query = (sql, params = []) => {
  try {
    const stmt = db.prepare(sql);
    if (sql.trim().toUpperCase().startsWith('SELECT')) {
      return { rows: stmt.all(params) };
    } else {
      const info = stmt.run(params);
      return { rows: [{ id: info.lastInsertRowid, changes: info.changes }] };
    }
  } catch (error) {
    console.error('Database query error:', error);
    throw error;
  }
};

module.exports = {
  db,
  query,
};
