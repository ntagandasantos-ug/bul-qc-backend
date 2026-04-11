const express               = require('express');
const router                = express.Router();
const dashboardController   = require('../controllers/dashboard.controller');
const { authenticate }      = require('../middleware/auth');

router.use(authenticate);

router.get('/live',                   dashboardController.getLiveResults);
router.get('/stats',                  dashboardController.getSummaryStats);
router.get('/notifications',          dashboardController.getNotifications);
router.put('/notifications/read',     dashboardController.markNotificationsRead);

module.exports = router;