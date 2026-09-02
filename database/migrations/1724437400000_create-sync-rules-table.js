/* eslint-disable camelcase */

exports.shorthands = undefined;

exports.up = pgm => {
  // Create sync_rules table
  pgm.createTable('sync_rules', {
    id: {
      type: 'uuid',
      primaryKey: true,
      default: pgm.func('gen_random_uuid()'),
    },
    platform: {
      type: 'platform_type',
      notNull: true,
      unique: true,
    },
    enabled: {
      type: 'boolean',
      notNull: true,
      default: false,
    },
    conditions: {
      type: 'jsonb',
      notNull: false,
      default: '{}',
      comment: 'Filters: min_price, max_price, condition, tags, etc.',
    },
    price_modifier: {
      type: 'jsonb',
      notNull: false,
      default: '{}',
      comment: 'e.g., {"type": "percentage", "value": 10} or {"type": "fixed", "value": -5}',
    },
    auto_sync: {
      type: 'boolean',
      notNull: true,
      default: false,
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

  // Create index
  pgm.createIndex('sync_rules', 'platform');
};

exports.down = pgm => {
  pgm.dropTable('sync_rules');
};
