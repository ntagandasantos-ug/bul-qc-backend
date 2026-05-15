// ============================================================
// FILE: backend/src/routes/inventory.routes.js
// ============================================================

'use strict';

const express          = require('express');
const router           = express.Router();
const ic               = require('../controllers/inventory.controller');
const { authenticate } = require('../middleware/auth');

// Public weekly check (called by cron or scheduler)
router.get('/reorder-check', ic.weeklyReorderCheck);

// All other routes require auth
router.use(authenticate);

router.get ('   /items',          ic.getItems);
router.post('/items',          ic.addItem);
router.post('/stock-update',   ic.updateStock);
router.post('/in-use-update',  ic.updateInUse);
router.post('/breakage',       ic.recordBreakage);
router.post('/requisition',    ic.createRequisition);
router.get ('/transactions',   ic.getTransactions);
router.get ('/breakages',      ic.getBreakages);
router.get ('/requisitions',   ic.getRequisitions);

module.exports = router;
