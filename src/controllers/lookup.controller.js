// ============================================================
// FILE 3: backend/src/controllers/lookup.controller.js
// Complete replacement — fixes empty dropdowns
// ============================================================

const supabase = require('../config/supabase');

// ── Departments ───────────────────────────────────────────
exports.getDepartments = async (_req, res) => {
  try {
    const { data, error } = await supabase
      .from('departments')
      .select('*')
      .order('name');
    if (error) return res.status(400).json({ error: error.message });
    res.json({ departments: data || [] });
  } catch (e) {
    res.status(500).json({ error: 'Failed to load departments' });
  }
};

// ── Sample categories for a department ───────────────────
exports.getSampleCategories = async (req, res) => {
  try {
    const { department_id } = req.params;
    const { data, error } = await supabase
      .from('sample_categories')
      .select('*')
      .eq('department_id', department_id)
      .order('name');
    if (error) return res.status(400).json({ error: error.message });
    res.json({ categories: data || [] });
  } catch (e) {
    res.status(500).json({ error: 'Failed to load categories' });
  }
};

// ── Sample types for a category ───────────────────────────
exports.getSampleTypes = async (req, res) => {
  try {
    const { category_id } = req.params;
    const { data, error } = await supabase
      .from('sample_types')
      .select('*')
      .eq('category_id', category_id)
      .order('name');
    if (error) return res.status(400).json({ error: error.message });
    res.json({ sampleTypes: data || [] });
  } catch (e) {
    res.status(500).json({ error: 'Failed to load sample types' });
  }
};

// ── Subtypes for a category ───────────────────────────────
exports.getSubtypes = async (req, res) => {
  try {
    const { category_id } = req.params;
    const { data, error } = await supabase
      .from('sample_subtypes')
      .select('*')
      .eq('category_id', category_id);
    if (error) return res.status(400).json({ error: error.message });
    res.json({ subtypes: data || [] });
  } catch (e) {
    res.status(500).json({ error: 'Failed to load subtypes' });
  }
};

// ── Brands for a department ───────────────────────────────
exports.getBrands = async (req, res) => {
  try {
    const { department_id } = req.params;
    const { data, error } = await supabase
      .from('brands')
      .select('*')
      .eq('department_id', department_id)
      .order('name');
    if (error) return res.status(400).json({ error: error.message });
    res.json({ brands: data || [] });
  } catch (e) {
    res.status(500).json({ error: 'Failed to load brands' });
  }
};

// ── Tests for a sample type (with specs) ──────────────────
exports.getTests = async (req, res) => {
  try {
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

    const testsWithSpec = (tests || []).map(test => {
      const specs = test.test_specifications || [];
      const spec =
        specs.find(s => s.brand_id === brand_id   && s.subtype_id === subtype_id)  ||
        specs.find(s => s.brand_id === brand_id   && !s.subtype_id)                ||
        specs.find(s => !s.brand_id               && s.subtype_id === subtype_id)  ||
        specs.find(s => !s.brand_id               && !s.subtype_id)                ||
        null;
      return { ...test, specification: spec };
    });

    res.json({ tests: testsWithSpec });
  } catch (e) {
    res.status(500).json({ error: 'Failed to load tests' });
  }
};

// ── Sample name presets ───────────────────────────────────
exports.getSampleNamePresets = async (req, res) => {
  try {
    const { department_id } = req.params;

    if (!department_id) {
      return res.status(400).json({ error: 'department_id required' });
    }

    const { data, error } = await supabase
      .from('sample_name_presets')
      .select('id, name')
      .eq('department_id', department_id)
      .eq('is_active', true)
      .order('name', { ascending: true });

    if (error) {
      console.error('getSampleNamePresets error:', error.message);
      return res.status(400).json({ error: error.message });
    }

    console.log(`Sample presets for dept ${department_id}:`, data?.length ?? 0);
    res.json({ presets: data || [] });
  } catch (err) {
    console.error('getSampleNamePresets crash:', err.message);
    res.status(500).json({ error: 'Failed to load sample name presets' });
  }
};

// ── Add new sample name preset ────────────────────────────
exports.addSampleNamePreset = async (req, res) => {
  try {
    const { department_id, name } = req.body;

    if (!name?.trim()) {
      return res.status(400).json({ error: 'Sample name is required' });
    }
    if (!department_id) {
      return res.status(400).json({ error: 'Department is required' });
    }

    const { data, error } = await supabase
      .from('sample_name_presets')
      .insert({
        department_id,
        name      : name.trim(),
        created_by: req.user.id,
        is_active : true,
      })
      .select('id, name')
      .single();

    if (error) {
      // Duplicate — return existing
      if (error.code === '23505') {
        const { data: existing } = await supabase
          .from('sample_name_presets')
          .select('id, name')
          .eq('department_id', department_id)
          .eq('name', name.trim())
          .single();
        return res.status(200).json({ preset: existing });
      }
      return res.status(400).json({ error: error.message });
    }

    res.status(201).json({ preset: data });
  } catch (err) {
    console.error('addSampleNamePreset crash:', err.message);
    res.status(500).json({ error: 'Failed to add sample name' });
  }
};

// ── Get lab staff (analysts and samplers) ─────────────────
exports.getLabStaff = async (req, res) => {
  try {
    const { role } = req.query;

    let query = supabase
      .from('lab_staff')
      .select('id, full_name, role')
      .eq('is_active', true)
      .order('full_name', { ascending: true });

    if (role && role !== 'All') {
      query = query.or(`role.eq.${role},role.eq.Both`);
    }

    const { data, error } = await query;

    if (error) {
      console.error('getLabStaff error:', error.message);
      return res.status(400).json({ error: error.message });
    }

    console.log('Lab staff loaded:', data?.length ?? 0);
    res.json({ staff: data || [] });
  } catch (err) {
    console.error('getLabStaff crash:', err.message);
    res.status(500).json({ error: 'Failed to load staff list' });
  }
};

// ── Add new lab staff member ──────────────────────────────
exports.addLabStaff = async (req, res) => {
  try {
    const { full_name, role } = req.body;

    if (!full_name?.trim()) {
      return res.status(400).json({ error: 'Full name is required' });
    }

    const staffRole = role || 'Both';

    const { data, error } = await supabase
      .from('lab_staff')
      .insert({
        full_name : full_name.trim(),
        role      : staffRole,
        is_active : true,
      })
      .select('id, full_name, role')
      .single();

    if (error) {
      if (error.code === '23505') {
        const { data: existing } = await supabase
          .from('lab_staff')
          .select('id, full_name, role')
          .eq('full_name', full_name.trim())
          .single();
        return res.status(200).json({ staff: existing });
      }
      return res.status(400).json({ error: error.message });
    }

    res.status(201).json({ staff: data });
  } catch (err) {
    console.error('addLabStaff crash:', err.message);
    res.status(500).json({ error: 'Failed to add staff member' });
  }
};