// ============================================================
// FILE: backend/src/controllers/dashboard.controller.js
// COMPLETE CLEAN FILE — replace everything
// ============================================================

const supabase = require('../config/supabase');

// ── GET LIVE RESULTS ──────────────────────────────────────
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

    if (deptId) {
      q = q.eq('department_id', deptId);
    }

    const { data: samples, error } = await q;
    if (error) {
      console.error('getStats query error:', error.message);
      return res.status(400).json({ error: error.message });
    }

    const all = samples || [];
    const todaySamples = all.filter(s =>
      new Date(s.registered_at) >= today
    );

    return res.json({
      total       : all.length,
      today       : todaySamples.length,
      pending     : all.filter(s => s.status === 'pending').length,
      in_progress : all.filter(s => s.status === 'in_progress').length,
      complete    : all.filter(s => s.status === 'complete').length,
      out_of_spec : 0,
    });
  } catch (err) {
    console.error('getStats crash:', err.message);
    return res.status(500).json({ error: 'Failed to load stats' });
  }
};

// ── GET NOTIFICATIONS ─────────────────────────────────────
exports.getNotifications = async (req, res) => {
  try {
    const { data } = await supabase
      .from('notifications')
      .select('*')
      .eq('user_id', req.user.id)
      .eq('is_read', false)
      .order('created_at', { ascending: false })
      .limit(20);
    return res.json({ notifications: data || [] });
  } catch (err) {
    return res.json({ notifications: [] });
  }
};

// ── MARK NOTIFICATIONS READ ───────────────────────────────
exports.markNotificationsRead = async (req, res) => {
  try {
    await supabase
      .from('notifications')
      .update({ is_read: true })
      .eq('user_id', req.user.id)
      .eq('is_read', false);
    return res.json({ message: 'Notifications marked as read' });
  } catch (err) {
    return res.json({ message: 'Done' });
  }
};
