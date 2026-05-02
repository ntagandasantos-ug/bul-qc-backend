// ============================================================
// FILE: backend/src/controllers/samples.controller.js
// COMPLETE CLEAN FILE — replace everything
// ============================================================

const supabase = require('../config/supabase');

// ── REGISTER SINGLE SAMPLE ───────────────────────────────
exports.registerSample = async (req, res) => {
  try {
    const {
      sample_name, department_id, sample_type_id,
      brand_id, subtype_id, batch_number,
      notes, sampler_name,
    } = req.body;

    if (!sample_name)    return res.status(400).json({ error: 'Sample name required' });
    if (!department_id)  return res.status(400).json({ error: 'Department required' });
    if (!sample_type_id) return res.status(400).json({ error: 'Sample type required' });

    // Get department code
    const { data: dept } = await supabase
      .from('departments')
      .select('code')
      .eq('id', department_id)
      .single();

    const year = new Date().getFullYear();
    const code = dept?.code || 'BUL';

    const { count } = await supabase
      .from('registered_samples')
      .select('id', { count: 'exact', head: true })
      .eq('department_id', department_id);

    const num       = String((count || 0) + 1).padStart(4, '0');
    const sampleNum = `${code}-${year}-${num}`;

    const { data: newSample, error } = await supabase
      .from('registered_samples')
      .insert({
        sample_number  : sampleNum,
        sample_name    : sample_name.trim(),
        department_id,
        sample_type_id,
        brand_id       : brand_id    || null,
        subtype_id     : subtype_id  || null,
        batch_number   : batch_number || null,
        notes          : notes        || null,
        sampler_name   : sampler_name || null,
        registered_by  : req.user.id,
        status         : 'pending',
        registered_at  : new Date().toISOString(),
      })
      .select(`
        id, sample_number, sample_name, status, registered_at,
        sample_types ( name ),
        departments ( name )
      `)
      .single();

    if (error) {
      console.error('registerSample error:', error.message);
      return res.status(400).json({ error: error.message });
    }

    return res.status(201).json({
      message      : `Sample ${sampleNum} registered successfully`,
      sampleNumber : sampleNum,
      sample       : newSample,
    });
  } catch (err) {
    console.error('registerSample crash:', err.message);
    return res.status(500).json({ error: 'Failed to register sample' });
  }
};

// ── BULK REGISTER SAMPLES ─────────────────────────────────
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

        // Get department code
        const { data: dept } = await supabase
          .from('departments')
          .select('code')
          .eq('id', s.department_id)
          .single();

        const year = new Date().getFullYear();
        const code = dept?.code || 'BUL';

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
            brand_id       : s.brand_id     || null,
            subtype_id     : s.subtype_id   || null,
            batch_number   : s.batch_number || null,
            notes          : s.notes        || null,
            sampler_name   : s.sampler_name.trim(),
            registered_by  : req.user.id,
            status         : 'pending',
            registered_at  : new Date().toISOString(),
          })
          .select('id, sample_number, sample_name')
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
          sample_name: s.sample_name || `Sample ${i + 1}`,
          error      : err.message,
          status     : 'failed',
        });
      }
    }

    return res.status(201).json({
      message    : `${registered.length} sample(s) registered`,
      registered,
      errors,
      total      : samples.length,
      successful : registered.length,
      failed     : errors.length,
    });

  } catch (err) {
    console.error('registerBulkSamples crash:', err.message);
    return res.status(500).json({ error: 'Bulk registration failed' });
  }
};

// ── GET SAMPLES LIST ─────────────────────────────────────
exports.getSamples = async (req, res) => {
  try {
    const {
      department_id, status,
      date, fromDate, toDate,
      limit = 100,
    } = req.query;

    let q = supabase
      .from('registered_samples')
      .select(`
        id, sample_number, sample_name, status,
        registered_at, batch_number, notes, sampler_name,
        department_id,
        departments ( name, code ),
        sample_types (
          id, name, code,
          sample_categories ( name, code )
        ),
        brands ( name ),
        sample_subtypes ( name ),
        app_users!registered_by ( full_name )
      `)
      .order('registered_at', { ascending: false })
      .limit(parseInt(limit));

    if (department_id) q = q.eq('department_id', department_id);
    if (status)        q = q.eq('status', status);

    if (fromDate && toDate) {
      const start = new Date(fromDate); start.setHours(0,0,0,0);
      const end   = new Date(toDate);   end.setHours(23,59,59,999);
      q = q.gte('registered_at', start.toISOString())
           .lte('registered_at', end.toISOString());
    } else if (date) {
      const start = new Date(date); start.setHours(0,0,0,0);
      const end   = new Date(date); end.setHours(23,59,59,999);
      q = q.gte('registered_at', start.toISOString())
           .lte('registered_at', end.toISOString());
    }

    const { data, error } = await q;
    if (error) return res.status(400).json({ error: error.message });

    return res.json({ samples: data || [] });
  } catch (err) {
    console.error('getSamples crash:', err.message);
    return res.status(500).json({ error: 'Failed to get samples' });
  }
};

// ── GET SINGLE SAMPLE ────────────────────────────────────
exports.getSampleById = async (req, res) => {
  try {
    const { id } = req.params;

    const { data, error } = await supabase
      .from('registered_samples')
      .select(`
        id, sample_number, sample_name, status,
        registered_at, batch_number, notes, sampler_name,
        departments ( name, code ),
        sample_types (
          id, name, code,
          sample_categories ( name, code )
        ),
        brands ( name ),
        sample_subtypes ( name ),
        app_users!registered_by ( full_name ),
        sample_test_assignments (
          id, result_value, result_numeric,
          result_status, remarks, action,
          analyst_signature, submitted_at,
          edit_count, is_locked,
          tests (
            id, name, unit, result_type, display_order,
            test_specifications (
              min_value, max_value, display_spec
            )
          )
        )
      `)
      .eq('id', id)
      .single();

    if (error) return res.status(404).json({ error: 'Sample not found' });
    return res.json({ sample: data });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to get sample' });
  }
};

// ── ASSIGN TESTS TO SAMPLE ───────────────────────────────
exports.assignTests = async (req, res) => {
  try {
    const { sample_id, test_ids } = req.body;

    if (!sample_id || !Array.isArray(test_ids) || test_ids.length === 0) {
      return res.status(400).json({ error: 'sample_id and test_ids required' });
    }

    // Remove existing assignments first
    await supabase
      .from('sample_test_assignments')
      .delete()
      .eq('sample_id', sample_id)
      .is('result_value', null);

    // Insert new assignments
    const inserts = test_ids.map(testId => ({
      sample_id,
      test_id    : testId,
      assigned_by: req.user.id,
      assigned_at: new Date().toISOString(),
    }));

    const { data, error } = await supabase
      .from('sample_test_assignments')
      .insert(inserts)
      .select();

    if (error) return res.status(400).json({ error: error.message });

    // Update sample status to in_progress
    await supabase
      .from('registered_samples')
      .update({ status: 'in_progress' })
      .eq('id', sample_id)
      .eq('status', 'pending');

    return res.json({
      message    : `${data.length} test(s) assigned`,
      assignments: data,
    });
  } catch (err) {
    console.error('assignTests crash:', err.message);
    return res.status(500).json({ error: 'Failed to assign tests' });
  }
};
