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

// Get sample name presets for a department
exports.getSampleNamePresets = async (req, res) => {
  const { department_id } = req.params;
  const { data, error } = await supabase
    .from('sample_name_presets')
    .select('id, name')
    .eq('department_id', department_id)
    .eq('is_active', true)
    .order('name');
  if (error) return res.status(400).json({ error: error.message });
  res.json({ presets: data || [] });
};

// Add a new sample name preset
exports.addSampleNamePreset = async (req, res) => {
  const { department_id, name } = req.body;
  if (!name?.trim() || !department_id) {
    return res.status(400).json({ error: 'Name and department required' });
  }
  const { data, error } = await supabase
    .from('sample_name_presets')
    .insert({
      department_id,
      name        : name.trim(),
      created_by  : req.user.id,
    })
    .select('id, name')
    .single();
  if (error) return res.status(400).json({ error: error.message });
  res.status(201).json({ preset: data });
};

// Get all lab staff
exports.getLabStaff = async (req, res) => {
  const { role } = req.query; // 'Analyst', 'Sampler', or 'Both'
  let query = supabase
    .from('lab_staff')
    .select('id, full_name, role')
    .eq('is_active', true)
    .order('full_name');
  if (role) query = query.or(`role.eq.${role},role.eq.Both`);
  const { data, error } = await query;
  if (error) return res.status(400).json({ error: error.message });
  res.json({ staff: data || [] });
};

// Add a new staff member
exports.addLabStaff = async (req, res) => {
  const { full_name, role } = req.body;
  if (!full_name?.trim() || !role) {
    return res.status(400).json({ error: 'Name and role required' });
  }
  const { data, error } = await supabase
    .from('lab_staff')
    .insert({ full_name: full_name.trim(), role })
    .select()
    .single();
  if (error) return res.status(400).json({ error: error.message });
  res.status(201).json({ staff: data });
};