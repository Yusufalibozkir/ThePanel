const { query } = require('../config/database');

class PlatformListingService {
  // Create a new platform listing
  async createListing(listingData) {
    const sql = `
      INSERT INTO platform_listings (
        product_id, platform, platform_listing_id, status,
        platform_price, platform_url, sync_enabled
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `;

    const params = [
      listingData.product_id,
      listingData.platform,
      listingData.platform_listing_id || null,
      listingData.status || 'draft',
      listingData.platform_price || null,
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
