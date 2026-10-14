const jobRunner = require('./runner');
const shopifyService = require('../services/shopifyService');
const productService = require('../services/productService');
const syncLogService = require('../services/syncLogService');
const { enrichByIsbn } = require('../services/metadata/openLibrary');
const { computeMetadataStatus } = require('../services/metadata/status');
const { db } = require('../config/database');

// Job handlers. Channel handlers (list/update/end_listing/export_abebooks)
// arrive with the Phase 3/4 adapters; the foundation ones live here.

jobRunner.registerHandler('sync_shopify', async () => {
  const result = await shopifyService.getProducts(250);
  if (!result.success) {
    throw new Error(`shopify fetch failed: ${result.message}`);
  }
  const sync = await productService.syncProductsFromShopify(result.products);
  await syncLogService.createLog({
    platform: 'shopify',
    action: 'sync',
    status: sync.errors.length > 0 ? 'failed' : 'success',
    details: {
      created: sync.created,
      updated: sync.updated,
      enriched: sync.enriched,
      error_count: sync.errors.length,
    },
    error_message: sync.errors[0]?.error || null,
  });
  return sync;
});

// One-time (or on-demand) metadata backfill over the existing catalog:
// tags -> OpenLibrary enrichment for gaps -> recompute metadata_status.
jobRunner.registerHandler('backfill_metadata', async ({ force = false } = {}) => {
  const products = db.prepare('SELECT * FROM products').all();
  const summary = {
    scanned: products.length,
    enriched: 0,
    confirmed_ok: 0,
    still_missing: 0,
    errors: 0,
    filled: { author: 0, year: 0, publisher: 0 },
    needs_attention: [],
  };

  for (const row of products) {
    try {
      const metadata = JSON.parse(row.metadata || '{}');
      let { author, condition } = row;
      const enriched = { ...(metadata.enriched || {}) };
      const meta = { ...metadata };

      if (row.isbn && (force || !author || meta.year == null) && Object.keys(enriched).length === 0) {
        const lookup = await enrichByIsbn(row.isbn);
        if (!author && lookup.author) {
          author = lookup.author;
          enriched.author = true;
          summary.filled.author++;
        }
        if (meta.year == null && lookup.year) {
          meta.year = lookup.year;
          enriched.year = true;
          summary.filled.year++;
        }
        if (!meta.publisher && lookup.publisher) {
          meta.publisher = lookup.publisher;
          summary.filled.publisher++;
        }
        if (Object.keys(enriched).length > 0) {
          meta.enriched = enriched;
          summary.enriched++;
        }
      }

      const status = computeMetadataStatus({ author, year: meta.year, condition, enriched });
      if (status === 'ok') summary.confirmed_ok++;
      if (status === 'missing') {
        summary.still_missing++;
        summary.needs_attention.push({ id: row.id, title: row.title, isbn: row.isbn });
      }

      db.prepare('UPDATE products SET author = ?, metadata = ?, metadata_status = ? WHERE id = ?').run(
        author || null,
        JSON.stringify(meta),
        status,
        row.id
      );
    } catch {
      summary.errors++;
    }
  }

  await syncLogService.createLog({
    platform: 'shopify',
    action: 'sync',
    status: 'success',
    details: { backfill: true, ...summary, needs_attention: undefined },
  });

  return summary;
});

module.exports = jobRunner;
