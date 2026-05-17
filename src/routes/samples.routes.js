// ============================================================
// FILE: backend/src/routes/samples.routes.js
// COMPLETE REWRITE
// ============================================================

'use strict';

const express          = require('express');
const router           = express.Router();
const sc               = require('../controllers/samples.controller');
const { authenticate } = require('../middleware/auth');

router.use(authenticate);

// NOTE: /bulk MUST come before /:id
// otherwise Express matches /bulk as an id param
router.post('/',             sc.registerSample);
router.post('/bulk',         sc.registerBulkSamples);
router.post('/assign-tests', sc.assignTests);
router.get('/',              sc.getSamples);
router.get('/:id',           sc.getSampleById);
router.put('/:id',                        sc.updateSample);
router.put('/:id/void',                   sc.voidSample);
router.delete('/assignment/:assignmentId', sc.removeTestAssignment);

module.exports = router;