const express = require('express');
const router = express.Router();
const credentialsController = require('../controllers/credentialsController');

router.get('/credentials', credentialsController.getAll);
router.put('/credentials/:platform', credentialsController.save);
router.delete('/credentials/:platform', credentialsController.remove);
router.post('/credentials/:platform/test', credentialsController.test);

module.exports = router;
