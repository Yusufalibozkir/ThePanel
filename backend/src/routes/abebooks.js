const express = require('express');
const router = express.Router();
const abebooksController = require('../controllers/abebooksController');

// AbeBooks is an export-file channel (no live API): preview and generate
// bulk-upload files from the eligible catalog.

router.post('/export/preview', abebooksController.previewExport);
router.post('/export/generate', abebooksController.generateExport);

module.exports = router;
