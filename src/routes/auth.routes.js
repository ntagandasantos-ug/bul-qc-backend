const express        = require('express');
const router         = express.Router();
const authController = require('../controllers/auth.controller');
const { authenticate } = require('../middleware/auth');

router.post('/login',           authController.login);
router.post('/logout',          authenticate, authController.logout);
router.get('/me',               authenticate, authController.getMe);
router.put('/change-password',  authenticate, authController.changePassword);
router.put('/change-username',  authenticate, authController.changeUsername);

module.exports = router;