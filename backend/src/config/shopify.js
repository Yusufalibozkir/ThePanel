const axios = require('axios');

// Create axios instance for Shopify API calls
const createShopifyClient = () => {
  const shop = process.env.SHOPIFY_STORE_URL;
  const accessToken = process.env.SHOPIFY_ACCESS_TOKEN;
  
  return axios.create({
    baseURL: `https://${shop}/admin/api/2024-01`,
    headers: {
      'X-Shopify-Access-Token': accessToken,
      'Content-Type': 'application/json',
    },
  });
};

module.exports = {
  createShopifyClient,
};
