// ============================================================
// FILE: backend/src/controllers/dashboard.controller.js
// FULL REPLACEMENT — includes sample_categories in query
// so Refinery tab filtering works correctly
// ============================================================

const supabase = require('../config/supabase');

// ── GET LIVE RESULTS ──────────────────────────────────────
// Returns all test assignments with full sample + test info
// Includes sample_categories so the Refinery tabs can filter
exports.getLiveResults = async (req, res) => {
  try {
    const deptId = req.user?.department_id;

    const { data, error } = await supabase
      .from('sample_test_assignments')
      .select(`
        id,
        result_value,
        result_numeric,
        result_status,
        remarks,
        action,
        analyst_signature,
        submitted_at,
        edit_count,
        is_locked,
        tests (
          id, name, unit, result_type, display_order,
          test_specifications (
            min_value, max_value, display_spec,
            brand_id, subtype_id
          )
        ),
        registered_samples (
          id, sample_name, sample_number, status,
          registered_at, sampler_name,
          brand_id, subtype_id, department_id,
          brands ( name ),
          sample_subtypes ( name ),
          sample_types (
            id, name, code,
            sample_categories ( id, name, code )
          )
        )
      `)
      .order('submitted_at', { ascending: false })
      .limit(500);

    if (error) {
      console.error('getLiveResults error:', error.message);
      return res.status(400).json({ error: error.message });
    }

    // Filter to only this department's samples
    let results = data || [];
    if (deptId) {
      results = results.filter(r =>
        r.registered_samples?.department_id === deptId
      );
    }

    return res.json({ results });
  } catch (err) {
    console.error('getLiveResults crash:', err.message);
    return res.status(500).json({ error: 'Failed to load live results' });
  }
};

// ── GET STATS ─────────────────────────────────────────────
exports.getStats = async (req, res) => {
  try {
    const deptId = req.query.department_id || req.user?.department_id;
    const today  = new Date();
    today.setHours(0, 0, 0, 0);

    let q = supabase
      .from('registered_samples')
      .select('id, status, registered_at');

    if (deptId) q = q.eq('department_id', deptId);

    const { data: samples } = await q;
    const all = samples || [];

    // Today's samples
    const todaySamples = all.filter(s =>
      new Date(s.registered_at) >= today
    );

    // Count out of spec
    const { data: oosSamples } = await supabase
      .from('sample_test_assignments')
      .select('id, registered_samples!inner(department_id)')
      .in('result_status', ['fail_low', 'fail_high'])
      .eq(deptId ? 'registered_samples.department_id' : 'id', deptId || 'id');

    return res.json({
      total        : all.length,
      today        : todaySamples.length,
      pending      : all.filter(s => s.status === 'pending').length,
      in_progress  : all.filter(s => s.status === 'in_progress').length,
      complete     : all.filter(s => s.status === 'complete').length,
      today_pending: todaySamples.filter(s => s.status === 'pending').length,
      out_of_spec  : oosSamples?.length || 0,
    });
  } catch (err) {
    console.error('getStats error:', err.message);
    return res.status(500).json({ error: 'Failed to load stats' });
  }
};
