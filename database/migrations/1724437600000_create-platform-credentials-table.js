/* eslint-disable camelcase */

exports.shorthands = undefined;

exports.up = pgm => {
  // Create platform_credentials table for storing encrypted credentials
  pgm.createTable('platform_credentials', {
    platform: {
      type: 'platform_type',
      primaryKey: true,
    },
    credentials: {
      type: 'jsonb',
      notNull: true,
      default: '{}',
      comment: 'Encrypted credentials for the platform',
    },
    token_expires_at: {
      type: 'timestamp',
      notNull: false,
    },
    last_validated_at: {
      type: 'timestamp',
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
};

exports.down = pgm => {
  pgm.dropTable('platform_credentials');
};
