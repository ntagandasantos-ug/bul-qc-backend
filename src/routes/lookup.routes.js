const express  = require('express');
const router   = express.Router();
const lc       = require('../controllers/lookup.controller');
const { authenticate } = require('../middleware/auth');

router.use(authenticate);

router.get('/departments',                      lc.getDepartments);
router.get('/categories/:department_id',        lc.getSampleCategories);
router.get('/sample-types/:category_id',        lc.getSampleTypes);
router.get('/subtypes/:category_id',            lc.getSubtypes);
router.get('/brands/:department_id',            lc.getBrands);
router.get('/tests/:sample_type_id',            lc.getTests);
router.get('/sample-names/:department_id',      lc.getSampleNamePresets);
router.post('/sample-names',                    lc.addSampleNamePreset);
router.get('/staff',                            lc.getLabStaff);
router.post('/staff',                           lc.addLabStaff);

module.exports = router;