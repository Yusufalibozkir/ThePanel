const productService = require('../services/productService');
const platformListingService = require('../services/platformListingService');

// Get all products
const getAllProducts = async (req, res) => {
  try {
    const filters = {
      isbn: req.query.isbn,
      condition: req.query.condition,
      minPrice: req.query.minPrice,
      maxPrice: req.query.maxPrice,
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

// Update product
const updateProduct = async (req, res) => {
  try {
    const product = await productService.update(req.params.id, req.body);

    if (!product) {
      return res.status(404).json({
        success: false,
        message: 'Product not found',
      });
    }

    res.json({
      success: true,
      message: 'Product updated',
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

module.exports = {
  getAllProducts,
  getProductById,
  createProduct,
  updateProduct,
  deleteProduct,
};
