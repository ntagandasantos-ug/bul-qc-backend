// ============================================================
// FILE: backend/src/controllers/samples.controller.js
// FIXES: duplicate sample number, bulk registration
// ============================================================

'use strict';

const supabase = require('../config/supabase');

// ── Helper: generate unique sample number ─────────────────
// Uses MAX existing number + 1 to avoid duplicates
async function generateSampleNumber(departmentId) {
  const { data: dept } = await supabase
    .from('departments')
    .select('code')
    .eq('id', departmentId)
    .single();

  const year   = new Date().getFullYear();
  const code   = dept?.code || 'BUL';
  const prefix = `${code}-${year}-`;

  // Find the highest existing sample number for this dept+year
  const { data: existing } = await supabase
    .from('registered_samples')
    .select('sample_number')
    .eq('department_id', departmentId)
    .like('sample_number', `${prefix}%`)
    .order('sample_number', { ascending: false })
    .limit(1);

  let nextNum = 1;
  if (existing && existing.length > 0) {
    const lastNum = existing[0].sample_number.replace(prefix, '');
    const parsed  = parseInt(lastNum, 10);
    if (!isNaN(parsed)) nextNum = parsed + 1;
  }

  return `${prefix}${String(nextNum).padStart(4, '0')}`;
}

// ── 1. REGISTER SINGLE SAMPLE ────────────────────────────
exports.registerSample = async function(req, res) {
  try {
    const {
      sample_name, department_id, sample_type_id,
      brand_id, subtype_id, batch_number,
      notes, sampler_name,
    } = req.body;

    if (!sample_name)    return res.status(400).json({ error: 'Sample name is required' });
    if (!department_id)  return res.status(400).json({ error: 'Department is required' });
    if (!sample_type_id) return res.status(400).json({ error: 'Sample type is required' });

    const sampleNumber = await generateSampleNumber(department_id);

    const { data: newSample, error } = await supabase
      .from('registered_samples')
      .insert({
        sample_number  : sampleNumber,
        sample_name    : sample_name.trim(),
        department_id,
        sample_type_id,
        brand_id       : brand_id     || null,
        subtype_id     : subtype_id   || null,
        batch_number   : batch_number || null,
        notes          : notes        || null,
        sampler_name   : sampler_name || null,
        registered_by  : req.user.id,
        status         : 'pending',
        registered_at  : new Date().toISOString(),
      })
      .select('id, sample_number, sample_name, status')
      .single();

    if (error) {
      console.error('registerSample error:', error.message);
      return res.status(400).json({ error: error.message });
    }

    return res.status(201).json({
      message      : `Sample ${sampleNumber} registered successfully`,
      sampleNumber,
      sample       : newSample,
    });
  } catch (err) {
    console.error('registerSample crash:', err.message);
    return res.status(500).json({ error: 'Failed to register sample' });
  }
};

// ── 2. BULK REGISTER SAMPLES ─────────────────────────────
// Each sample gets a fresh number sequentially
exports.registerBulkSamples = async function(req, res) {
  try {
    const { samples } = req.body;

    if (!Array.isArray(samples) || samples.length === 0) {
      return res.status(400).json({ error: 'No samples provided' });
    }
    if (samples.length > 20) {
      return res.status(400).json({ error: 'Maximum 20 samples per request' });
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

        // Fresh number each iteration avoids duplicates
        const sampleNum = await generateSampleNumber(s.department_id);

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

// ── 3. GET SAMPLES LIST ───────────────────────────────────
exports.getSamples = async function(req, res) {
  try {
    const {
      department_id, status,
      date, fromDate, toDate,
      limit = 200,
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
        sample_subtypes ( name )
      `)
      .order('registered_at', { ascending: false })
      .limit(parseInt(limit));

    if (department_id) q = q.eq('department_id', department_id);
    if (status)        q = q.eq('status', status);

    if (fromDate && toDate) {
  // Add 3-hour offset for EAT (UTC+3)
  const start = new Date(fromDate + 'T00:00:00+03:00');
  const end   = new Date(toDate   + 'T23:59:59+03:00');
  q = q.gte('registered_at', start.toISOString())
       .lte('registered_at', end.toISOString());
} else if (date) {
  // Add 3-hour offset for EAT (UTC+3)
  const start = new Date(date + 'T00:00:00+03:00');
  const end   = new Date(date + 'T23:59:59+03:00');
  q = q.gte('registered_at', start.toISOString())
       .lte('registered_at', end.toISOString());
}

    const { data, error } = await q;
    if (error) {
      console.error('getSamples error:', error.message);
      return res.status(400).json({ error: error.message });
    }

    return res.json({ samples: data || [] });
  } catch (err) {
    console.error('getSamples crash:', err.message);
    return res.status(500).json({ error: 'Failed to get samples' });
  }
};

// ── 4. GET SINGLE SAMPLE BY ID ────────────────────────────
exports.getSampleById = async function(req, res) {
  try {
    const { id } = req.params;

    const { data, error } = await supabase
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

    if (error) {
      console.error('getSampleById error:', error.message);
      return res.status(404).json({ error: 'Sample not found' });
    }

    return res.json({ sample: data });
  } catch (err) {
    console.error('getSampleById crash:', err.message);
    return res.status(500).json({ error: 'Failed to load sample' });
  }
};

// ── 5. ASSIGN TESTS TO SAMPLE ────────────────────────────
exports.assignTests = async function(req, res) {
  try {
    const { sample_id, test_ids } = req.body;

    if (!sample_id || !Array.isArray(test_ids) || test_ids.length === 0) {
      return res.status(400).json({ error: 'sample_id and test_ids are required' });
    }

    await supabase
      .from('sample_test_assignments')
      .delete()
      .eq('sample_id', sample_id)
      .is('result_value', null);

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

    if (error) {
      console.error('assignTests error:', error.message);
      return res.status(400).json({ error: error.message });
    }

    await supabase
      .from('registered_samples')
      .update({ status: 'in_progress' })
      .eq('id', sample_id)
      .eq('status', 'pending');

    return res.json({
      message    : `${data.length} test(s) assigned successfully`,
      assignments: data,
    });
  } catch (err) {
    console.error('assignTests crash:', err.message);
    return res.status(500).json({ error: 'Failed to assign tests' });
  }
};