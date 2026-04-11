const express           = require('express');
const router            = express.Router();
const samplesController = require('../controllers/samples.controller');
const { authenticate }  = require('../middleware/auth');

router.use(authenticate); // All sample routes require login

router.post('/',                  samplesController.registerSample);
router.get('/',                   samplesController.getSamples);
router.get('/:id',                samplesController.getSampleById);
router.post('/assign-tests',      samplesController.assignTests);

module.exports = router;