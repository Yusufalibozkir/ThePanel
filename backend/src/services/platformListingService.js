const { query } = require('../config/database');
const changeLogService = require('./changeLogService');

// Panel-owned per-platform content fields. The main text still comes from the
// product (Shopify truth); these are extras composed in at listing/export time.
const PLATFORM_FIELDS = ['notes', 'title_override'];
const VALID_PLATFORMS = new Set(['ebay', 'abebooks', 'etsy']);

class PlatformListingService {
  // Save per-platform content fields (notes, title_override). The values are
  // written directly to platform_listings — they have no Shopify counterpart —
  // and every change is journaled into product_changes scoped to the platform,
  // so each save is a version hanging off the same book id.
  savePlatformFields(productId, platform, data = {}) {
    if (!VALID_PLATFORMS.has(platform)) {
      throw new Error(`Invalid platform: ${platform}`);
    }

    let existing = this.getListingByPlatform(productId, platform);
    if (!existing) {
      this.createListing({ product_id: productId, platform, status: 'draft' });
      existing = this.getListingByPlatform(productId, platform);
    }

    const changes = [];
    const updates = {};
    for (const field of PLATFORM_FIELDS) {
      if (!Object.prototype.hasOwnProperty.call(data, field)) continue;
      const raw = data[field];
      const newValue = raw === null || raw === undefined || String(raw).trim() === '' ? null : String(raw);
      const oldValue = existing[field] ?? null;
      if (newValue !== oldValue) {
        changes.push({ field, oldValue, newValue });
        updates[field] = newValue;
      }
    }

    if (changes.length > 0) {
      const setSql = Object.keys(updates)
        .map((f) => `${f} = ?`)
        .join(', ');
      query(`UPDATE platform_listings SET ${setSql} WHERE id = ?`, [
        ...Object.values(updates),
        existing.id,
      ]);
      changeLogService.record(productId, 'manual', changes, platform);
    }

    return this.getListingByPlatform(productId, platform);
  }

  // Delete a platform-scoped history entry and peel the fields back to the
  // previous version (or null when no earlier version remains), mirroring the
  // base overlay semantics.
  deletePlatformChangeEntry(productId, changeId) {
    const entry = changeLogService.getEntry(productId, changeId);
    if (!entry || !entry.platform) return null;

    changeLogService.deleteEntry(productId, changeId);
    const fields = [...new Set(entry.changes.map((c) => c.field))];
    for (const field of fields) {
      const previous = query(
        `SELECT new_value FROM product_changes
         WHERE product_id = ? AND platform = ? AND field = ? AND source = 'manual'
         ORDER BY changed_at DESC, rowid DESC LIMIT 1`,
        [productId, entry.platform, field]
      ).rows[0];

      if (PLATFORM_FIELDS.includes(field)) {
        query(`UPDATE platform_listings SET ${field} = ? WHERE product_id = ? AND platform = ?`, [
          previous ? previous.new_value : null,
          productId,
          entry.platform,
        ]);
      }
    }
    return entry;
  }

  // Create a new platform listing
  // Note: the read helpers below are intentionally synchronous (query() is
  // sync) — `async` without awaiting anything returns Promises and breaks
  // non-awaited callers.
  createListing(listingData) {
    const sql = `
      INSERT INTO platform_listings (
        product_id, platform, platform_listing_id, status,
        external_price, platform_url, sync_enabled
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `;

    const params = [
      listingData.product_id,
      listingData.platform,
      listingData.platform_listing_id || null,
      listingData.status || 'draft',
      listingData.external_price ?? null,
      listingData.platform_url || null,
      listingData.sync_enabled !== undefined ? (listingData.sync_enabled ? 1 : 0) : 1,
    ];

    query(sql, params);
    return this.getListingsByProductId(listingData.product_id);
  }

  getAll() {
    const result = query('SELECT * FROM platform_listings');
    return result.rows.map(row => ({
      ...row,
      sync_enabled: Boolean(row.sync_enabled),
    }));
  }

  // Get all listings for a product
  getListingsByProductId(productId) {
    const result = query('SELECT * FROM platform_listings WHERE product_id = ?', [productId]);
    return result.rows.map(row => ({
      ...row,
      sync_enabled: Boolean(row.sync_enabled),
    }));
  }

  // Get listing by platform and product
  getListingByPlatform(productId, platform) {
    const result = query(
      'SELECT * FROM platform_listings WHERE product_id = ? AND platform = ?',
      [productId, platform]
    );
    const row = result.rows[0];
    return row ? { ...row, sync_enabled: Boolean(row.sync_enabled) } : null;
  }

  // Update listing status
  async updateListingStatus(id, status, errorMessage = null) {
    query(
      'UPDATE platform_listings SET status = ?, error_message = ? WHERE id = ?',
      [status, errorMessage, id]
    );
    return { success: true };
  }

  // Update listing after sync
  async updateAfterSync(id, platformListingId, platformUrl, status) {
    query(
      `UPDATE platform_listings
       SET platform_listing_id = ?, platform_url = ?, status = ?,
           last_synced_at = CURRENT_TIMESTAMP, error_message = NULL
       WHERE id = ?`,
      [platformListingId, platformUrl, status, id]
    );
    return { success: true };
  }

  // Mark an AbeBooks listing as included in the latest export file
  async markExported(productId) {
    query(
      `UPDATE platform_listings
       SET status = 'exported', last_exported_at = CURRENT_TIMESTAMP, last_synced_at = CURRENT_TIMESTAMP
       WHERE product_id = ? AND platform = 'abebooks'`,
      [productId]
    );
    return { success: true };
  }

  // Toggle sync enabled
  async toggleSync(id, enabled) {
    query('UPDATE platform_listings SET sync_enabled = ? WHERE id = ?', [enabled ? 1 : 0, id]);
    return { success: true };
  }

  // Delete listing
  async deleteListing(id) {
    query('DELETE FROM platform_listings WHERE id = ?', [id]);
    return { success: true };
  }
}

module.exports = new PlatformListingService();
