const jobService = require('../services/jobService');
const productService = require('../services/productService');
const { db, query } = require('../config/database');
const { computeMetadataStatus } = require('../services/metadata/status');

const listJobs = async (req, res) => {
  try {
    const jobs = jobService.list({
      status: req.query.status,
      type: req.query.type,
      limit: req.query.limit,
    });
    res.json({ success: true, stats: jobService.stats(), jobs });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getJob = async (req, res) => {
  const job = jobService.get(req.params.id);
  if (!job) {
    return res.status(404).json({ success: false, message: 'Job not found' });
  }
  res.json({ success: true, job });
};

const retryJob = async (req, res) => {
  try {
    const job = jobService.get(req.params.id);
    if (!job) {
      return res.status(404).json({ success: false, message: 'Job not found' });
    }
    if (job.status !== 'failed') {
      return res.status(400).json({ success: false, message: 'Only failed jobs can be retried' });
    }
    db.prepare(
      `UPDATE jobs SET status = 'pending', attempts = 0, next_run_at = CURRENT_TIMESTAMP WHERE id = ?`
    ).run(job.id);
    res.json({ success: true, message: 'Job requeued' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Queue a metadata backfill over the existing catalog
const queueBackfill = async (req, res) => {
  try {
    const job = jobService.enqueue('backfill_metadata', { force: req.body?.force === true }, { maxAttempts: 1 });
    res.status(202).json({ success: true, message: 'Backfill queued', jobId: job.id });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Products needing metadata review (unverified or missing)
const needsReview = async (req, res) => {
  try {
    const rows = query(
      `SELECT id, title, author, isbn, condition, metadata, metadata_status, images
       FROM products
       WHERE metadata_status IN ('unverified', 'missing')
       ORDER BY CASE metadata_status WHEN 'missing' THEN 0 ELSE 1 END, created_at DESC`
    ).rows.map((row) => ({
      ...row,
      metadata: JSON.parse(row.metadata || '{}'),
      images: JSON.parse(row.images || '[]'),
    }));
    res.json({ success: true, count: rows.length, products: rows });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Confirm (and optionally correct) metadata for one product. Clears the
// unverified flags and recomputes metadata_status.
const confirmMetadata = async (req, res) => {
  try {
    const product = await productService.getById(req.params.id);
    if (!product) {
      return res.status(404).json({ success: false, message: 'Product not found' });
    }

    const metadata = { ...product.metadata };
    const author = req.body.author !== undefined ? req.body.author : product.author;
    const condition = req.body.condition !== undefined ? req.body.condition : product.condition;
    if (req.body.year !== undefined) metadata.year = req.body.year === null ? null : parseInt(req.body.year, 10);
    if (req.body.publisher !== undefined) metadata.publisher = req.body.publisher;

    delete metadata.enriched;
    delete metadata.enrichment_error;

    const status = computeMetadataStatus({
      author,
      year: metadata.year ?? null,
      condition,
    });

    await productService.update(product.id, {
      author: author || null,
      condition: condition || null,
      metadata: JSON.stringify(metadata),
      metadata_status: status,
    });

    res.json({ success: true, message: 'Metadata confirmed', metadata_status: status });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = { listJobs, getJob, retryJob, queueBackfill, needsReview, confirmMetadata };
