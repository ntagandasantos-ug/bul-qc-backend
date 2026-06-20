'use strict';

const express          = require('express');
const router           = express.Router();
const ic               = require('../controllers/inventory.controller');
const { authenticate } = require('../middleware/auth');

router.get('/reorder-check', ic.weeklyReorderCheck);

router.use(authenticate);

router.get('/categories',     ic.getCategories);
router.get('/items',          ic.getItems);
router.post('/items',         ic.addItem);
router.put('/items/:id',      ic.updateItem);
router.post('/stock-update',  ic.updateStock);
router.post('/in-use-update', ic.updateInUse);
router.post('/breakage',      ic.recordBreakage);
router.get('/breakages',      ic.getBreakages);
router.post('/requisition',   ic.createRequisition);
router.get('/requisitions',   ic.getRequisitions);
router.post('/transfer',      ic.createTransfer);
router.get('/transfers',      ic.getTransfers);
router.post('/usage',         ic.recordUsage);
router.get('/transactions',   ic.getTransactions);
router.get('/low-stock',      ic.getLowStockItems);

module.exports = router;