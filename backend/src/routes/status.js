const express = require('express');
const router = express.Router();
const statusController = require('../controllers/statusController');

router.get('/sync', statusController.getSyncStatus);
router.get('/attention', statusController.getAttention);

module.exports = router;
