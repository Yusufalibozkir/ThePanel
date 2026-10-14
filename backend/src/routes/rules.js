const express = require('express');
const router = express.Router();
const rulesController = require('../controllers/rulesController');

router.get('/', rulesController.getRules);
router.get('/:platform/preview', rulesController.preview);
router.put('/:platform', rulesController.updateRule);

module.exports = router;
