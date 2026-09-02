const { query } = require('../config/database');

class ProductService {
  // Sync all products from Shopify to local database
  async syncProductsFromShopify(shopifyProducts) {
    const results = {
      created: 0,
      updated: 0,
      errors: [],
    };

    for (const shopifyProduct of shopifyProducts) {
      try {
        // Check if product already exists
        const existing = await this.findByShopifyId(shopifyProduct.id);

        const productData = this.mapShopifyToProduct(shopifyProduct);

        if (existing) {
          await this.update(existing.id, productData);
          results.updated++;
        } else {
          await this.create(productData);
          results.created++;
        }
      } catch (error) {
        results.errors.push({
          shopifyId: shopifyProduct.id,
          error: error.message,
        });
      }
    }

    return results;
  }

  // Map Shopify product to our schema
  mapShopifyToProduct(shopifyProduct) {
    const variant = shopifyProduct.variants?.[0] || {};
    const images = shopifyProduct.images?.map(img => img.src) || [];

    return {
      shopify_product_id: String(shopifyProduct.id),
      title: shopifyProduct.title,
      description: shopifyProduct.body_html || '',
      price: parseFloat(variant.price || 0),
      cost: parseFloat(variant.cost || 0),
      quantity: parseInt(variant.inventory_quantity || 0),
      isbn: shopifyProduct.variants?.[0]?.barcode || null,
      images: JSON.stringify(images),
      metadata: JSON.stringify({
        vendor: shopifyProduct.vendor,
        product_type: shopifyProduct.product_type,
        tags: shopifyProduct.tags,
      }),
    };
  }

  // Find product by Shopify ID
  async findByShopifyId(shopifyId) {
    const result = query('SELECT * FROM products WHERE shopify_product_id = ?', [String(shopifyId)]);
    return result.rows[0] || null;
  }

  // Get all products
  async getAll(filters = {}) {
    let sql = 'SELECT * FROM products WHERE 1=1';
    const params = [];

    if (filters.isbn) {
      sql += ' AND isbn = ?';
      params.push(filters.isbn);
    }

    if (filters.condition) {
      sql += ' AND condition = ?';
      params.push(filters.condition);
    }

    if (filters.minPrice) {
      sql += ' AND price >= ?';
      params.push(parseFloat(filters.minPrice));
    }

    if (filters.maxPrice) {
      sql += ' AND price <= ?';
      params.push(parseFloat(filters.maxPrice));
    }

    sql += ' ORDER BY created_at DESC';

    const result = query(sql, params);
    return result.rows.map(this.parseProduct);
  }

  // Get single product by ID
  async getById(id) {
    const result = query('SELECT * FROM products WHERE id = ?', [id]);
    return result.rows[0] ? this.parseProduct(result.rows[0]) : null;
  }

  // Create new product
  async create(productData) {
    const sql = `
      INSERT INTO products (
        shopify_product_id, isbn, title, author, description,
        price, cost, condition, quantity, images, metadata
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    const params = [
      productData.shopify_product_id,
      productData.isbn || null,
      productData.title,
      productData.author || null,
      productData.description || null,
      productData.price,
      productData.cost || null,
      productData.condition || null,
      productData.quantity || 0,
      productData.images || '[]',
      productData.metadata || '{}',
    ];

    const result = query(sql, params);
    return this.getById(result.rows[0].id);
  }

  // Update existing product
  async update(id, productData) {
    const fields = [];
    const params = [];

    if (productData.title !== undefined) {
      fields.push('title = ?');
      params.push(productData.title);
    }

    if (productData.author !== undefined) {
      fields.push('author = ?');
      params.push(productData.author);
    }

    if (productData.description !== undefined) {
      fields.push('description = ?');
      params.push(productData.description);
    }

    if (productData.price !== undefined) {
      fields.push('price = ?');
      params.push(productData.price);
    }

    if (productData.cost !== undefined) {
      fields.push('cost = ?');
      params.push(productData.cost);
    }

    if (productData.condition !== undefined) {
      fields.push('condition = ?');
      params.push(productData.condition);
    }

    if (productData.quantity !== undefined) {
      fields.push('quantity = ?');
      params.push(productData.quantity);
    }

    if (productData.images !== undefined) {
      fields.push('images = ?');
      params.push(productData.images);
    }

    if (productData.metadata !== undefined) {
      fields.push('metadata = ?');
      params.push(productData.metadata);
    }

    if (fields.length === 0) {
      return this.getById(id);
    }

    params.push(id);
    const sql = `UPDATE products SET ${fields.join(', ')} WHERE id = ?`;

    query(sql, params);
    return this.getById(id);
  }

  // Delete product
  async delete(id) {
    query('DELETE FROM products WHERE id = ?', [id]);
    return { success: true };
  }

  // Parse product row (convert JSON strings back to objects)
  parseProduct(row) {
    return {
      ...row,
      images: JSON.parse(row.images || '[]'),
      metadata: JSON.parse(row.metadata || '{}'),
    };
  }
}

module.exports = new ProductService();
