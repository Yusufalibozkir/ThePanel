const { db, query } = require('../config/database');
const { parseProductTags } = require('./metadata/tagParser');
const { computeMetadataStatus } = require('./metadata/status');
const { enrichByIsbn } = require('./metadata/openLibrary');

class ProductService {
  // Sync products (normalized shape from shopifyService) into the local DB,
  // running the metadata pipeline: tags -> optional ISBN enrichment -> status.
  async syncProductsFromShopify(shopifyProducts, { enrich = true } = {}) {
    const results = { created: 0, updated: 0, errors: [], enriched: 0 };

    for (const shopifyProduct of shopifyProducts) {
      try {
        const existing = this.findByShopifyId(shopifyProduct.id);
        const productData = await this.mapShopifyToProduct(shopifyProduct, {
          existing,
          enrich,
        });

        if (productData._enriched) {
          results.enriched++;
          delete productData._enriched;
        }

        if (existing) {
          this.update(existing.id, productData);
          results.updated++;
        } else {
          this.create(productData);
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

  // Map a normalized Shopify product onto our schema. Metadata resolution order:
  //   1. structured tags (author:, condition:, publisher:, year:, binding:)
  //   2. values already stored locally (keep confirmed/manual edits on update)
  //   3. OpenLibrary enrichment via ISBN (only when creating, flagged unverified)
  async mapShopifyToProduct(shopifyProduct, { existing = null, enrich = true } = {}) {
    const variant = shopifyProduct.variants?.[0] || {};
    const images = shopifyProduct.images?.map((img) => img.src) || [];
    const tags = parseProductTags(shopifyProduct.tags);

    const metadata = {
      vendor: shopifyProduct.vendor || null,
      product_type: shopifyProduct.product_type || null,
      tags: Array.isArray(shopifyProduct.tags) ? shopifyProduct.tags : [],
      publisher: tags.publisher,
      year: tags.year,
      binding: tags.binding,
    };

    let author = tags.author;
    let condition = tags.condition;
    let enriched = {};

    // Never clobber manual/confirmed local values with empties
    if (existing) {
      author = author || existing.author || null;
      condition = condition || existing.condition || null;
      metadata.publisher = metadata.publisher || this.metaField(existing, 'publisher');
      metadata.year = metadata.year ?? this.metaField(existing, 'year');
      metadata.binding = metadata.binding || this.metaField(existing, 'binding');
    }

    const isbn = variant.barcode || null;

    // Enrichment only fills genuine gaps on first insert (avoids re-hitting
    // OpenLibrary on every sync; re-runs can be forced via the backfill script).
    if (enrich && !existing && isbn && (!author || !tags.year)) {
      try {
        const lookup = await enrichByIsbn(isbn);
        if (!author && lookup.author) {
          author = lookup.author;
          enriched.author = true;
        }
        if (!tags.year && lookup.year) {
          metadata.year = lookup.year;
          enriched.year = true;
        }
        if (!metadata.publisher && lookup.publisher) {
          metadata.publisher = lookup.publisher;
        }
      } catch (error) {
        // enrichment is best-effort; metadata_status reflects the gap
        metadata.enrichment_error = error.message;
      }
    }

    const metadataStatus = existing
      ? this.resolveExistingStatus(existing, { author, condition, year: metadata.year, enriched })
      : computeMetadataStatus({ author, year: metadata.year, condition, enriched });

    // Persist enrichment flags so 'unverified' survives future syncs until confirmed
    const mergedEnriched = { ...this.priorEnrichedFields(existing), ...enriched };
    if (Object.keys(mergedEnriched).length > 0) {
      metadata.enriched = mergedEnriched;
    }

    // single-copy model: any positive stock means available
    const quantity = parseInt(variant.inventory_quantity || 0, 10) > 0 ? 1 : 0;

    return {
      shopify_product_id: String(shopifyProduct.id),
      title: shopifyProduct.title,
      description: shopifyProduct.body_html || '',
      price: parseFloat(variant.price || 0),
      isbn,
      quantity,
      images: JSON.stringify(images),
      author: author || null,
      condition: condition || null,
      metadata: JSON.stringify(metadata),
      metadata_status: metadataStatus,
      _enriched: Object.keys(enriched).length > 0,
    };
  }

  metaField(product, field) {
    try {
      const meta = typeof product.metadata === 'string' ? JSON.parse(product.metadata || '{}') : product.metadata || {};
      return meta[field] ?? null;
    } catch {
      return null;
    }
  }

  // When updating, keep prior unverified enrichments flagged until confirmed,
  // but let freshly-parsed complete tags promote the status.
  resolveExistingStatus(existing, { author, condition, year, enriched }) {
    const priorEnrichedFields = this.priorEnrichedFields(existing);
    const stillEnriched = { ...priorEnrichedFields, ...enriched };
    if (Object.keys(stillEnriched).length > 0) {
      return 'unverified';
    }
    return computeMetadataStatus({ author, condition, year });
  }

  priorEnrichedFields(product) {
    try {
      const meta = typeof product.metadata === 'string' ? JSON.parse(product.metadata || '{}') : product.metadata || {};
      return meta.enriched || {};
    } catch {
      return {};
    }
  }

  findByShopifyId(shopifyId) {
    const result = query('SELECT * FROM products WHERE shopify_product_id = ?', [String(shopifyId)]);
    return result.rows[0] || null;
  }

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
    if (filters.metadataStatus) {
      sql += ' AND metadata_status = ?';
      params.push(filters.metadataStatus);
    }
    if (filters.minPrice) {
      sql += ' AND price >= ?';
      params.push(parseFloat(filters.minPrice));
    }
    if (filters.maxPrice) {
      sql += ' AND price <= ?';
      params.push(parseFloat(filters.maxPrice));
    }
    if (filters.sold === 'true') {
      sql += ' AND sold_at IS NOT NULL';
    } else if (filters.sold === 'false') {
      sql += ' AND sold_at IS NULL';
    }

    sql += ' ORDER BY created_at DESC';

    const result = query(sql, params);
    return result.rows.map(this.parseProduct);
  }

  async getById(id) {
    const result = query('SELECT * FROM products WHERE id = ?', [id]);
    return result.rows[0] ? this.parseProduct(result.rows[0]) : null;
  }

  async create(productData) {
    const sql = `
      INSERT INTO products (
        shopify_product_id, isbn, title, author, description,
        price, cost, condition, quantity, images, metadata, metadata_status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      RETURNING *
    `;
    const row = db
      .prepare(sql)
      .get(
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
        productData.metadata_status || 'missing'
      );
    return this.parseProduct(row);
  }

  async update(id, productData) {
    const allowed = [
      'title',
      'author',
      'description',
      'price',
      'cost',
      'condition',
      'quantity',
      'images',
      'metadata',
      'metadata_status',
      'sold_at',
      'sold_via',
      'isbn',
    ];
    const fields = [];
    const params = [];

    for (const field of allowed) {
      if (productData[field] !== undefined) {
        fields.push(`${field} = ?`);
        params.push(productData[field]);
      }
    }

    if (fields.length === 0) {
      return this.getById(id);
    }

    params.push(id);
    query(`UPDATE products SET ${fields.join(', ')} WHERE id = ?`, params);
    return this.getById(id);
  }

  // Single-copy sale flow (W3): close the book everywhere.
  async markSold(id, soldVia) {
    query('UPDATE products SET quantity = 0, sold_at = CURRENT_TIMESTAMP, sold_via = ? WHERE id = ?', [
      soldVia,
      id,
    ]);
    return this.getById(id);
  }

  async delete(id) {
    query('DELETE FROM products WHERE id = ?', [id]);
    return { success: true };
  }

  parseProduct(row) {
    return {
      ...row,
      images: JSON.parse(row.images || '[]'),
      metadata: JSON.parse(row.metadata || '{}'),
    };
  }
}

module.exports = new ProductService();
