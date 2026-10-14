const { db, query } = require('../config/database');

// Durable in-process job queue backed by the jobs table. No Redis.

const JOB_TYPES = ['list', 'update', 'end_listing', 'sync_shopify', 'export_abebooks', 'backfill_metadata'];

const enqueue = (type, payload = {}, { maxAttempts = 3, delaySeconds = 0 } = {}) => {
  if (!JOB_TYPES.includes(type)) {
    throw new Error(`unknown job type: ${type}`);
  }
  const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
  const nextRun = delaySeconds > 0 ? new Date(Date.now() + delaySeconds * 1000).toISOString().replace('T', ' ').slice(0, 19) : now;
  const row = db
    .prepare(
      `INSERT INTO jobs (type, payload, status, max_attempts, next_run_at, created_at, updated_at)
       VALUES (?, ?, 'pending', ?, ?, ?, ?)
       RETURNING *`
    )
    .get(type, JSON.stringify(payload), maxAttempts, nextRun, now, now);
  return row;
};

const list = (filters = {}) => {
  let sql = 'SELECT * FROM jobs WHERE 1=1';
  const params = [];
  if (filters.status) {
    sql += ' AND status = ?';
    params.push(filters.status);
  }
  if (filters.type) {
    sql += ' AND type = ?';
    params.push(filters.type);
  }
  sql += ' ORDER BY created_at DESC LIMIT ?';
  params.push(filters.limit || 50);
  return query(sql, params).rows.map(parseJob);
};

const get = (id) => {
  const row = query('SELECT * FROM jobs WHERE id = ?', [id]).rows[0];
  return row ? parseJob(row) : null;
};

const parseJob = (row) => ({
  ...row,
  payload: JSON.parse(row.payload || '{}'),
});

// Atomically claim the next due pending job (better-sqlite3 is single-writer;
// the transaction keeps two runners from grabbing the same row if one is added).
const claimNext = () => {
  const claim = db.transaction(() => {
    const row = db
      .prepare(
        `SELECT * FROM jobs
         WHERE status = 'pending' AND next_run_at <= CURRENT_TIMESTAMP
         ORDER BY next_run_at ASC LIMIT 1`
      )
      .get();
    if (!row) return null;
    db.prepare(`UPDATE jobs SET status = 'running', attempts = attempts + 1 WHERE id = ?`).run(row.id);
    return row;
  });
  return claim();
};

// Exponential backoff on failure: 30s, 60s, 120s … then dead-letter as 'failed'.
const markFailed = (job, error) => {
  const message = String(error?.message || error).slice(0, 2000);
  if (job.attempts >= job.max_attempts) {
    db.prepare(`UPDATE jobs SET status = 'failed', last_error = ? WHERE id = ?`).run(message, job.id);
    return { dead: true };
  }
  const backoffSeconds = 30 * Math.pow(2, job.attempts - 1);
  const nextRun = new Date(Date.now() + backoffSeconds * 1000).toISOString().replace('T', ' ').slice(0, 19);
  db.prepare(
    `UPDATE jobs SET status = 'pending', last_error = ?, next_run_at = ? WHERE id = ?`
  ).run(message, nextRun, job.id);
  return { dead: false, retryIn: backoffSeconds };
};

const markDone = (jobId, result = null) => {
  db.prepare(`UPDATE jobs SET status = 'done', last_error = NULL WHERE id = ?`).run(jobId);
};

// Reset jobs stuck in 'running' after a crash/restart.
const recoverStale = () => {
  const info = db
    .prepare(
      `UPDATE jobs SET status = 'pending', next_run_at = CURRENT_TIMESTAMP
       WHERE status = 'running'`
    )
    .run();
  return info.changes;
};

const stats = () => {
  const rows = query('SELECT status, COUNT(*) AS n FROM jobs GROUP BY status').rows;
  return rows.reduce((acc, r) => ({ ...acc, [r.status]: r.n }), {});
};

module.exports = {
  JOB_TYPES,
  enqueue,
  list,
  get,
  claimNext,
  markFailed,
  markDone,
  recoverStale,
  stats,
};
