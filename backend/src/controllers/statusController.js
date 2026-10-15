const scheduler = require('../jobs/scheduler');
const attentionService = require('../services/attentionService');
const { query } = require('../config/database');

// Sync transparency (C-9): cadence, next run, last run stats, queue health —
// "we put a number on it" (LitCommerce). Attention (C-10): the aggregated
// needs-attention view.

const getSyncStatus = (req, res) => {
  try {
    const schedulerState = scheduler.getState();

    // Latest completed Shopify sync run (the sync_logs row doubles as the run)
    const lastRun = query(
      `SELECT id, status, details, error_message, timestamp
       FROM sync_logs
       WHERE platform = 'shopify' AND action = 'sync'
       ORDER BY timestamp DESC LIMIT 1`
    ).rows[0] || null;

    const jobStats = query('SELECT status, COUNT(*) AS n FROM jobs GROUP BY status').rows.reduce(
      (acc, r) => ({ ...acc, [r.status]: r.n }),
      {}
    );

    res.json({
      scheduler: schedulerState,
      last_run: lastRun
        ? {
            id: lastRun.id,
            status: lastRun.status,
            details: lastRun.details ? JSON.parse(lastRun.details) : null,
            error: lastRun.error_message,
            finished_at: lastRun.timestamp,
          }
        : null,
      queue: {
        pending: jobStats.pending || 0,
        running: jobStats.running || 0,
        failed: jobStats.failed || 0,
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getAttention = (req, res) => {
  try {
    res.json(attentionService.build());
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = { getSyncStatus, getAttention };
