const shopifyService = require('../services/shopifyService');
const productService = require('../services/productService');
const syncLogService = require('../services/syncLogService');
const jobService = require('../services/jobService');

// Sync products from Shopify (GraphQL) into the database.
// Response shape kept stable for the frontend:
//   { success, message, results: { created, updated, errors, enriched } }
const syncFromShopify = async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 250, 250);

    const shopifyResult = await shopifyService.getProducts(limit);
    if (!shopifyResult.success) {
      await syncLogService.createLog({
        platform: 'shopify',
        action: 'sync',
        status: 'failed',
        error_message: shopifyResult.message,
      });
      return res.status(502).json({
        success: false,
        message: 'Failed to fetch products from Shopify',
        error: shopifyResult.message,
      });
    }

    const syncResults = await productService.syncProductsFromShopify(shopifyResult.products);

    await syncLogService.createLog({
      platform: 'shopify',
      action: 'sync',
      status: syncResults.errors.length > 0 ? 'failed' : 'success',
      details: {
        created: syncResults.created,
        updated: syncResults.updated,
        enriched: syncResults.enriched,
        error_count: syncResults.errors.length,
        errors: syncResults.errors.slice(0, 20),
      },
      error_message: syncResults.errors[0]?.error || null,
    });

    res.json({
      success: true,
      message: 'Sync completed',
      results: {
        created: syncResults.created,
        updated: syncResults.updated,
        errors: syncResults.errors.length,
        enriched: syncResults.enriched,
        products: [],
      },
    });
  } catch (error) {
    console.error('Sync error:', error);
    res.status(500).json({ success: false, message: 'Sync failed', error: error.message });
  }
};

// Queue a sync job instead of running inline
const queueSync = async (req, res) => {
  try {
    const job = jobService.enqueue('sync_shopify', {});
    res.status(202).json({ success: true, message: 'Sync queued', jobId: job.id });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to queue sync', error: error.message });
  }
};

const getSyncLogs = async (req, res) => {
  try {
    const limit = parseInt(req.query.limit, 10) || 100;
    const errorsOnly = req.query.errors === 'true';
    const logs = errorsOnly ? syncLogService.getErrorLogs(limit) : syncLogService.getRecentLogs(limit);
    res.json({ success: true, count: logs.length, logs });
  } catch (error) {
    console.error('Error fetching logs:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch sync logs', error: error.message });
  }
};

module.exports = { syncFromShopify, queueSync, getSyncLogs };
