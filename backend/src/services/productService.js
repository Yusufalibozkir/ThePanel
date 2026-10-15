const { db, query } = require('../config/database');
const { parseProductTags } = require('./metadata/tagParser');
const { computeMetadataStatus } = require('./metadata/status');
const { enrichByIsbn } = require('./metadata/openLibrary');
const changeLogService = require('./changeLogService');

// Fields that can be locally edited through the panel. These edits are stored
// as an overlay in product_changes — the products table stays the Shopify truth.
const EDITABLE_FIELDS = [
  'title',
  'author',
  'isbn',
  'price',
  'cost',
  'quantity',
  'condition',
  'description',
];

const NUMBER_FIELDS = new Set(['price', 'cost', 'quantity']);

class ProductService {
  // Sync products (normalized shape from shopifyService) into the local DB.
  // The products table is the TRUTH mirror: Shopify values always win here.
  // Manual panel edits live as an overlay in product_changes and are untouched.
  // Truth changes are recorded as 'sync' history entries (informational),
  // stamped with the run id so the run log links to its changes.
  async syncProductsFromShopify(shopifyProducts, { enrich = true, runId = null } = {}) {
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
          this.recordTruthChanges(existing.id, existing, productData, runId);
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

  // Log which truth fields actually changed during a sync (informational history).
  recordTruthChanges(productId, before, mapped, runId = null) {
    const tracked = [
      'title',
      'description',
      'price',
      'quantity',
      'isbn',
      'author',
      'condition',
      'images',
      'metadata',
    ];
    const changes = [];
    for (const field of tracked) {
      if (mapped[field] === undefined) continue;
      const oldValue = before[field] ?? null;
      const newValue = mapped[field] ?? null;
      if (String(oldValue) !== String(newValue)) {
        changes.push({ field, oldValue, newValue });
      }
    }
    if (changes.length > 0) {
      changeLogService.record(productId, 'sync', changes, null, runId);
    }
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
      category: shopifyProduct.category || null,
      tags: Array.isArray(shopifyProduct.tags) ? shopifyProduct.tags : [],
      publisher: tags.publisher,
      year: tags.year,
      binding: tags.binding,
      // Seller SKU: needed as the book/inventory number for the AbeBooks
      // export and as a seller identifier on eBay listings.
      sku: variant.sku || null,
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
    // Tag filter (comma-separated list, case-insensitive, any-match)
    if (filters.tags) {
      const wanted = String(filters.tags)
        .split(',')
        .map((t) => t.trim().toLowerCase())
        .filter(Boolean);
      if (wanted.length > 0) {
        const placeholders = wanted.map(() => '?').join(', ');
        sql += ` AND EXISTS (
          SELECT 1 FROM json_each(products.metadata, '$.tags') je
          WHERE lower(je.value) IN (${placeholders})
        )`;
        params.push(...wanted);
      }
    }
    // Category filter: matches the Shopify taxonomy category or product type
    if (filters.category) {
      const wanted = String(filters.category).toLowerCase();
      sql += ` AND (
        lower(json_extract(products.metadata, '$.category')) = ?
        OR lower(json_extract(products.metadata, '$.product_type')) = ?
      )`;
      params.push(wanted, wanted);
    }
    if (filters.vendor) {
      sql += ` AND lower(json_extract(products.metadata, '$.vendor')) = ?`;
      params.push(String(filters.vendor).toLowerCase());
    }

    sql += ' ORDER BY created_at DESC';

    const result = query(sql, params);
    const rows = result.rows;
    const overridesByProduct = changeLogService.getOverridesForProducts(rows.map((r) => r.id));
    return rows.map((row) => this.effectiveView(row, overridesByProduct.get(row.id)));
  }

  // Aggregate filterable values (tags, categories, vendor, binding, publisher,
  // year) with counts, for populating filter dropdowns. Cheap single scan.
  async getFacets() {
    const rows = query(
      'SELECT condition, metadata FROM products'
    ).rows;

    const tally = (map, value) => {
      if (value === null || value === undefined || value === '') return;
      map.set(value, (map.get(value) || 0) + 1);
    };
    const byCountDesc = (map) =>
      [...map.entries()]
        .map(([value, count]) => ({ value, count }))
        .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));

    const tags = new Map();
    const categories = new Map();
    const vendors = new Map();
    const bindings = new Map();
    const publishers = new Map();
    const years = new Map();

    for (const row of rows) {
      const meta = this.parseMeta(row.metadata);
      for (const tag of Array.isArray(meta.tags) ? meta.tags : []) {
        tally(tags, tag);
      }
      tally(categories, meta.category);
      tally(categories, meta.product_type);
      tally(vendors, meta.vendor);
      tally(bindings, meta.binding);
      tally(publishers, meta.publisher);
      const year = Number(meta.year);
      if (meta.year !== null && meta.year !== undefined && Number.isFinite(year) && year > 0) {
        tally(years, year);
      }
    }

    return {
      tags: byCountDesc(tags),
      categories: byCountDesc(categories),
      vendors: byCountDesc(vendors),
      bindings: byCountDesc(bindings),
      publishers: byCountDesc(publishers),
      years: byCountDesc(years).sort((a, b) => Number(b.value) - Number(a.value)),
    };
  }

  parseMeta(metadata) {
    try {
      const meta = typeof metadata === 'string' ? JSON.parse(metadata || '{}') : metadata || {};
      return meta || {};
    } catch {
      return {};
    }
  }

  async getById(id) {
    const result = query('SELECT * FROM products WHERE id = ?', [id]);
    if (!result.rows[0]) return null;
    return this.effectiveView(result.rows[0], changeLogService.getOverrides(id));
  }

  // Raw truth row (no overlay merge) — internal use.
  getTruthById(id) {
    const result = query('SELECT * FROM products WHERE id = ?', [id]);
    return result.rows[0] || null;
  }

  // Merge the manual overlay onto a truth row. Marks fields whose effective
  // value differs from the Shopify truth and attaches the truth values so the
  // UI can offer a side-by-side comparison.
  effectiveView(row, overrides) {
    const product = this.parseProduct(row);
    const localEdits = [];
    const shopifyTruth = {};
    if (overrides) {
      for (const [field, value] of overrides) {
        const truthValue = product[field] ?? null;
        product[field] = value;
        if (!this.valuesEqual(field, value, truthValue)) {
          localEdits.push(field);
          shopifyTruth[field] = truthValue;
        }
      }
    }
    product.local_edits = localEdits;
    product.shopify_truth = shopifyTruth;
    return product;
  }

  valuesEqual(field, a, b) {
    if (NUMBER_FIELDS.has(field)) {
      const na = a === null || a === undefined || a === '' ? null : Number(a);
      const nb = b === null || b === undefined || b === '' ? null : Number(b);
      if (na === null || nb === null) return na === nb;
      return na === nb;
    }
    const sa = a === null || a === undefined ? '' : String(a);
    const sb = b === null || b === undefined ? '' : String(b);
    return sa === sb;
  }

  // Normalize a value coming from the edit form into its canonical form.
  normalizeEditValue(field, value) {
    if (value === undefined) return undefined;
    if (NUMBER_FIELDS.has(field)) {
      if (value === null || value === '' ) return null;
      const n = Number(value);
      return Number.isFinite(n) ? n : null;
    }
    if (value === null) return null;
    const s = String(value);
    if (field !== 'description' && s.trim() === '') return null;
    return s;
  }

  // Manual edit through the panel: records an overlay entry in product_changes.
  // The products table (Shopify truth) is NOT modified — sync keeps refreshing it.
  async applyEdit(id, productData) {
    const truthRow = this.getTruthById(id);
    if (!truthRow) return null;

    const overrides = changeLogService.getOverrides(id);
    const changes = [];

    for (const field of EDITABLE_FIELDS) {
      if (!Object.prototype.hasOwnProperty.call(productData, field)) continue;
      const newValue = this.normalizeEditValue(field, productData[field]);
      if (newValue === undefined) continue;

      const currentValue = overrides.has(field)
        ? overrides.get(field)
        : this.normalizeEditValue(field, truthRow[field]) ?? truthRow[field];
      const baseline = currentValue === undefined ? null : currentValue;

      if (!this.valuesEqual(field, newValue, baseline)) {
        changes.push({ field, oldValue: baseline, newValue });
      }
    }

    if (changes.length > 0) {
      changeLogService.record(id, 'manual', changes);
    }

    return this.effectiveView(truthRow, changeLogService.getOverrides(id));
  }

  // JSON columns may arrive as objects (frontend duplicate/edit flows);
  // normalize to strings so better-sqlite3 can bind them.
  stringifyJsonField(value, fallback) {
    if (value === null || value === undefined || value === '') return fallback;
    if (typeof value === 'string') return value;
    return JSON.stringify(value);
  }

  async create(productData) {
    const sql = `
      INSERT INTO products (
        shopify_product_id, isbn, title, author, description,
        price, cost, condition, quantity, images, metadata, metadata_status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      RETURNING *
    `;
    // Locally created products (no Shopify counterpart) get a synthetic id so
    // the UNIQUE constraint holds; a later Shopify sync never matches them.
    const shopifyId = productData.shopify_product_id
      ? String(productData.shopify_product_id)
      : `local-${Date.now().toString(16)}-${Math.random().toString(16).slice(2, 10)}`;

    const row = db
      .prepare(sql)
      .get(
        shopifyId,
        productData.isbn || null,
        productData.title,
        productData.author || null,
        productData.description || null,
        Number(productData.price) || 0,
        productData.cost === null || productData.cost === undefined || productData.cost === ''
          ? null
          : Number(productData.cost),
        productData.condition || null,
        Number(productData.quantity) || 0,
        this.stringifyJsonField(productData.images, '[]'),
        this.stringifyJsonField(productData.metadata, '{}'),
        productData.metadata_status || 'missing'
      );
    return this.parseProduct(row);
  }

  // Truth write: updates the products table directly (sync, metadata pipeline,
  // local-only fields). Manual panel edits go through applyEdit instead.
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
        let value = productData[field];
        if (field === 'images' || field === 'metadata') {
          value = this.stringifyJsonField(value, field === 'images' ? '[]' : '{}');
        }
        fields.push(`${field} = ?`);
        params.push(value);
      }
    }

    if (fields.length === 0) {
      return this.getById(id);
    }

    params.push(id);
    query(`UPDATE products SET ${fields.join(', ')} WHERE id = ?`, params);
    return this.getById(id);
  }

  // Single-copy sale flow: sold_at/sold_via are local-only truth; the quantity
  // drop is recorded as a manual overlay so it stays visible while Shopify
  // keeps refreshing the truth quantity.
  async markSold(id, soldVia) {
    const truthRow = this.getTruthById(id);
    if (!truthRow) return null;

    query('UPDATE products SET sold_at = CURRENT_TIMESTAMP, sold_via = ? WHERE id = ?', [soldVia, id]);

    const overrides = changeLogService.getOverrides(id);
    const effectiveQty = overrides.has('quantity') ? overrides.get('quantity') : truthRow.quantity;
    if (Number(effectiveQty) !== 0) {
      changeLogService.record(id, 'manual', [{ field: 'quantity', oldValue: effectiveQty, newValue: 0 }]);
    }

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
