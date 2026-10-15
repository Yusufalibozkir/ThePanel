const productService = require('../services/productService');
const platformListingService = require('../services/platformListingService');
const changeLogService = require('../services/changeLogService');
const { applyTemplate } = require('../services/listingComposer');
const repriceService = require('../services/repriceService');

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

// Delete one history entry. For manual entries the edit is peeled back: base
// fields fall to the previous manual value or the Shopify truth value, platform
// fields fall to the previous platform version (or are cleared).
const deleteChange = async (req, res) => {
  try {
    const existing = changeLogService.getEntry(req.params.id, req.params.changeId);
    const deleted = existing?.platform
      ? platformListingService.deletePlatformChangeEntry(req.params.id, req.params.changeId)
      : changeLogService.deleteEntry(req.params.id, req.params.changeId);
    if (!deleted) {
      return res.status(404).json({ success: false, message: 'Change entry not found' });
    }
    const product = await productService.getById(req.params.id);
    const scope = deleted.platform ? ` on ${deleted.platform}` : '';
    res.json({
      success: true,
      message:
        deleted.source === 'manual'
          ? `Entry deleted${scope} — affected fields fell back to their previous value`
          : `Sync record deleted${scope} (truth data unaffected)`,
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

// Save per-platform content fields (notes, title_override). Written directly
// to platform_listings and journaled into product_changes scoped to the platform.
const updateListingFields = async (req, res) => {
  try {
    const product = await productService.getById(req.params.id);
    if (!product) {
      return res.status(404).json({ success: false, message: 'Product not found' });
    }

    const listing = platformListingService.savePlatformFields(req.params.id, req.params.platform, {
      notes: req.body?.notes,
      title_override: req.body?.title_override,
    });

    res.json({
      success: true,
      message: `${req.params.platform} listing fields saved (versioned in history)`,
      listing,
    });
  } catch (error) {
    console.error('Error saving listing fields:', error);
    res.status(500).json({ success: false, message: 'Failed to save listing fields', error: error.message });
  }
};

// Bulk-apply a notes template to a selection of books for one platform.
// The template renders per book ({title}, {author}, {year}, …) and each
// result is saved through the normal per-platform versioning path.
// Body: { product_ids: [], platform, template }
const applyNotesTemplate = async (req, res) => {
  try {
    const { product_ids: productIds, platform, template } = req.body || {};
    if (!Array.isArray(productIds) || productIds.length === 0) {
      return res.status(400).json({ success: false, message: 'product_ids must be a non-empty array' });
    }
    if (!['ebay', 'abebooks', 'etsy'].includes(platform)) {
      return res.status(400).json({ success: false, message: `Invalid platform: ${platform}` });
    }
    if (!template || !String(template).trim()) {
      return res.status(400).json({ success: false, message: 'template must not be empty' });
    }

    let applied = 0;
    const failures = [];
    for (const productId of productIds) {
      const product = await productService.getById(productId);
      if (!product) {
        failures.push({ product_id: productId, error: 'not found' });
        continue;
      }
      try {
        platformListingService.savePlatformFields(productId, platform, {
          notes: applyTemplate(String(template), product),
        });
        applied++;
      } catch (error) {
        failures.push({ product_id: productId, error: error.message });
      }
    }

    res.json({
      success: true,
      message: `Notes template applied to ${applied} of ${productIds.length} books (${platform})`,
      applied,
      failures,
    });
  } catch (error) {
    console.error('Error applying notes template:', error);
    res.status(500).json({ success: false, message: 'Failed to apply notes template', error: error.message });
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

// Mark product sold via a platform (or shopify). Single-copy model — closes
// the book everywhere (W3). Idempotent when a channel order id is supplied.
const markSold = async (req, res) => {
  try {
    const platform = req.body?.platform || null;
    const soldVia = req.body?.sold_via || platform || 'manual';
    const externalOrderId = req.body?.external_order_id || null;

    if (platform && !['ebay', 'etsy', 'abebooks', 'shopify'].includes(platform)) {
      return res.status(400).json({ success: false, message: 'Invalid platform' });
    }

    const product = await productService.markSold(req.params.id, soldVia, {
      platform,
      externalOrderId,
    });
    if (!product) {
      return res.status(404).json({ success: false, message: 'Product not found' });
    }
    res.json({
      success: true,
      message: product.already_closed ? 'Sale already recorded' : 'Product marked sold',
      product,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Bulk reprice (PricePartner): { product_ids, mode: percent|amount|set,
// value, dry_run }. Applies local price overrides — Shopify truth untouched,
// every change journaled and peelable per book.
const reprice = async (req, res) => {
  try {
    const { product_ids, mode, value, dry_run } = req.body || {};
    const result = await repriceService.reprice(product_ids, mode, value, { dryRun: Boolean(dry_run) });
    res.json({
      success: true,
      dry_run: result.dry_run,
      applied: result.applied,
      skipped: result.skipped,
      rows: result.rows,
    });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
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
  updateListingFields,
  applyNotesTemplate,
  reprice,
};
