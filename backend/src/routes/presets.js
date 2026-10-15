const express = require('express');
const router = express.Router();
const presetController = require('../controllers/presetController');

router.get('/', presetController.list);
router.post('/', presetController.create);
router.delete('/:id', presetController.remove);

module.exports = router;
