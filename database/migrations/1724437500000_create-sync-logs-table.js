/* eslint-disable camelcase */

exports.shorthands = undefined;

exports.up = pgm => {
  // Create enum for sync actions
  pgm.createType('sync_action_type', ['create', 'update', 'delete']);
  pgm.createType('sync_status_type', ['success', 'failed']);

  // Create sync_logs table
  pgm.createTable('sync_logs', {
    id: {
      type: 'uuid',
      primaryKey: true,
      default: pgm.func('gen_random_uuid()'),
    },
    product_id: {
      type: 'uuid',
      notNull: false,
      references: 'products',
      onDelete: 'SET NULL',
    },
    platform: {
      type: 'platform_type',
      notNull: true,
    },
    action: {
      type: 'sync_action_type',
      notNull: true,
    },
    status: {
      type: 'sync_status_type',
      notNull: true,
    },
    details: {
      type: 'jsonb',
      notNull: false,
      default: '{}',
    },
    error_message: {
      type: 'text',
      notNull: false,
    },
    timestamp: {
      type: 'timestamp',
      notNull: true,
      default: pgm.func('current_timestamp'),
    },
  });

  // Create indexes
  pgm.createIndex('sync_logs', 'product_id');
  pgm.createIndex('sync_logs', 'platform');
  pgm.createIndex('sync_logs', 'status');
  pgm.createIndex('sync_logs', 'timestamp');
};

exports.down = pgm => {
  pgm.dropTable('sync_logs');
  pgm.dropType('sync_action_type');
  pgm.dropType('sync_status_type');
};
