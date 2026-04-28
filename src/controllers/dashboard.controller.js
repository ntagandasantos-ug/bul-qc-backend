const supabase = require('../config/supabase');

// ── LIVE RESULTS DASHBOARD (for Detergent Head) ────────────
exports.getLiveResults = async (req, res) => {
  try {
    const deptId = req.user.department_id;

    const { data, error } = await supabase
      .from('sample_test_assignments')
      .select(`
        id, result_value, result_numeric, result_status,
        remarks, action, analyst_signature, submitted_at,
        tests ( name, unit, result_type, display_order,
        test_specifications (
        min_value, max_value, display_spec,
        brand_id, subtype_id)),
        registered_samples !inner (
          id, sample_name, sample_number, status, registered_at,
          department_id,
          brands ( name ),
          sample_subtypes ( name ),
          sample_types ( name, sample_categories ( name ) )
        )
      `)
      .eq('registered_samples.department_id', deptId)
      .not('result_value', 'is', null)
      .order('submitted_at', { ascending: false })
      .limit(200);

    if (error) return res.status(400).json({ error: error.message });

    res.json({ results: data || [] });

  } catch (err) {
    res.status(500).json({ error: 'Failed to load live dashboard' });
  }
};

// ── SUMMARY STATS ──────────────────────────────────────────
exports.getSummaryStats = async (req, res) => {
  try {
    const deptId = req.user.department_id || req.query.department_id;

    const today = new Date(); today.setHours(0, 0, 0, 0);

    let query = supabase
      .from('registered_samples')
      .select('id, status', { count: 'exact' })
      .gte('registered_at', today.toISOString());

    if (deptId) query = query.eq('department_id', deptId);

    const { data: samples } = await query;

    const stats = {
      total      : samples?.length || 0,
      pending    : samples?.filter(s => s.status === 'pending').length    || 0,
      in_progress: samples?.filter(s => s.status === 'in_progress').length || 0,
      complete   : samples?.filter(s => s.status === 'complete').length   || 0,
    };

    // Count out-of-spec results today
    const { count: outOfSpec } = await supabase
      .from('notifications')
      .select('id', { count: 'exact', head: true })
      .eq('type', 'out_of_spec')
      .gte('created_at', today.toISOString());

    stats.out_of_spec = outOfSpec || 0;

    res.json({ stats });

  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
};

// ── GET NOTIFICATIONS ──────────────────────────────────────
exports.getNotifications = async (req, res) => {
  try {
    const deptId = req.user.department_id;

    const { data, error } = await supabase
      .from('notifications')
      .select('*')
      .eq('target_department_id', deptId)
      .order('created_at', { ascending: false })
      .limit(50);

    if (error) return res.status(400).json({ error: error.message });

    res.json({ notifications: data || [] });

  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch notifications' });
  }
};

// ── MARK NOTIFICATIONS AS READ ─────────────────────────────
exports.markNotificationsRead = async (req, res) => {
  try {
    const deptId = req.user.department_id;

    await supabase
      .from('notifications')
      .update({ is_read: true })
      .eq('target_department_id', deptId)
      .eq('is_read', false);

    res.json({ message: 'Notifications marked as read' });

  } catch (err) {
    res.status(500).json({ error: 'Failed to mark notifications' });
  }
};