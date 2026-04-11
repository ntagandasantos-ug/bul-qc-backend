const express            = require('express');
const router             = express.Router();
const lookupController   = require('../controllers/lookup.controller');
const { authenticate }   = require('../middleware/auth');

router.use(authenticate);

router.get('/departments',                           lookupController.getDepartments);
router.get('/categories/:department_id',             lookupController.getSampleCategories);
router.get('/sample-types/:category_id',             lookupController.getSampleTypes);
router.get('/subtypes/:category_id',                 lookupController.getSubtypes);
router.get('/brands/:department_id',                 lookupController.getBrands);
router.get('/tests/:sample_type_id',                 lookupController.getTests);

module.exports = router;