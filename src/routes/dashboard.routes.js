const express          = require('express');
const router           = express.Router();
const dc               = require('../controllers/dashboard.controller');
const { authenticate } = require('../middleware/auth');

router.use(authenticate);

router.get('/live-results',        dc.getLiveResults);
router.get('/stats',               dc.getStats);
router.get('/notifications',       dc.getNotifications);
router.put('/notifications/read',  dc.markNotificationsRead);

module.exports = router;