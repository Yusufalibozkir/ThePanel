require('dotenv').config();

module.exports = {
  databaseUrl: `postgres://${process.env.DB_USER}:${process.env.DB_PASSWORD}@${process.env.DB_HOST}:${process.env.DB_PORT}/${process.env.DB_NAME}`,
  migrationsTable: 'pgmigrations',
  dir: 'database/migrations',
  direction: 'up',
  count: Infinity,
  checkOrder: true,
};
