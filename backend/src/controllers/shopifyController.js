const shopifyService = require('../services/shopifyService');

// Test Shopify connection
const testConnection = async (req, res) => {
  try {
    const result = await shopifyService.testConnection();
    
    if (result.success) {
      res.json({
        success: true,
        message: result.message,
        shop: {
          name: result.shop.name,
          email: result.shop.email,
          domain: result.shop.domain,
          currency: result.shop.currency,
        },
      });
    } else {
      res.status(500).json({
        success: false,
        message: result.message,
      });
    }
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to connect to Shopify',
      error: error.message,
    });
  }
};

// Get all products
const getProducts = async (req, res) => {
  try {
    const limit = req.query.limit || 50;
    const result = await shopifyService.getProducts(limit);
    
    if (result.success) {
      res.json({
        success: true,
        count: result.count,
        products: result.products,
      });
    } else {
      res.status(500).json({
        success: false,
        message: result.message,
      });
    }
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to fetch products',
      error: error.message,
    });
  }
};

// Get product by ID
const getProductById = async (req, res) => {
  try {
    const { id } = req.params;
    const result = await shopifyService.getProductById(id);
    
    if (result.success) {
      res.json({
        success: true,
        product: result.product,
      });
    } else {
      res.status(404).json({
        success: false,
        message: result.message,
      });
    }
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to fetch product',
      error: error.message,
    });
  }
};

// Get inventory levels
const getInventoryLevels = async (req, res) => {
  try {
    const result = await shopifyService.getInventoryLevels();
    
    if (result.success) {
      res.json({
        success: true,
        inventoryLevels: result.inventoryLevels,
      });
    } else {
      res.status(500).json({
        success: false,
        message: result.message,
      });
    }
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to fetch inventory levels',
      error: error.message,
    });
  }
};

module.exports = {
  testConnection,
  getProducts,
  getProductById,
  getInventoryLevels,
};
