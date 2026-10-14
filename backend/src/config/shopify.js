const axios = require('axios');

const SHOPIFY_API_VERSION = process.env.SHOPIFY_API_VERSION || '2026-07';

const storeHost = () => {
  const shop = process.env.SHOPIFY_STORE_URL;
  if (!shop) throw new Error('SHOPIFY_STORE_URL is not configured');
  return shop.replace(/^https?:\/\//, '').replace(/\/$/, '');
};

const graphqlUrl = () => `https://${storeHost()}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`;

// Client credentials grant (Shopify Dev Dashboard apps): exchange the app's
// client ID/secret for a 24h access token, cached and refreshed 60s early.
// Falls back to a static SHOPIFY_ACCESS_TOKEN when client credentials are absent.
let cachedToken = null;
let tokenExpiresAt = 0;

const fetchAccessToken = async () => {
  const clientId = process.env.SHOPIFY_CLIENT_ID;
  const clientSecret = process.env.SHOPIFY_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    const staticToken = process.env.SHOPIFY_ACCESS_TOKEN;
    if (!staticToken) {
      throw new Error(
        'Shopify auth not configured (set SHOPIFY_CLIENT_ID + SHOPIFY_CLIENT_SECRET for the client credentials grant, or a static SHOPIFY_ACCESS_TOKEN)'
      );
    }
    return staticToken;
  }

  if (cachedToken && Date.now() < tokenExpiresAt - 60_000) return cachedToken;

  let response;
  try {
    response = await axios.post(
      `https://${storeHost()}/admin/oauth/access_token`,
      new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: clientId,
        client_secret: clientSecret,
      }).toString(),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 30000 }
    );
  } catch (error) {
    const body = error.response?.data;
    const reason = typeof body === 'object' ? body?.error || JSON.stringify(body) : String(body || '');
    throw new Error(
      `Shopify token request failed ${error.response?.status ? `(HTTP ${error.response.status})` : ''}${reason ? `: ${reason}` : `: ${error.message}`}`
    );
  }

  cachedToken = response.data.access_token;
  tokenExpiresAt = Date.now() + (response.data.expires_in || 86399) * 1000;
  return cachedToken;
};

// Execute a GraphQL Admin API query. Throws a single Error whose message aggregates
// the first GraphQL error, so callers get actionable text.
const shopifyGraphQL = async (query, variables = {}) => {
  const accessToken = await fetchAccessToken();

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
  fetchAccessToken,
  SHOPIFY_API_VERSION,
};
