const productService = require('../services/productService');
const platformListingService = require('../services/platformListingService');
const changeLogService = require('../services/changeLogService');

// Distinct filterable values (tags, categories, vendor, ...) with counts
const getFacets = async (req, res) => {
  try {
    const facets = await productService.getFacets();
    res.json({ success: true, facets });
  } catch (error) {
    console.error('Error fetching facets:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch facets', error: error.message });
  }
};

// Get all products
const getAllProducts = async (req, res) => {
  try {
    const filters = {
      isbn: req.query.isbn,
      condition: req.query.condition,
      metadataStatus: req.query.metadataStatus,
      minPrice: req.query.minPrice,
      maxPrice: req.query.maxPrice,
      sold: req.query.sold,
      tags: req.query.tags,
      category: req.query.category,
      vendor: req.query.vendor,
    };

    const products = await productService.getAll(filters);
    const listings = await platformListingService.getAll();
    const listingsByProduct = {};
    for (const listing of listings) {
      if (!listingsByProduct[listing.product_id]) {
        listingsByProduct[listing.product_id] = [];
      }
      listingsByProduct[listing.product_id].push(listing);
    }

    const productsWithListings = products.map((product) => ({
      ...product,
      platform_listings: listingsByProduct[product.id] || [],
    }));

    res.json({
      success: true,
      count: productsWithListings.length,
      products: productsWithListings,
    });
  } catch (error) {
    console.error('Error fetching products:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch products',
      error: error.message,
    });
  }
};

// Get single product by ID
const getProductById = async (req, res) => {
  try {
    const product = await productService.getById(req.params.id);

    if (!product) {
      return res.status(404).json({
        success: false,
        message: 'Product not found',
      });
    }

    // Get platform listings for this product
    const listings = await platformListingService.getListingsByProductId(product.id);

    res.json({
      success: true,
      product: {
        ...product,
        listings,
      },
    });
  } catch (error) {
    console.error('Error fetching product:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch product',
      error: error.message,
    });
  }
};

// Create new product
const createProduct = async (req, res) => {
  try {
    const product = await productService.create(req.body);

    res.status(201).json({
      success: true,
      message: 'Product created',
      product,
    });
  } catch (error) {
    console.error('Error creating product:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create product',
      error: error.message,
    });
  }
};

// Manual edit: records an overlay entry, never touches the Shopify truth row
const updateProduct = async (req, res) => {
  try {
    const product = await productService.applyEdit(req.params.id, req.body);

    if (!product) {
      return res.status(404).json({
        success: false,
        message: 'Product not found',
      });
    }

    res.json({
      success: true,
      message: 'Local edit saved (Shopify truth untouched)',
      product,
    });
  } catch (error) {
    console.error('Error updating product:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update product',
      error: error.message,
    });
  }
};

// Change history for one product (manual overlays + sync truth updates)
const getChanges = async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 100, 500);
    const entries = changeLogService.getHistory(req.params.id, limit);
    res.json({ success: true, count: entries.length, entries });
  } catch (error) {
    console.error('Error fetching change history:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch changes', error: error.message });
  }
};

// Delete one history entry. For manual entries the edit is peeled back: the
// affected fields fall to the previous manual value or the Shopify truth value.
const deleteChange = async (req, res) => {
  try {
    const deleted = changeLogService.deleteEntry(req.params.id, req.params.changeId);
    if (!deleted) {
      return res.status(404).json({ success: false, message: 'Change entry not found' });
    }
    const product = await productService.getById(req.params.id);
    res.json({
      success: true,
      message:
        deleted.source === 'manual'
          ? 'Entry deleted — affected fields fell back to their previous value (or the Shopify truth)'
          : 'Sync record deleted (truth data unaffected)',
      deleted,
      product,
    });
  } catch (error) {
    console.error('Error deleting change entry:', error);
    res.status(500).json({ success: false, message: 'Failed to delete change entry', error: error.message });
  }
};

// Reset ALL local edits for a product back to the Shopify truth
const resetLocalEdits = async (req, res) => {
  try {
    const product = await productService.getById(req.params.id);
    if (!product) {
      return res.status(404).json({ success: false, message: 'Product not found' });
    }
    changeLogService.deleteAllManual(req.params.id);
    const reset = await productService.getById(req.params.id);
    res.json({ success: true, message: 'All local edits removed — back to Shopify truth', product: reset });
  } catch (error) {
    console.error('Error resetting local edits:', error);
    res.status(500).json({ success: false, message: 'Failed to reset local edits', error: error.message });
  }
};

// Delete product
const deleteProduct = async (req, res) => {
  try {
    await productService.delete(req.params.id);

    res.json({
      success: true,
      message: 'Product deleted',
    });
  } catch (error) {
    console.error('Error deleting product:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete product',
      error: error.message,
    });
  }
};

// Mark product sold via a platform (or shopify). Single-copy model.
const markSold = async (req, res) => {
  try {
    const soldVia = req.body?.sold_via || 'manual';
    const product = await productService.markSold(req.params.id, soldVia);
    if (!product) {
      return res.status(404).json({ success: false, message: 'Product not found' });
    }
    // Phase 3: queue end_listing jobs for other active listings here (W3)
    res.json({ success: true, message: 'Product marked sold', product });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = {
  getFacets,
  getAllProducts,
  getProductById,
  createProduct,
  updateProduct,
  deleteProduct,
  markSold,
  getChanges,
  deleteChange,
  resetLocalEdits,
};
