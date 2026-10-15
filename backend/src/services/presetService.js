const { db, query } = require('../config/database');

// Named, reusable flow configurations (C-5): every guided flow leaves its
// options behind as a preset (export mode, push options…). Generic key/value
// with a kind so different flows don't collide.

const KINDS = new Set(['abebooks_export', 'push']);
const MAX_NAME = 80;
const MAX_PAYLOAD_BYTES = 4096;

const parseRow = (row) => ({ ...row, payload: JSON.parse(row.payload || '{}') });

const list = (kind) => {
  let sql = 'SELECT * FROM presets';
  const params = [];
  if (kind) {
    sql += ' WHERE kind = ?';
    params.push(kind);
  }
  sql += ' ORDER BY name';
  return query(sql, params).rows.map(parseRow);
};

const create = ({ name, kind, payload = {} }) => {
  const cleanName = String(name || '').trim();
  if (!cleanName || cleanName.length > MAX_NAME) throw new Error('invalid preset name');
  if (!KINDS.has(kind)) throw new Error(`invalid preset kind: ${kind}`);
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    throw new Error('preset payload must be an object');
  }
  const serialized = JSON.stringify(payload);
  if (serialized.length > MAX_PAYLOAD_BYTES) throw new Error('preset payload too large');

  const row = db
    .prepare(
      `INSERT INTO presets (name, kind, payload) VALUES (?, ?, ?)
       ON CONFLICT(name, kind) DO UPDATE SET payload = excluded.payload, updated_at = CURRENT_TIMESTAMP
       RETURNING *`
    )
    .get(cleanName, kind, serialized);
  return parseRow(row);
};

const remove = (id) => {
  const info = db.prepare('DELETE FROM presets WHERE id = ?').run(id);
  return info.changes > 0;
};

module.exports = { list, create, remove, KINDS };
