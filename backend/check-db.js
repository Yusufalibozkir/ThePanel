const Database = require('better-sqlite3');
const db = new Database('database/thepanel.db');

console.log('\n=== Database Tables ===');
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
console.log(tables.map(t => t.name).join(', '));

console.log('\n=== Products Count ===');
const productCount = db.prepare('SELECT COUNT(*) as count FROM products').get();
console.log(`Products: ${productCount.count}`);

console.log('\n=== Sync Logs Count ===');
const logCount = db.prepare('SELECT COUNT(*) as count FROM sync_logs').get();
console.log(`Sync Logs: ${logCount.count}`);

console.log('\n✅ Database check complete\n');
db.close();
