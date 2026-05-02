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
      department_id, status,
      date, fromDate, toDate,
      limit = 100, offset = 0
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

    if (fromDate && toDate) {
      // Date range filter
      const start = new Date(fromDate); start.setHours(0, 0, 0, 0);
      const end   = new Date(toDate);   end.setHours(23, 59, 59, 999);
      query = query
        .gte('registered_at', start.toISOString())
        .lte('registered_at', end.toISOString());
    } else if (date) {
      // Single date filter
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

// ============================================================
// ADD TO: backend/src/controllers/samples.controller.js
//
// Add this function at the BOTTOM of the file
// Then add the route in samples.routes.js
// ============================================================

// ── BULK REGISTER SAMPLES ─────────────────────────────────
// Allows registering multiple samples in one request
// Each sample in the array is independent
exports.registerBulkSamples = async (req, res) => {
  try {
    const { samples } = req.body;

    if (!Array.isArray(samples) || samples.length === 0) {
      return res.status(400).json({ error: 'No samples provided' });
    }

    if (samples.length > 20) {
      return res.status(400).json({ error: 'Maximum 20 samples per bulk registration' });
    }

    const registered = [];
    const errors     = [];

    for (let i = 0; i < samples.length; i++) {
      const s = samples[i];
      try {
        if (!s.sample_name)    throw new Error('Sample name required');
        if (!s.department_id)  throw new Error('Department required');
        if (!s.sample_type_id) throw new Error('Sample type required');
        if (!s.sampler_name)   throw new Error('Sampler name required');

        // Generate sample number
        const dept = await supabase
          .from('departments')
          .select('code')
          .eq('id', s.department_id)
          .single();

        const year  = new Date().getFullYear();
        const code  = dept.data?.code || 'BUL';
        const { count } = await supabase
          .from('registered_samples')
          .select('id', { count: 'exact', head: true })
          .eq('department_id', s.department_id);

        const num       = String((count || 0) + 1 + i).padStart(4, '0');
        const sampleNum = `${code}-${year}-${num}`;

        const { data: newSample, error: insertErr } = await supabase
          .from('registered_samples')
          .insert({
            sample_number  : sampleNum,
            sample_name    : s.sample_name.trim(),
            department_id  : s.department_id,
            sample_type_id : s.sample_type_id,
            brand_id       : s.brand_id       || null,
            subtype_id     : s.subtype_id     || null,
            batch_number   : s.batch_number   || null,
            notes          : s.notes          || null,
            sampler_name   : s.sampler_name.trim(),
            registered_by  : req.user.id,
            status         : 'pending',
            registered_at  : new Date().toISOString(),
          })
          .select(`
            id, sample_number, sample_name, status,
            registered_at, sampler_name,
            sample_types ( name ),
            departments ( name )
          `)
          .single();

        if (insertErr) throw new Error(insertErr.message);

        registered.push({
          index       : i,
          sample_name : s.sample_name,
          sampleNumber: sampleNum,
          id          : newSample.id,
          status      : 'success',
        });

      } catch (err) {
        errors.push({
          index      : i,
          sample_name: s.sample_name || `Sample ${i+1}`,
          error      : err.message,
          status     : 'failed',
        });
      }
    }

    return res.status(201).json({
      message    : `${registered.length} sample(s) registered successfully`,
      registered,
      errors,
      total      : samples.length,
      successful : registered.length,
      failed     : errors.length,
    });

  } catch (err) {
    console.error('registerBulkSamples error:', err.message);
    return res.status(500).json({ error: 'Bulk registration failed' });
  }
};


// ============================================================
// ADD TO: backend/src/routes/samples.routes.js
//
// Find the existing routes and add this new one:
// router.post('/bulk', authenticate, sc.registerBulkSamples);
//
// The full routes file should include:
// router.post('/',     authenticate, sc.registerSample);
// router.post('/bulk', authenticate, sc.registerBulkSamples);
// router.get('/',      authenticate, sc.getSamples);
// router.get('/:id',   authenticate, sc.getSampleById);
// router.post('/assign-tests', authenticate, sc.assignTests);
// ============================================================
