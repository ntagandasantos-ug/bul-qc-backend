const supabase = require('../config/supabase');

// Get all departments
exports.getDepartments = async (_req, res) => {
  const { data, error } = await supabase.from('departments').select('*').order('name');
  if (error) return res.status(400).json({ error: error.message });
  res.json({ departments: data });
};

// Get sample categories for a department
exports.getSampleCategories = async (req, res) => {
  const { department_id } = req.params;
  const { data, error } = await supabase
    .from('sample_categories')
    .select('*')
    .eq('department_id', department_id)
    .order('name');
  if (error) return res.status(400).json({ error: error.message });
  res.json({ categories: data });
};

// Get sample types for a category
exports.getSampleTypes = async (req, res) => {
  const { category_id } = req.params;
  const { data, error } = await supabase
    .from('sample_types')
    .select('*')
    .eq('category_id', category_id)
    .order('name');
  if (error) return res.status(400).json({ error: error.message });
  res.json({ sampleTypes: data });
};

// Get subtypes for a category
exports.getSubtypes = async (req, res) => {
  const { category_id } = req.params;
  const { data, error } = await supabase
    .from('sample_subtypes')
    .select('*')
    .eq('category_id', category_id);
  if (error) return res.status(400).json({ error: error.message });
  res.json({ subtypes: data });
};

// Get brands for a department
exports.getBrands = async (req, res) => {
  const { department_id } = req.params;
  const { data, error } = await supabase
    .from('brands')
    .select('*')
    .eq('department_id', department_id)
    .order('name');
  if (error) return res.status(400).json({ error: error.message });
  res.json({ brands: data });
};

// Get tests for a sample type (with specifications)
exports.getTests = async (req, res) => {
  const { sample_type_id } = req.params;
  const { brand_id, subtype_id } = req.query;

  const { data: tests, error } = await supabase
    .from('tests')
    .select(`
      *,
      test_specifications (
        min_value, max_value, display_spec,
        brand_id, subtype_id, text_acceptable_values
      )
    `)
    .eq('sample_type_id', sample_type_id)
    .order('display_order');

  if (error) return res.status(400).json({ error: error.message });

  // Attach the best matching spec to each test
  const testsWithSpec = tests.map(test => {
    const specs = test.test_specifications || [];
    const spec =
      specs.find(s => s.brand_id === brand_id   && s.subtype_id === subtype_id) ||
      specs.find(s => s.brand_id === brand_id   && !s.subtype_id)               ||
      specs.find(s => !s.brand_id               && s.subtype_id === subtype_id) ||
      specs.find(s => !s.brand_id               && !s.subtype_id)               ||
      null;

    return { ...test, specification: spec };
  });

  res.json({ tests: testsWithSpec });
};