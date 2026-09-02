const express = require('express');
const router = express.Router();
const shopifyController = require('../controllers/shopifyController');

// Test connection route
router.get('/test', shopifyController.testConnection);

// Get all products
router.get('/products', shopifyController.getProducts);

// Get product by ID
router.get('/products/:id', shopifyController.getProductById);

// Get inventory levels
router.get('/inventory', shopifyController.getInventoryLevels);

module.exports = router;
