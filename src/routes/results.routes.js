// ============================================================
// FILE: backend/src/routes/results.routes.js
// ============================================================

'use strict';

const express          = require('express');
const router           = express.Router();
const rc               = require('../controllers/results.controller');
const { authenticate } = require('../middleware/auth');

router.use(authenticate);

router.put('/:id',              rc.submitResult);
router.get('/sample/:sampleId', rc.getResultsBySample);

module.exports = router;