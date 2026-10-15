const { db, query } = require('../config/database');
const jobService = require('../services/jobService');

// Scheduled Shopify polling (W2): enqueues a sync_shopify job every
// SYNC_POLL_MINUTES (default 30; 0 disables). Polling is the industry-standard
// cadence for master-catalog sync — the schedule state survives restarts via
// panel_state, and a run is only enqueued when no sync job is already queued
// (the durable queue dedupes bursts).

const STATE_KEY = 'sync_scheduler';
const CHECK_INTERVAL_MS = 30 * 1000;

const readState = () => {
  const row = db.prepare('SELECT value FROM panel_state WHERE key = ?').get(STATE_KEY);
  if (!row) return null;
  try {
    return JSON.parse(row.value);
  } catch {
    return null;
  }
};

const writeState = (state) => {
  db.prepare(
    `INSERT INTO panel_state (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`
  ).run(STATE_KEY, JSON.stringify(state));
};

const shopifyConfigured = () => {
  if (process.env.SHOPIFY_CLIENT_ID && process.env.SHOPIFY_CLIENT_SECRET) return true;
  return Boolean(process.env.SHOPIFY_ACCESS_TOKEN);
};

const pollMinutes = () => {
  const raw = Number(process.env.SYNC_POLL_MINUTES ?? 30);
  return Number.isFinite(raw) && raw >= 0 ? raw : 30;
};

const ensureState = () => {
  const minutes = pollMinutes();
  let state = readState();
  if (!state || state.poll_minutes !== minutes) {
    state = {
      poll_minutes: minutes,
      next_run_at: minutes > 0 ? new Date(Date.now() + minutes * 60 * 1000).toISOString() : null,
      last_enqueued_at: state?.last_enqueued_at || null,
    };
    writeState(state);
  }
  return state;
};

// Public snapshot for GET /api/status/sync
const getState = () => {
  const state = ensureState();
  return {
    enabled: state.poll_minutes > 0,
    poll_minutes: state.poll_minutes,
    next_run_at: state.next_run_at,
    last_enqueued_at: state.last_enqueued_at,
    shopify_configured: shopifyConfigured(),
  };
};

const syncJobInFlight = () =>
  db
    .prepare("SELECT COUNT(*) AS n FROM jobs WHERE type = 'sync_shopify' AND status IN ('pending', 'running')")
    .get().n > 0;

const tick = () => {
  const state = ensureState();
  if (!state.enabled || !state.next_run_at || !shopifyConfigured()) return;

  const due = new Date(state.next_run_at).getTime() <= Date.now();
  if (!due) return;

  const next = {
    ...state,
    next_run_at: new Date(Date.now() + state.poll_minutes * 60 * 1000).toISOString(),
    last_enqueued_at: new Date().toISOString(),
  };
  writeState(next);

  if (!syncJobInFlight()) {
    jobService.enqueue('sync_shopify', {});
  }
};

const start = () => {
  if (pollMinutes() === 0) {
    console.log('[scheduler] Shopify polling disabled (SYNC_POLL_MINUTES=0)');
    return null;
  }
  const timer = setInterval(tick, CHECK_INTERVAL_MS);
  timer.unref();
  console.log(`[scheduler] Shopify poll scheduled every ${pollMinutes()} min`);
  return timer;
};

module.exports = { start, getState, tick, _resetForTests: () => query('DELETE FROM panel_state WHERE key = ?', [STATE_KEY]) };
