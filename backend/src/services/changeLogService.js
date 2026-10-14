const { db, query } = require('../config/database');

// Values are stored as TEXT: scalars stringified, null kept as null.
// Field kinds decide how to parse values back for display/compare.
const FIELD_KINDS = {
  price: 'number',
  cost: 'number',
  quantity: 'number',
  images: 'json',
  metadata: 'json',
};

const encodeValue = (value) => {
  if (value === null || value === undefined) return null;
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
};

const decodeValue = (field, value) => {
  if (value === null || value === undefined) return null;
  const kind = FIELD_KINDS[field];
  if (kind === 'number') {
    const n = Number(value);
    return Number.isFinite(n) ? n : value;
  }
  if (kind === 'json') {
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }
  return value;
};

const newChangeId = () =>
  Array.from({ length: 16 }, () => '0123456789abcdef'[Math.floor(Math.random() * 16)]).join('') +
  Date.now().toString(16);

class ChangeLogService {
  // Record one edit event: changes = [{ field, oldValue, newValue }]
  // All rows share a change_id so they display and delete as a single entry.
  record(productId, source, changes) {
    const rows = changes.filter((c) => c.field);
    if (rows.length === 0) return null;

    const changeId = newChangeId();
    const insert = db.prepare(`
      INSERT INTO product_changes (change_id, product_id, field, old_value, new_value, source)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    db.transaction(() => {
      for (const c of rows) {
        insert.run(changeId, productId, c.field, encodeValue(c.oldValue), encodeValue(c.newValue), source);
      }
    })();

    return { change_id: changeId, source, field_count: rows.length };
  }

  // Newest manual overlay value per field. A Map entry with value null means
  // "explicitly cleared" — distinct from no entry ("use the truth value").
  getOverrides(productId) {
    const rows = query(
      `SELECT field, new_value FROM product_changes
       WHERE product_id = ? AND source = 'manual'
       ORDER BY changed_at ASC, rowid ASC`,
      [productId]
    ).rows;

    const overrides = new Map();
    for (const row of rows) {
      overrides.set(row.field, decodeValue(row.field, row.new_value));
    }
    return overrides;
  }

  // Overrides for many products at once (for list endpoints).
  getOverridesForProducts(productIds) {
    const map = new Map(); // productId -> Map(field -> value)
    if (!productIds || productIds.length === 0) return map;
    const placeholders = productIds.map(() => '?').join(', ');
    const rows = query(
      `SELECT product_id, field, new_value FROM product_changes
       WHERE source = 'manual' AND product_id IN (${placeholders})
       ORDER BY changed_at ASC, rowid ASC`,
      productIds
    ).rows;
    for (const row of rows) {
      if (!map.has(row.product_id)) map.set(row.product_id, new Map());
      map.get(row.product_id).set(row.field, decodeValue(row.field, row.new_value));
    }
    return map;
  }

  // Full history grouped into entries (one edit / one sync event), newest first.
  getHistory(productId, limit = 100) {
    const rows = query(
      `SELECT pc.*, p.title AS product_title
       FROM product_changes pc
       LEFT JOIN products p ON pc.product_id = p.id
       WHERE pc.product_id = ?
       ORDER BY pc.changed_at DESC, pc.rowid DESC`,
      [productId]
    ).rows;

    const entries = [];
    const byChangeId = new Map();
    for (const row of rows) {
      let entry = byChangeId.get(row.change_id);
      if (!entry) {
        entry = {
          change_id: row.change_id,
          product_id: row.product_id,
          source: row.source,
          changed_at: row.changed_at,
          changes: [],
        };
        byChangeId.set(row.change_id, entry);
        entries.push(entry);
      }
      entry.changes.push({
        field: row.field,
        old_value: decodeValue(row.field, row.old_value),
        new_value: decodeValue(row.field, row.new_value),
      });
    }
    return entries.slice(0, limit);
  }

  getEntry(productId, changeId) {
    const rows = query(
      `SELECT * FROM product_changes WHERE product_id = ? AND change_id = ?`,
      [productId, changeId]
    ).rows;
    if (rows.length === 0) return null;
    return {
      change_id: changeId,
      product_id: rows[0].product_id,
      source: rows[0].source,
      changed_at: rows[0].changed_at,
      changes: rows.map((r) => ({
        field: r.field,
        old_value: decodeValue(r.field, r.old_value),
        new_value: decodeValue(r.field, r.new_value),
      })),
    };
  }

  // Delete one history entry. For 'manual' entries this also peels the edit:
  // affected fields fall back to the previous manual value or the truth value.
  deleteEntry(productId, changeId) {
    const entry = this.getEntry(productId, changeId);
    if (!entry) return null;

    query('DELETE FROM product_changes WHERE product_id = ? AND change_id = ?', [productId, changeId]);
    return entry;
  }

  // Remove ALL manual overlays for a product (reset to Shopify truth).
  // 'sync' history entries are kept — they record what Shopify changed.
  deleteAllManual(productId) {
    const info = query("DELETE FROM product_changes WHERE product_id = ? AND source = 'manual'", [productId]);
    return { deleted_entries: info.rows[0]?.changes ?? 0 };
  }
}

module.exports = new ChangeLogService();
module.exports.encodeValue = encodeValue;
module.exports.decodeValue = decodeValue;
