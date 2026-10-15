const changeLogService = require('../services/changeLogService');
const platformListingService = require('../services/platformListingService');
const syncLogService = require('../services/syncLogService');

// Universal log surface for the Logs panel: field-change history across all
// books (with the platform dimension) plus operational sync run logs.

// GET /api/logs/changes — global change history
// filters: product_id, platform (base|ebay|abebooks|etsy), source (manual|sync),
// field, run_id, search (product title), limit, offset
const getChangeHistory = async (req, res) => {
  try {
    const result = changeLogService.getAllHistory({
      productId: req.query.product_id,
      platform: req.query.platform,
      source: req.query.source,
      field: req.query.field,
      runId: req.query.run_id,
      search: req.query.search,
      limit: req.query.limit,
      offset: req.query.offset,
    });
    res.json({ success: true, ...result });
  } catch (error) {
    console.error('Error fetching change history:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch change history', error: error.message });
  }
};

// DELETE /api/logs/changes/:productId/:changeId — delete one entry anywhere in
// the catalog; manual entries are peeled back (base -> truth, platform -> previous version)
const deleteChangeEntry = async (req, res) => {
  try {
    const existing = changeLogService.getEntry(req.params.productId, req.params.changeId);
    const deleted = existing?.platform
      ? platformListingService.deletePlatformChangeEntry(req.params.productId, req.params.changeId)
      : changeLogService.deleteEntry(req.params.productId, req.params.changeId);
    if (!deleted) {
      return res.status(404).json({ success: false, message: 'Change entry not found' });
    }
    res.json({
      success: true,
      message:
        deleted.source === 'manual'
          ? 'Entry deleted — affected fields fell back to their previous value'
          : 'Sync record deleted (truth data unaffected)',
      deleted,
    });
  } catch (error) {
    console.error('Error deleting change entry:', error);
    res.status(500).json({ success: false, message: 'Failed to delete change entry', error: error.message });
  }
};

// POST /api/logs/changes/purge — bulk delete of change rows (requires a filter)
const purgeChangeHistory = async (req, res) => {
  try {
    const result = changeLogService.purgeEntries({
      productId: req.body?.product_id,
      platform: req.body?.platform,
      source: req.body?.source,
      runId: req.body?.run_id,
    });
    res.json({ success: true, message: 'Change history purged', ...result });
  } catch (error) {
    console.error('Error purging change history:', error);
    res.status(400).json({ success: false, message: error.message });
  }
};

// GET /api/logs/sync — sync run logs
// filters: platform (shopify|ebay|abebooks|etsy), status (success|failed|skipped),
// search, limit, offset
const getSyncLogs = async (req, res) => {
  try {
    const result = await syncLogService.getLogs({
      platform: req.query.platform,
      status: req.query.status,
      search: req.query.search,
      limit: req.query.limit,
      offset: req.query.offset,
    });
    res.json({ success: true, ...result });
  } catch (error) {
    console.error('Error fetching sync logs:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch sync logs', error: error.message });
  }
};

// DELETE /api/logs/sync/:id — delete one sync log row
const deleteSyncLog = async (req, res) => {
  try {
    const result = await syncLogService.deleteLog(req.params.id);
    if (!result.deleted) {
      return res.status(404).json({ success: false, message: 'Log not found' });
    }
    res.json({ success: true, message: 'Log deleted', ...result });
  } catch (error) {
    console.error('Error deleting sync log:', error);
    res.status(500).json({ success: false, message: 'Failed to delete sync log', error: error.message });
  }
};

// POST /api/logs/sync/purge — bulk delete of sync logs (requires a filter)
const purgeSyncLogs = async (req, res) => {
  try {
    const result = await syncLogService.purgeLogs({
      platform: req.body?.platform,
      status: req.body?.status,
    });
    res.json({ success: true, message: 'Sync logs purged', ...result });
  } catch (error) {
    console.error('Error purging sync logs:', error);
    res.status(400).json({ success: false, message: error.message });
  }
};

module.exports = {
  getChangeHistory,
  deleteChangeEntry,
  purgeChangeHistory,
  getSyncLogs,
  deleteSyncLog,
  purgeSyncLogs,
};
