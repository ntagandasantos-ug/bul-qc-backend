const express            = require('express');
const router             = express.Router();
const resultsController  = require('../controllers/results.controller');
const { authenticate }   = require('../middleware/auth');

router.use(authenticate);

router.post('/submit',                        resultsController.submitResult);
router.get('/sample/:sample_id',              resultsController.getResultsBySample);
router.get('/history/:assignment_id',         resultsController.getEditHistory);

module.exports = router;