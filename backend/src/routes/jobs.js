const express = require('express');
const router = express.Router();
const jobsController = require('../controllers/jobsController');

router.get('/', jobsController.listJobs);
router.get('/metadata/needs-review', jobsController.needsReview);
router.post('/metadata/backfill', jobsController.queueBackfill);
router.post('/products/:id/metadata/confirm', jobsController.confirmMetadata);
router.get('/:id', jobsController.getJob);
router.post('/:id/retry', jobsController.retryJob);

module.exports = router;
