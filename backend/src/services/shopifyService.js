const { createShopifyClient } = require('../config/shopify');

class ShopifyService {
  constructor() {
    this.client = null;
  }

  // Initialize the client
  initClient() {
    if (!this.client) {
      this.client = createShopifyClient();
    }
    return this.client;
  }

  // Test connection to Shopify
  async testConnection() {
    try {
      const client = this.initClient();
      const response = await client.get('/shop.json');

      return {
        success: true,
        shop: response.data.shop,
        message: 'Successfully connected to Shopify',
      };
    } catch (error) {
      console.error('Shopify connection error:', error.response?.data || error.message);
      return {
        success: false,
        message: error.response?.data?.errors || error.message,
        error: error,
      };
    }
  }

  // Fetch all products
  async getProducts(limit = 50) {
    try {
      const client = this.initClient();
      const response = await client.get('/products.json', {
        params: { limit },
      });

      return {
        success: true,
        products: response.data.products,
        count: response.data.products.length,
      };
    } catch (error) {
      console.error('Error fetching products:', error.response?.data || error.message);
      return {
        success: false,
        message: error.response?.data?.errors || error.message,
        error: error,
      };
    }
  }

  // Fetch a single product by ID
  async getProductById(productId) {
    try {
      const client = this.initClient();
      const response = await client.get(`/products/${productId}.json`);

      return {
        success: true,
        product: response.data.product,
      };
    } catch (error) {
      console.error('Error fetching product:', error.response?.data || error.message);
      return {
        success: false,
        message: error.response?.data?.errors || error.message,
        error: error,
      };
    }
  }

  // Get inventory levels
  async getInventoryLevels() {
    try {
      const client = this.initClient();
      const response = await client.get('/inventory_levels.json');

      return {
        success: true,
        inventoryLevels: response.data.inventory_levels,
      };
    } catch (error) {
      console.error('Error fetching inventory:', error.response?.data || error.message);
      return {
        success: false,
        message: error.response?.data?.errors || error.message,
        error: error,
      };
    }
  }
}

module.exports = new ShopifyService();
