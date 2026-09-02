/* eslint-disable camelcase */

exports.shorthands = undefined;

exports.up = pgm => {
  // Create enum types
  pgm.createType('condition_type', ['new', 'like_new', 'very_good', 'good', 'acceptable']);
  pgm.createType('platform_type', ['ebay', 'abebooks', 'etsy']);
  pgm.createType('listing_status_type', ['draft', 'active', 'sold', 'error', 'delisted']);
  
  // Create products table
  pgm.createTable('products', {
    id: {
      type: 'uuid',
      primaryKey: true,
      default: pgm.func('gen_random_uuid()'),
    },
    shopify_product_id: {
      type: 'varchar(255)',
      notNull: true,
      unique: true,
    },
    isbn: {
      type: 'varchar(20)',
      notNull: false,
    },
    title: {
      type: 'varchar(500)',
      notNull: true,
    },
    author: {
      type: 'varchar(255)',
      notNull: false,
    },
    description: {
      type: 'text',
      notNull: false,
    },
    price: {
      type: 'decimal(10, 2)',
      notNull: true,
    },
    cost: {
      type: 'decimal(10, 2)',
      notNull: false,
    },
    condition: {
      type: 'condition_type',
      notNull: false,
    },
    quantity: {
      type: 'integer',
      notNull: true,
      default: 0,
    },
    images: {
      type: 'jsonb',
      notNull: false,
      default: '[]',
    },
    metadata: {
      type: 'jsonb',
      notNull: false,
      default: '{}',
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
  pgm.createIndex('products', 'isbn');
  pgm.createIndex('products', 'shopify_product_id');
};

exports.down = pgm => {
  pgm.dropTable('products');
  pgm.dropType('condition_type');
  pgm.dropType('platform_type');
  pgm.dropType('listing_status_type');
};
