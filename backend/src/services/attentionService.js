const { db } = require('../config/database');

// "Needs attention" aggregation (C-10): one query surface for everything the
// operator must look at — error listings, exhausted jobs, and metadata gaps.
// Competitor lesson: every major complaint about their tools is a visibility
// failure first; this aggregate is what the chip on every screen reads.

const build = () => {
  const errorListings = db
    .prepare(
      `SELECT pl.platform, pl.error_message, p.id AS product_id, p.title
       FROM platform_listings pl
       JOIN products p ON p.id = pl.product_id
       WHERE pl.status = 'error'
       ORDER BY pl.updated_at DESC
       LIMIT 100`
    )
    .all();

  const failedJobs = db
    .prepare(
      `SELECT id, type, attempts, max_attempts, last_error, updated_at
       FROM jobs
       WHERE status = 'failed'
       ORDER BY updated_at DESC
       LIMIT 50`
    )
    .all();

  const metadataMissing = db
    .prepare("SELECT COUNT(*) AS n FROM products WHERE metadata_status = 'missing' AND sold_at IS NULL")
    .get().n;
  const metadataUnverified = db
    .prepare("SELECT COUNT(*) AS n FROM products WHERE metadata_status = 'unverified' AND sold_at IS NULL")
    .get().n;

  const total = errorListings.length + failedJobs.length + metadataMissing + metadataUnverified;

  return {
    total,
    listings_error: { count: errorListings.length, items: errorListings },
    failed_jobs: { count: failedJobs.length, items: failedJobs },
    metadata_missing: { count: metadataMissing },
    metadata_unverified: { count: metadataUnverified },
  };
};

module.exports = { build };
