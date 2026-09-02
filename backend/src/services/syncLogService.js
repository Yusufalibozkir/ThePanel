const { query } = require('../config/database');

class SyncLogService {
  // Create a sync log entry
  async createLog(logData) {
    const sql = `
      INSERT INTO sync_logs (
        product_id, platform, action, status, details, error_message
      ) VALUES (?, ?, ?, ?, ?, ?)
    `;

    const params = [
      logData.product_id || null,
      logData.platform,
      logData.action,
      logData.status,
      JSON.stringify(logData.details || {}),
      logData.error_message || null,
    ];

    query(sql, params);
    return { success: true };
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
