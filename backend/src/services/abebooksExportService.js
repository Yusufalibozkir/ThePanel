const { query } = require('../config/database');
const rulesService = require('./rulesService');
const { evaluateRule } = require('../engines/rules');
const { computePrice } = require('../engines/pricing');
const productService = require('./productService');
const platformListingService = require('./platformListingService');
const syncLogService = require('./syncLogService');
const composer = require('./listingComposer');

// AbeBooks export: compose eligible books into a bulk-upload TSV file that
// the operator uploads through their bookseller account (export channel —
// no live API, per the plan's locked decisions).
//
// Modes:
//   full      — every rule-eligible book
//   delta     — rule-eligible books that are new or changed since their
//               last export (the time-saver: never resend an unchanged catalog)
//   selection — an explicit list of product ids; the operator's pick
//               overrides the rule's conditions, but never the single-copy
//               stock check
//
// Generating (not previewing) commits the export baseline: each included
// book gets an abebooks listing row with status 'exported' and a fresh
// last_exported_at, and one sync log records the run.

const PLATFORM = 'abebooks';

class AbebooksExportService {
  // Build the export without side effects (for preview and generate alike).
  async buildExport({ mode = 'full', productIds = null } = {}) {
    const rule = rulesService.getByPlatform(PLATFORM);
    if (!rule) throw new Error('No AbeBooks sync rule configured');
    if (!['full', 'delta', 'selection'].includes(mode)) throw new Error(`Invalid mode: ${mode}`);

    const products = await productService.getAll();
    // Index abebooks listings by product id (only rows for this platform)
    const listings = new Map();
    for (const listing of platformListingService.getAll()) {
      if (listing.platform === PLATFORM) listings.set(listing.product_id, listing);
    }

    const selected = Array.isArray(productIds) ? new Set(productIds) : null;
    const rows = [];
    const skipped = [];

    for (const product of products) {
      const listing = listings.get(product.id) || null;
      const result = evaluateRule(product, rule);

      if (mode === 'selection') {
        if (!selected || !selected.has(product.id)) continue;
        // Explicit selection overrides rule conditions — but never stock.
        if (product.quantity <= 0) {
          skipped.push({ product_id: product.id, title: product.title, reasons: ['not in stock (single-copy model)'] });
          continue;
        }
        // Price still comes from the pricing engine; blocked conditions are
        // surfaced as warnings rather than skips.
        const priced = computePrice(product.price, rule.price_modifier);
        if (!priced.ok) {
          skipped.push({ product_id: product.id, title: product.title, reasons: [priced.reason] });
          continue;
        }
        rows.push(this.buildRow(product, listing, priced.price, result.eligible ? null : result.reasons));
        continue;
      }

      if (mode === 'delta' && !this.isChangedSinceExport(product, listing)) continue;

      if (!result.eligible) {
        skipped.push({ product_id: product.id, title: product.title, reasons: result.reasons });
        continue;
      }
      rows.push(this.buildRow(product, listing, result.price, null));
    }

    return { mode, rows, skipped, generated_at: null };
  }

  buildRow(product, listing, price, warnings) {
    const row = composer.composeAbebooksRow(product, listing, price);
    return { ...row, product_id: product.id, warnings: warnings || null };
  }

  // Delta test: include books with no export baseline yet, or with any change
  // entry (base overlay, sync truth, or platform notes) newer than the last
  // export. The 1-second look-back guards against same-second timestamp
  // granularity: re-including an unchanged row is harmless, missing a change
  // is not.
  isChangedSinceExport(product, listing) {
    if (!listing || !listing.last_exported_at) return true;
    const hit = query(
      `SELECT 1 FROM product_changes
       WHERE product_id = ? AND changed_at > datetime(?, '-1 second')
       LIMIT 1`,
      [product.id, listing.last_exported_at]
    ).rows[0];
    return Boolean(hit);
  }

  // Generate the file and commit the export baseline. Returns the TSV
  // content plus skip report; the caller streams it as a download.
  async generate({ mode = 'full', productIds = null } = {}) {
    const { rows, skipped } = await this.buildExport({ mode, productIds });
    const content = composer.toAbebooksTSV(rows);
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const filename = `abebooks-export-${timestamp}.tsv`;

    for (const row of rows) {
      this.ensureExported(row.product_id);
    }

    syncLogService.createLog({
      id: syncLogService.newRunId(),
      platform: PLATFORM,
      action: 'export',
      status: 'success',
      details: {
        mode,
        exported: rows.length,
        skipped: skipped.length,
        skipped_sample: skipped.slice(0, 20),
      },
    });

    return { filename, content, count: rows.length, skipped, mode };
  }

  // Mark a book as included in the latest export: create the listing row
  // (status 'exported') if it does not exist, then stamp the baseline.
  ensureExported(productId) {
    const existing = platformListingService.getListingByPlatform(productId, PLATFORM);
    if (!existing) {
      platformListingService.createListing({ product_id: productId, platform: PLATFORM, status: 'exported' });
    }
    query(
      `UPDATE platform_listings
       SET status = 'exported', last_exported_at = CURRENT_TIMESTAMP, last_synced_at = CURRENT_TIMESTAMP
       WHERE product_id = ? AND platform = ?`,
      [productId, PLATFORM]
    );
  }
}

module.exports = new AbebooksExportService();
