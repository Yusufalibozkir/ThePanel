const express = require('express');
const router = express.Router();
const productController = require('../controllers/productController');

// Filterable values (tags, categories, ...) — must precede /:id
router.get('/facets', productController.getFacets);

// Get all products
router.get('/', productController.getAllProducts);

// Get single product
router.get('/:id', productController.getProductById);

// Create product
router.post('/', productController.createProduct);

// Update product
router.put('/:id', productController.updateProduct);

// Delete product
router.delete('/:id', productController.deleteProduct);

// Mark sold (single-copy model: closes the book everywhere)
router.post('/:id/sold', productController.markSold);

module.exports = router;
