const express        = require('express');
const router         = express.Router();
const auth           = require('../controllers/auth.controller');
const { authenticate } = require('../middleware/auth');

// Public routes
router.post('/login',               auth.login);
router.post('/request-change-code', auth.requestChangeCode);

// Protected routes
router.post('/logout',              authenticate, auth.logout);
router.get('/me',                   authenticate, auth.getMe);
router.put('/change-password',      authenticate, auth.changePasswordWithCode);
router.put('/change-username',      authenticate, auth.changeUsernameWithCode);

module.exports = router;