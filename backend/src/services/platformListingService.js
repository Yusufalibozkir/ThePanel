const { query } = require('../config/database');

class PlatformListingService {
  // Create or update the listing row for a product+platform pair
  async upsertListing(listingData) {
    const existing = this.getListingByPlatform(listingData.product_id, listingData.platform);
    if (existing) {
      query(
        `UPDATE platform_listings
         SET platform_listing_id = ?, status = ?, external_price = ?, platform_url = ?,
             sync_enabled = ?, error_message = ?
         WHERE id = ?`,
        [
          listingData.platform_listing_id ?? existing.platform_listing_id,
          listingData.status || existing.status,
          listingData.external_price ?? existing.external_price,
          listingData.platform_url ?? existing.platform_url,
          listingData.sync_enabled !== undefined ? (listingData.sync_enabled ? 1 : 0) : existing.sync_enabled,
          listingData.error_message ?? null,
          existing.id,
        ]
      );
      return this.getListingByPlatform(listingData.product_id, listingData.platform);
    }
    return this.createListing(listingData);
  }

  // Create a new platform listing
  async createListing(listingData) {
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

  async getAll() {
    const result = query('SELECT * FROM platform_listings');
    return result.rows.map(row => ({
      ...row,
      sync_enabled: Boolean(row.sync_enabled),
    }));
  }

  // Get all listings for a product
  async getListingsByProductId(productId) {
    const result = query('SELECT * FROM platform_listings WHERE product_id = ?', [productId]);
    return result.rows.map(row => ({
      ...row,
      sync_enabled: Boolean(row.sync_enabled),
    }));
  }

  // Get listing by platform and product
  async getListingByPlatform(productId, platform) {
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
