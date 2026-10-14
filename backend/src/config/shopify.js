const axios = require('axios');

const SHOPIFY_API_VERSION = process.env.SHOPIFY_API_VERSION || '2025-10';

const graphqlUrl = () => {
  const shop = process.env.SHOPIFY_STORE_URL;
  if (!shop) throw new Error('SHOPIFY_STORE_URL is not configured');
  return `https://${shop}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`;
};

// Execute a GraphQL Admin API query. Throws a single Error whose message aggregates
// the first GraphQL error, so callers get actionable text.
const shopifyGraphQL = async (query, variables = {}) => {
  const accessToken = process.env.SHOPIFY_ACCESS_TOKEN;
  if (!accessToken) {
    throw new Error('SHOPIFY_ACCESS_TOKEN is not configured (set a custom-app token with read_products, read_inventory)');
  }

  let response;
  try {
    response = await axios.post(
      graphqlUrl(),
      { query, variables },
      {
        headers: {
          'X-Shopify-Access-Token': accessToken,
          'Content-Type': 'application/json',
        },
        timeout: 30000,
      }
    );
  } catch (error) {
    const body = error.response?.data;
    if (body?.errors !== undefined) {
      const text = Array.isArray(body.errors)
        ? body.errors.map((e) => e.message || JSON.stringify(e)).join('; ')
        : String(body.errors);
      throw new Error(text);
    }
    throw new Error(error.response?.status ? `Shopify HTTP ${error.response.status}` : error.message);
  }

  if (response.data.errors && response.data.errors.length) {
    const text = Array.isArray(response.data.errors)
      ? response.data.errors.map((e) => e.message || JSON.stringify(e)).join('; ')
      : String(response.data.errors);
    throw new Error(text);
  }

  return response.data.data;
};

module.exports = {
  shopifyGraphQL,
  SHOPIFY_API_VERSION,
};
