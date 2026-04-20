const supabase = require('../config/supabase');

// ── REGISTER A NEW SAMPLE ──────────────────────────────────
exports.registerSample = async (req, res) => {
  try {
    const {
      sample_name,
      department_id,
      sample_type_id,
      brand_id,
      subtype_id,
      batch_number,
      notes,
    } = req.body;

    if (!sample_name || !department_id || !sample_type_id) {
      return res.status(400).json({
        error: 'Sample name, department, and sample type are required',
      });
    }

    // Get department code for the sample number
    const { data: dept } = await supabase
      .from('departments')
      .select('code')
      .eq('id', department_id)
      .single();

    // Auto-generate sample number
    const { data: sampleNumber } = await supabase
      .rpc('generate_sample_number', { dept_code: dept.code });

    // Get the current shift
    const token = req.headers.authorization?.split(' ')[1];
    const { data: session } = await supabase
      .from('active_sessions')
      .select('shift_id')
      .eq('session_token', token)
      .single();

    // Insert the sample
    const { data: sample, error } = await supabase
      .from('registered_samples')
      .insert({
        sample_number  : sampleNumber,
        sample_name    : sample_name.trim(),
        department_id,
        sample_type_id,
        brand_id       : brand_id   || null,
        subtype_id     : subtype_id || null,
        registered_by  : req.user.id,
        shift_id       : session?.shift_id || null,
        batch_number   : batch_number || null,
        notes          : notes || null, 
        sampler_name   : req.body.sampler_name || null,
        status         : 'pending',
      })
      .select(`
        *,
        departments      ( name, code ),
        sample_types     ( name, code, sample_categories ( name ) ),
        brands           ( name ),
        sample_subtypes  ( name ),
        app_users!registered_by ( full_name )
      `)
      .single();

    if (error) {
      console.error('Registration error:', error);
      return res.status(400).json({ error: 'Failed to register sample: ' + error.message });
    }

    res.status(201).json({
      message      : `Sample ${sampleNumber} registered successfully`,
      sample,
      sampleNumber,
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error while registering sample' });
  }
};

// ── GET ALL SAMPLES (with filters) ────────────────────────
exports.getSamples = async (req, res) => {
  try {
    const {
      department_id,
      status,
      date,
      limit  = 100,
      offset = 0,
    } = req.query;

    let query = supabase
      .from('registered_samples')
      .select(`
        *,
        departments      ( name, code ),
        sample_types     ( name, code, sample_categories ( name ) ),
        brands           ( name ),
        sample_subtypes  ( name ),
        app_users!registered_by ( full_name )
      `)
      .order('registered_at', { ascending: false })
      .range(Number(offset), Number(offset) + Number(limit) - 1);

    // Department heads can only see their own department
    const roleName = req.userRole?.name;
    if (roleName === 'Department Head' || roleName === 'Department Assistant') {
      query = query.eq('department_id', req.user.department_id);
    } else if (department_id) {
      query = query.eq('department_id', department_id);
    }

    if (status) query = query.eq('status', status);

    if (date) {
      const start = new Date(date); start.setHours(0, 0, 0, 0);
      const end   = new Date(date); end.setHours(23, 59, 59, 999);
      query = query
        .gte('registered_at', start.toISOString())
        .lte('registered_at', end.toISOString());
    }

    const { data: samples, error, count } = await query;

    if (error) return res.status(400).json({ error: error.message });

    res.json({ samples: samples || [], total: count });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch samples' });
  }
};

// ── GET A SINGLE SAMPLE WITH ITS ASSIGNED TESTS ────────────
exports.getSampleById = async (req, res) => {
  try {
    const { id } = req.params;

    const { data: sample, error } = await supabase
      .from('registered_samples')
      .select(`
        *,
        departments      ( name, code ),
        sample_types     ( name, code, sample_categories ( name ) ),
        brands           ( name, code ),
        sample_subtypes  ( name, code ),
        app_users!registered_by ( full_name ),
        sample_test_assignments (
          id, result_value, result_numeric, result_status,
          remarks, action, analyst_signature, submitted_at,
          edit_count, is_locked,
          tests ( id, name, code, unit, result_type, display_order )
        )
      `)
      .eq('id', id)
      .single();

    if (error || !sample) {
      return res.status(404).json({ error: 'Sample not found' });
    }

    res.json({ sample });

  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch sample' });
  }
};

// ── ASSIGN TESTS TO A SAMPLE ───────────────────────────────
exports.assignTests = async (req, res) => {
  try {
    const { sample_id, test_ids } = req.body;

    if (!sample_id || !test_ids || test_ids.length === 0) {
      return res.status(400).json({ error: 'sample_id and test_ids are required' });
    }

    // Check sample exists and is not locked
    const { data: sample } = await supabase
      .from('registered_samples')
      .select('id, is_locked, status')
      .eq('id', sample_id)
      .single();

    if (!sample) return res.status(404).json({ error: 'Sample not found' });
    if (sample.is_locked) return res.status(403).json({ error: 'Sample is locked' });

    const assignments = test_ids.map(test_id => ({
      sample_id,
      test_id,
      assigned_by : req.user.id,
      assigned_at : new Date().toISOString(),
    }));

    const { data, error } = await supabase
      .from('sample_test_assignments')
      .upsert(assignments, { onConflict: 'sample_id,test_id', ignoreDuplicates: true })
      .select();

    if (error) return res.status(400).json({ error: error.message });

    res.json({
      message     : `${test_ids.length} test(s) assigned to sample`,
      assignments : data,
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to assign tests' });
  }
};