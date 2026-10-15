const { query } = require('../config/database');

// Random hex + timestamp; used for log row ids that double as sync run ids.
const newRunId = () =>
  Array.from({ length: 16 }, () => '0123456789abcdef'[Math.floor(Math.random() * 16)]).join('') +
  Date.now().toString(16);

class SyncLogService {
  // Create a sync log entry. An explicit id may be passed (used as the run id
  // that sync-source change entries are stamped with, linking a run to the
  // field changes it produced).
  async createLog(logData) {
    const sql = `
      INSERT INTO sync_logs (
        id, product_id, platform, action, status, details, error_message
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `;

    const params = [
      logData.id || null,
      logData.product_id || null,
      logData.platform,
      logData.action,
      logData.status,
      JSON.stringify(logData.details || {}),
      logData.error_message || null,
    ];

    query(sql, params);
    return { success: true, id: logData.id || null };
  }

  // Get logs for a product
  async getLogsByProductId(productId, limit = 50) {
    const result = query(
      'SELECT * FROM sync_logs WHERE product_id = ? ORDER BY timestamp DESC LIMIT ?',
      [productId, limit]
    );
    return result.rows.map(this.parseLog);
  }

  // Get logs by platform
  async getLogsByPlatform(platform, limit = 100) {
    const result = query(
      'SELECT * FROM sync_logs WHERE platform = ? ORDER BY timestamp DESC LIMIT ?',
      [platform, limit]
    );
    return result.rows.map(this.parseLog);
  }

  // Get recent logs
  async getRecentLogs(limit = 100) {
    const result = query(
      `SELECT sl.*, p.title as product_title
       FROM sync_logs sl
       LEFT JOIN products p ON sl.product_id = p.id
       ORDER BY sl.timestamp DESC 
       LIMIT ?`,
      [limit]
    );
    return result.rows.map(this.parseLog);
  }

  // Filtered logs for the Logs panel: platform, status, paging + total count.
  // Each returned log carries the number of field-change entries its run
  // produced (shopify sync runs only; older runs have no linkage).
  async getLogs(filters = {}) {
    const where = [];
    const params = [];
    if (filters.platform) {
      where.push('sl.platform = ?');
      params.push(filters.platform);
    }
    if (filters.status) {
      where.push('sl.status = ?');
      params.push(filters.status);
    }
    if (filters.search) {
      where.push('(p.title LIKE ? OR sl.error_message LIKE ?)');
      params.push(`%${filters.search}%`, `%${filters.search}%`);
    }
    const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';

    const total = query(`SELECT COUNT(*) AS n FROM sync_logs sl LEFT JOIN products p ON sl.product_id = p.id ${whereSql}`, params).rows[0].n;

    const offset = Math.max(parseInt(filters.offset, 10) || 0, 0);
    const limit = Math.max(parseInt(filters.limit, 10) || 50, 1);
    const rows = query(
      `SELECT sl.*, p.title as product_title
       FROM sync_logs sl
       LEFT JOIN products p ON sl.product_id = p.id
       ${whereSql}
       ORDER BY sl.timestamp DESC
       LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    ).rows;

    const logs = rows.map(this.parseLog);

    // Attach per-run change-entry counts for the runs on this page
    const runIds = logs.map((l) => l.id).filter(Boolean);
    if (runIds.length > 0) {
      const placeholders = runIds.map(() => '?').join(', ');
      const counts = query(
        `SELECT run_id, COUNT(DISTINCT change_id) AS n FROM product_changes WHERE run_id IN (${placeholders}) GROUP BY run_id`,
        runIds
      ).rows;
      const countByRun = new Map(counts.map((c) => [c.run_id, c.n]));
      for (const log of logs) {
        log.change_count = countByRun.get(log.id) || 0;
      }
    }

    return { logs, total, offset, limit };
  }

  // Delete a single log row (sync logs are informational only)
  async deleteLog(id) {
    const info = query('DELETE FROM sync_logs WHERE id = ?', [id]);
    return { deleted: (info.rows[0]?.changes ?? 0) > 0 };
  }

  // Bulk delete for the Logs panel. Requires at least one filter as a guard.
  async purgeLogs(filters = {}) {
    const where = [];
    const params = [];
    if (filters.platform) {
      where.push('platform = ?');
      params.push(filters.platform);
    }
    if (filters.status) {
      where.push('status = ?');
      params.push(filters.status);
    }
    if (where.length === 0) {
      throw new Error('Refusing to purge without at least one filter');
    }
    const info = query(`DELETE FROM sync_logs WHERE ${where.join(' AND ')}`, params);
    return { deleted: info.rows[0]?.changes ?? 0 };
  }

  // Get error logs
  async getErrorLogs(limit = 50) {
    const result = query(
      `SELECT sl.*, p.title as product_title
       FROM sync_logs sl
       LEFT JOIN products p ON sl.product_id = p.id
       WHERE sl.status = 'failed'
       ORDER BY sl.timestamp DESC 
       LIMIT ?`,
      [limit]
    );
    return result.rows.map(this.parseLog);
  }

  // Parse log row (convert JSON strings back to objects)
  parseLog(row) {
    return {
      ...row,
      details: JSON.parse(row.details || '{}'),
    };
  }
}

module.exports = new SyncLogService();
module.exports.newRunId = newRunId;
