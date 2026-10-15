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
  // platform = null means base product data (the Shopify-truth overlay);
  // 'ebay'/'abebooks'/'etsy' scopes the entry to that platform's listing fields.
  // runId links sync-source entries to the sync run (sync_logs row id) that
  // produced them.
  record(productId, source, changes, platform = null, runId = null) {
    const rows = changes.filter((c) => c.field);
    if (rows.length === 0) return null;

    const changeId = newChangeId();
    const insert = db.prepare(`
      INSERT INTO product_changes (change_id, product_id, platform, field, old_value, new_value, source, run_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    db.transaction(() => {
      for (const c of rows) {
        insert.run(changeId, productId, platform, c.field, encodeValue(c.oldValue), encodeValue(c.newValue), source, runId);
      }
    })();

    return { change_id: changeId, source, platform, run_id: runId, field_count: rows.length };
  }

  // Newest manual overlay value per base field (platform IS NULL). A Map entry
  // with value null means "explicitly cleared" — distinct from no entry
  // ("use the truth value"). Platform-scoped entries never overlay base fields.
  getOverrides(productId) {
    const rows = query(
      `SELECT field, new_value FROM product_changes
       WHERE product_id = ? AND source = 'manual' AND platform IS NULL
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
       WHERE source = 'manual' AND platform IS NULL AND product_id IN (${placeholders})
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
    return this.groupRows(rows).slice(0, limit);
  }

  // Shared WHERE builder for history queries. Filters are applied per-row, so
  // an entry whose save touched several fields can appear as a partial group
  // when filtering by field (matching the panel's per-field semantics).
  buildHistoryWhere(filters, alias, joinAlias) {
    const where = [];
    const params = [];
    if (filters.productId) {
      where.push(`${alias}.product_id = ?`);
      params.push(filters.productId);
    }
    if (filters.platform === 'base') {
      where.push(`${alias}.platform IS NULL`);
    } else if (filters.platform) {
      where.push(`${alias}.platform = ?`);
      params.push(filters.platform);
    }
    if (filters.source) {
      where.push(`${alias}.source = ?`);
      params.push(filters.source);
    }
    if (filters.field) {
      where.push(`${alias}.field = ?`);
      params.push(filters.field);
    }
    if (filters.runId) {
      where.push(`${alias}.run_id = ?`);
      params.push(filters.runId);
    }
    if (filters.search) {
      where.push(`${joinAlias}.title LIKE ?`);
      params.push(`%${filters.search}%`);
    }
    return { where, params };
  }

  // Global history across all products with filters, for the Logs panel.
  // platform: 'base' -> NULL, 'ebay'/'abebooks'/'etsy' -> that platform,
  // anything else -> no filter. search matches the product title. runId
  // restricts to the changes produced by one sync run.
  // Pagination is SQL-level: the inner query pages change_id groups, the
  // outer fetches only the rows of that page (filters re-applied per-row).
  getAllHistory(filters = {}) {
    const outer = this.buildHistoryWhere(filters, 'pc', 'p');
    const inner = this.buildHistoryWhere(filters, 'pc2', 'p2');

    const total = query(
      `SELECT COUNT(DISTINCT pc.change_id) AS n
       FROM product_changes pc
       LEFT JOIN products p ON pc.product_id = p.id
       ${outer.where.length > 0 ? `WHERE ${outer.where.join(' AND ')}` : ''}`,
      outer.params
    ).rows[0].n;

    const offset = Math.max(parseInt(filters.offset, 10) || 0, 0);
    const limit = Math.max(parseInt(filters.limit, 10) || 50, 1);

    const rows = query(
      `SELECT pc.*, p.title AS product_title
       FROM product_changes pc
       LEFT JOIN products p ON pc.product_id = p.id
       WHERE ${[
         ...outer.where,
         `pc.change_id IN (
            SELECT pc2.change_id
            FROM product_changes pc2
            LEFT JOIN products p2 ON pc2.product_id = p2.id
            ${inner.where.length > 0 ? `WHERE ${inner.where.join(' AND ')}` : ''}
            GROUP BY pc2.change_id
            ORDER BY MAX(pc2.changed_at) DESC, MAX(pc2.rowid) DESC
            LIMIT ? OFFSET ?
          )`,
       ].join(' AND ')}
       ORDER BY pc.changed_at DESC, pc.rowid DESC`,
      [...outer.params, ...inner.params, limit, offset]
    ).rows;

    return {
      entries: this.groupRows(rows),
      total,
      offset,
      limit,
    };
  }

  // Group raw product_changes rows into entries keyed by change_id, newest first.
  groupRows(rows) {
    const entries = [];
    const byChangeId = new Map();
    for (const row of rows) {
      let entry = byChangeId.get(row.change_id);
      if (!entry) {
        entry = {
          change_id: row.change_id,
          product_id: row.product_id,
          product_title: row.product_title ?? null,
          platform: row.platform ?? null,
          source: row.source,
          run_id: row.run_id ?? null,
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
    return entries;
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
      platform: rows[0].platform ?? null,
      source: rows[0].source,
      run_id: rows[0].run_id ?? null,
      changed_at: rows[0].changed_at,
      changes: rows.map((r) => ({
        field: r.field,
        old_value: decodeValue(r.field, r.old_value),
        new_value: decodeValue(r.field, r.new_value),
      })),
    };
  }

  // Delete one history entry. For base 'manual' entries this also peels the
  // edit: affected fields fall back to the previous manual value or the truth
  // value. Platform 'manual' entries are peeled by platformListingService
  // (which owns the platform_listings truth) — coordinate there.
  deleteEntry(productId, changeId) {
    const entry = this.getEntry(productId, changeId);
    if (!entry) return null;

    query('DELETE FROM product_changes WHERE product_id = ? AND change_id = ?', [productId, changeId]);
    return entry;
  }

  // Remove ALL manual base overlays for a product (reset to Shopify truth).
  // 'sync' history and platform-scoped entries are kept.
  deleteAllManual(productId) {
    const info = query(
      "DELETE FROM product_changes WHERE product_id = ? AND source = 'manual' AND platform IS NULL",
      [productId]
    );
    return { deleted_entries: info.rows[0]?.changes ?? 0 };
  }

  // Bulk delete for the Logs panel. Same filter shape as getAllHistory, minus
  // paging. Returns the number of individual change rows removed.
  purgeEntries(filters = {}) {
    const where = [];
    const params = [];

    if (filters.productId) {
      where.push('product_id = ?');
      params.push(filters.productId);
    }
    if (filters.platform === 'base') {
      where.push('platform IS NULL');
    } else if (filters.platform) {
      where.push('platform = ?');
      params.push(filters.platform);
    }
    if (filters.source) {
      where.push('source = ?');
      params.push(filters.source);
    }
    if (filters.runId) {
      where.push('run_id = ?');
      params.push(filters.runId);
    }

    if (where.length === 0) {
      throw new Error('Refusing to purge without at least one filter');
    }

    const info = query(`DELETE FROM product_changes WHERE ${where.join(' AND ')}`, params);
    return { deleted_rows: info.rows[0]?.changes ?? 0 };
  }
}

module.exports = new ChangeLogService();
module.exports.encodeValue = encodeValue;
module.exports.decodeValue = decodeValue;
