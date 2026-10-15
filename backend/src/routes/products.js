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

// Local change history (overlay edits + sync truth updates)
router.get('/:id/changes', productController.getChanges);
router.delete('/:id/changes/:changeId', productController.deleteChange);
router.delete('/:id/local-edits', productController.resetLocalEdits);

// Per-platform listing fields (notes, title_override) — versioned per platform
router.put('/:id/listings/:platform/fields', productController.updateListingFields);

// Bulk-apply a notes template to a selection ({ product_ids, platform, template })
router.post('/notes-template', productController.applyNotesTemplate);

module.exports = router;
