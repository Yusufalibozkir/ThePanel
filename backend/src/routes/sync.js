const express = require('express');
const router = express.Router();
const syncController = require('../controllers/syncController');

// Sync products from Shopify to database
router.post('/shopify', syncController.syncFromShopify);

// Get sync logs
router.get('/logs', syncController.getSyncLogs);

module.exports = router;
