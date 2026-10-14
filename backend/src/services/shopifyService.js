const { shopifyGraphQL } = require('../config/shopify');

// GraphQL Admin API sync client (replaces the legacy REST /products.json client).
// Returns products in a normalized shape consumed by productService.

const numericIdFromGid = (gid) => {
  const match = String(gid || '').match(/(\d+)\/?$/);
  return match ? match[1] : String(gid);
};

const PRODUCTS_QUERY = `
  query ProductsPage($first: Int!, $after: String) {
    products(first: $first, after: $after) {
      pageInfo {
        hasNextPage
        endCursor
      }
      edges {
        cursor
        node {
          id
          title
          descriptionHtml
          vendor
          productType
          tags
          images(first: 50) {
            edges {
              node {
                url
                altText
              }
            }
          }
          variants(first: 20) {
            edges {
              node {
                id
                sku
                barcode
                price
                inventoryQuantity
              }
            }
          }
        }
      }
    }
  }
`;

const SHOP_QUERY = `
  query ShopInfo {
    shop {
      name
      email
      domain
      myshopifyDomain
      currencyCode
    }
  }
`;

const normalizeProduct = (node) => ({
  id: numericIdFromGid(node.id),
  title: node.title,
  body_html: node.descriptionHtml || '',
  vendor: node.vendor,
  product_type: node.productType,
  tags: Array.isArray(node.tags) ? node.tags : [],
  images: (node.images?.edges || []).map((edge) => ({ src: edge.node.url })),
  variants: (node.variants?.edges || []).map((edge) => ({
    id: numericIdFromGid(edge.node.id),
    sku: edge.node.sku,
    barcode: edge.node.barcode,
    price: edge.node.price,
    inventory_quantity: edge.node.inventoryQuantity,
  })),
});

class ShopifyService {
  async testConnection() {
    try {
      const data = await shopifyGraphQL(SHOP_QUERY);
      return {
        success: true,
        shop: {
          name: data.shop.name,
          email: data.shop.email,
          domain: data.shop.domain || data.shop.myshopifyDomain,
          currency: data.shop.currencyCode,
        },
        message: 'Successfully connected to Shopify',
      };
    } catch (error) {
      console.error('Shopify connection error:', error.message);
      return { success: false, message: error.message };
    }
  }

  // Fetch up to `limit` products, paginating with cursors (100 per page).
  async getProducts(limit = 250) {
    try {
      const products = [];
      let after = null;
      let remaining = Math.min(limit, 250);

      while (remaining > 0) {
        const first = Math.min(remaining, 100);
        const data = await shopifyGraphQL(PRODUCTS_QUERY, { first, after });
        const connection = data.products;

        for (const edge of connection.edges) {
          products.push(normalizeProduct(edge.node));
        }

        remaining -= connection.edges.length;
        if (!connection.pageInfo.hasNextPage) break;
        after = connection.pageInfo.endCursor;
      }

      return { success: true, products, count: products.length };
    } catch (error) {
      console.error('Error fetching products:', error.message);
      return { success: false, message: error.message };
    }
  }

  async getProductById(productId) {
    try {
      const data = await shopifyGraphQL(
        `query SingleProduct($id: ID!) {
          product(id: $id) {
            id
            title
            descriptionHtml
            vendor
            productType
            tags
            images(first: 50) { edges { node { url altText } } }
            variants(first: 20) { edges { node { id sku barcode price inventoryQuantity } } }
          }
        }`,
        { id: `gid://shopify/Product/${productId}` }
      );

      if (!data.product) {
        return { success: false, message: `Product ${productId} not found` };
      }
      return { success: true, product: normalizeProduct(data.product) };
    } catch (error) {
      console.error('Error fetching product:', error.message);
      return { success: false, message: error.message };
    }
  }

  async getInventoryLevels() {
    return {
      success: false,
      message: 'Inventory levels moved into the products query (variants.inventoryQuantity)',
    };
  }
}

module.exports = new ShopifyService();
