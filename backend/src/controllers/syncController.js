const shopifyService = require('../services/shopifyService');
const productService = require('../services/productService');
const syncLogService = require('../services/syncLogService');

// Sync products from Shopify to database
const syncFromShopify = async (req, res) => {
  try {
    const limit = req.query.limit || 250;
    
    // Fetch products from Shopify
    const shopifyResult = await shopifyService.getProducts(limit);
    
    if (!shopifyResult.success) {
      return res.status(500).json({
        success: false,
        message: 'Failed to fetch products from Shopify',
        error: shopifyResult.message,
      });
    }

    // Sync products to database
    const syncResults = await productService.syncProductsFromShopify(shopifyResult.products);

    // Log the sync operation
    for (let i = 0; i < syncResults.created; i++) {
      await syncLogService.createLog({
        platform: 'ebay',
        action: 'create',
        status: 'success',
        details: { source: 'shopify_sync' },
      });
    }

    for (let i = 0; i < syncResults.updated; i++) {
      await syncLogService.createLog({
        platform: 'ebay',
        action: 'update',
        status: 'success',
        details: { source: 'shopify_sync' },
      });
    }

    // Log errors
    for (const error of syncResults.errors) {
      await syncLogService.createLog({
        platform: 'ebay',
        action: 'create',
        status: 'failed',
        error_message: error.error,
        details: { shopify_product_id: error.shopifyId },
      });
    }

    res.json({
      success: true,
      message: 'Sync completed',
      results: {
        created: syncResults.created,
        updated: syncResults.updated,
        errors: syncResults.errors.length,
        products: [],
      },
    });

  } catch (error) {
    console.error('Sync error:', error);
    res.status(500).json({
      success: false,
      message: 'Sync failed',
      error: error.message,
    });
  }
};

// Get sync logs
const getSyncLogs = async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 100;
    const errorsOnly = req.query.errors === 'true';
    
    const logs = errorsOnly 
      ? await syncLogService.getErrorLogs(limit)
      : await syncLogService.getRecentLogs(limit);

    res.json({
      success: true,
      count: logs.length,
      logs,
    });
  } catch (error) {
    console.error('Error fetching logs:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch sync logs',
      error: error.message,
    });
  }
};

module.exports = {
  syncFromShopify,
  getSyncLogs,
};
