const express = require('express');
const router = express.Router();
const logsController = require('../controllers/logsController');

// Universal logs for the Logs panel: change history (field versions, per
// product and per platform) and operational sync run logs.

// Change history (field versions across all books; run_id links a sync run
// to the entries it produced)
router.get('/changes', logsController.getChangeHistory);
router.delete('/changes/:productId/:changeId', logsController.deleteChangeEntry);
router.post('/changes/purge', logsController.purgeChangeHistory);

// Sync run logs
router.get('/sync', logsController.getSyncLogs);
router.delete('/sync/:id', logsController.deleteSyncLog);
router.post('/sync/purge', logsController.purgeSyncLogs);

module.exports = router;
