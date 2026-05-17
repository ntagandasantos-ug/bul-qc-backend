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

// ============================================================
// ADD THESE FUNCTIONS to backend/src/controllers/samples.controller.js
// ============================================================

// ── UPDATE SAMPLE DETAILS (correct a wrong registration) ──
exports.updateSample = async function(req, res) {
  try {
    const { id } = req.params;
    const {
      sample_name,
      sample_type_id,
      brand_id,
      subtype_id,
      batch_number,
      notes,
      sampler_name,
      correction_reason,
    } = req.body;

    // Fetch current sample for audit
    const { data: current, error: fetchErr } = await supabase
      .from('registered_samples')
      .select('sample_name, sample_number, status')
      .eq('id', id)
      .single();

    if (fetchErr || !current) {
      return res.status(404).json({ error: 'Sample not found' });
    }

    // Build update payload
    const updates = {};
    if (sample_name)    updates.sample_name    = sample_name.trim();
    if (sample_type_id) updates.sample_type_id = sample_type_id;
    if (brand_id)       updates.brand_id       = brand_id;
    if (subtype_id)     updates.subtype_id     = subtype_id;
    if (batch_number !== undefined) updates.batch_number = batch_number;
    if (notes       !== undefined) updates.notes        = notes;
    if (sampler_name)   updates.sampler_name   = sampler_name;

    const { data: updated, error: updateErr } = await supabase
      .from('registered_samples')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (updateErr) {
      return res.status(400).json({ error: updateErr.message });
    }

    // Log to audit trail
    try {
      await supabase.from('sample_corrections').insert({
        sample_id        : id,
        sample_number    : current.sample_number,
        old_sample_name  : current.sample_name,
        new_sample_name  : sample_name || current.sample_name,
        correction_reason: correction_reason || 'No reason given',
        corrected_by     : req.user.id,
        corrected_by_name: req.user.full_name || req.user.username,
        corrected_at     : new Date().toISOString(),
      });
    } catch(e) {
      // Audit table may not exist yet — continue
      console.log('Audit log skipped:', e.message);
    }

    return res.json({
      message: 'Sample updated successfully',
      sample : updated,
    });

  } catch (err) {
    console.error('updateSample error:', err.message);
    return res.status(500).json({ error: 'Failed to update sample: ' + err.message });
  }
};

// ── VOID A SAMPLE (mark as cancelled) ────────────────────
exports.voidSample = async function(req, res) {
  try {
    const { id } = req.params;
    const { reason } = req.body;

    const { data, error } = await supabase
      .from('registered_samples')
      .update({ status: 'voided', notes: `VOIDED: ${reason || 'No reason given'}` })
      .eq('id', id)
      .select()
      .single();

    if (error) return res.status(400).json({ error: error.message });
    return res.json({ message: 'Sample voided', sample: data });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};

// ── REMOVE A TEST ASSIGNMENT (before result is submitted) ─
exports.removeTestAssignment = async function(req, res) {
  try {
    const { assignmentId } = req.params;

    // Check it hasn't been submitted yet
    const { data: existing } = await supabase
      .from('sample_test_assignments')
      .select('id, result_value, is_locked, sample_id')
      .eq('id', assignmentId)
      .single();

    if (!existing) {
      return res.status(404).json({ error: 'Test assignment not found' });
    }
    if (existing.result_value) {
      return res.status(400).json({
        error: 'Cannot remove a test that already has a result submitted. Lock the result instead.',
      });
    }
    if (existing.is_locked) {
      return res.status(400).json({ error: 'This test is locked and cannot be removed' });
    }

    const { error } = await supabase
      .from('sample_test_assignments')
      .delete()
      .eq('id', assignmentId);

    if (error) return res.status(400).json({ error: error.message });

    // Check if sample still has assignments
    const { data: remaining } = await supabase
      .from('sample_test_assignments')
      .select('id, result_value')
      .eq('sample_id', existing.sample_id);

    // If all remaining have results → mark complete
    if (remaining?.length > 0 && remaining.every(a => a.result_value)) {
      await supabase
        .from('registered_samples')
        .update({ status: 'complete' })
        .eq('id', existing.sample_id);
    }
    // If no assignments left → back to pending
    if (!remaining || remaining.length === 0) {
      await supabase
        .from('registered_samples')
        .update({ status: 'pending' })
        .eq('id', existing.sample_id);
    }

    return res.json({ message: 'Test removed successfully' });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};

// ── ADD TO samples.routes.js ──────────────────────────────
// router.put('/:id',                     sc.updateSample);
// router.put('/:id/void',                sc.voidSample);
// router.delete('/assignment/:assignmentId', sc.removeTestAssignment);