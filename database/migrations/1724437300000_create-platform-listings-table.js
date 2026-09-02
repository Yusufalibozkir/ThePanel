/* eslint-disable camelcase */

exports.shorthands = undefined;

exports.up = pgm => {
  // Create platform_listings table
  pgm.createTable('platform_listings', {
    id: {
      type: 'uuid',
      primaryKey: true,
      default: pgm.func('gen_random_uuid()'),
    },
    product_id: {
      type: 'uuid',
      notNull: true,
      references: 'products',
      onDelete: 'CASCADE',
    },
    platform: {
      type: 'platform_type',
      notNull: true,
    },
    platform_listing_id: {
      type: 'varchar(255)',
      notNull: false,
    },
    status: {
      type: 'listing_status_type',
      notNull: true,
      default: 'draft',
    },
    platform_price: {
      type: 'decimal(10, 2)',
      notNull: false,
    },
    platform_url: {
      type: 'text',
      notNull: false,
    },
    sync_enabled: {
      type: 'boolean',
      notNull: true,
      default: true,
    },
    last_synced_at: {
      type: 'timestamp',
      notNull: false,
    },
    error_message: {
      type: 'text',
      notNull: false,
    },
    created_at: {
      type: 'timestamp',
      notNull: true,
      default: pgm.func('current_timestamp'),
    },
    updated_at: {
      type: 'timestamp',
      notNull: true,
      default: pgm.func('current_timestamp'),
    },
  });

  // Create indexes
  pgm.createIndex('platform_listings', 'product_id');
  pgm.createIndex('platform_listings', 'platform');
  pgm.createIndex('platform_listings', 'platform_listing_id');
  pgm.createIndex('platform_listings', 'status');
  
  // Create unique constraint on product_id + platform
  pgm.addConstraint('platform_listings', 'unique_product_platform', {
    unique: ['product_id', 'platform'],
  });
};

exports.down = pgm => {
  pgm.dropTable('platform_listings');
};
