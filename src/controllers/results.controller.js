const supabase = require('../config/supabase');

// ── SUBMIT OR EDIT A RESULT ────────────────────────────────
exports.submitResult = async (req, res) => {
  try {
    const { assignment_id, result_value, analyst_signature } = req.body;

    if (!assignment_id || result_value === undefined || result_value === '') {
      return res.status(400).json({ error: 'assignment_id and result_value are required' });
    }
    if (!analyst_signature || analyst_signature.trim() === '') {
      return res.status(400).json({
        error: 'Analyst signature is required. You must sign against every result you submit.',
      });
    }

    // Fetch the assignment with full test and spec data
    const { data: assignment, error: aErr } = await supabase
      .from('sample_test_assignments')
      .select(`
        id, result_value, edit_count, is_locked, sample_id,
        tests (
          id, name, code, unit, result_type,
          test_specifications ( min_value, max_value, brand_id, subtype_id, display_spec )
        ),
        registered_samples ( brand_id, subtype_id, department_id )
      `)
      .eq('id', assignment_id)
      .single();

    if (aErr || !assignment) {
      return res.status(404).json({ error: 'Test assignment not found' });
    }
    if (assignment.is_locked) {
      return res.status(403).json({ error: 'This result is locked and cannot be changed.' });
    }
    if (assignment.edit_count >= 2 && assignment.result_value !== null) {
      // Lock it now
      await supabase
        .from('sample_test_assignments')
        .update({ is_locked: true })
        .eq('id', assignment_id);
      return res.status(403).json({
        error: 'Maximum of 2 edits reached. This result is now permanently locked for audit.',
      });
    }

    // Save audit trail if this is an EDIT (not first submission)
    const isEdit = assignment.result_value !== null;
    if (isEdit) {
      await supabase.from('result_edit_history').insert({
        assignment_id,
        previous_value : assignment.result_value,
        new_value      : String(result_value),
        edited_by      : req.user.id,
        edited_at      : new Date().toISOString(),
      });
    }

    // ── Evaluate the result ────────────────────────────────
    let result_status  = 'ok';
    let remarks        = 'OK';
    let action         = 'Pass';
    let result_numeric = null;

    const numVal   = parseFloat(result_value);
    const isNumber = !isNaN(numVal);

    if (isNumber) {
      result_numeric = numVal;

      // Find matching spec (brand-specific first, then generic)
      const specs = assignment.tests.test_specifications || [];
      const brand_id   = assignment.registered_samples.brand_id;
      const subtype_id = assignment.registered_samples.subtype_id;

      const spec =
        specs.find(s => s.brand_id === brand_id   && s.subtype_id === subtype_id) ||
        specs.find(s => s.brand_id === brand_id   && s.subtype_id === null)       ||
        specs.find(s => s.brand_id === null        && s.subtype_id === subtype_id) ||
        specs.find(s => s.brand_id === null        && s.subtype_id === null);

      if (spec && spec.min_value !== null && spec.max_value !== null) {
        if (numVal < spec.min_value) {
          result_status = 'fail_low';
          remarks       = 'LOW';
          action        = 'Fail/Adjust';
        } else if (numVal > spec.max_value) {
          result_status = 'fail_high';
          remarks       = 'HIGH';
          action        = 'Fail/Adjust';
        } else {
          result_status = 'pass';
          remarks       = 'OK';
          action        = 'Pass';
        }
      }
    } else {
      result_status = 'text_ok';
    }

    // ── Determine new edit count and lock status ───────────
    const newEditCount = isEdit ? assignment.edit_count + 1 : 0;
    const newIsLocked  = newEditCount >= 2;

    // ── Update the assignment ──────────────────────────────
    const { data: updated, error: uErr } = await supabase
      .from('sample_test_assignments')
      .update({
        result_value      : String(result_value),
        result_numeric,
        submitted_by      : req.user.id,
        submitted_at      : new Date().toISOString(),
        analyst_signature : analyst_signature.trim(),
        result_status,
        remarks,
        action,
        edit_count        : newEditCount,
        is_locked         : newIsLocked,
      })
      .eq('id', assignment_id)
      .select()
      .single();

    if (uErr) {
      return res.status(400).json({ error: 'Failed to save result: ' + uErr.message });
    }

    // ── Send out-of-spec notification ──────────────────────
    if (result_status === 'fail_low' || result_status === 'fail_high') {
      await supabase.from('notifications').insert({
        target_department_id : assignment.registered_samples.department_id,
        sample_id            : assignment.sample_id,
        assignment_id,
        type                 : 'out_of_spec',
        title                : `⚠️ Out of Spec — ${assignment.tests.name}`,
        message              : `Result ${result_value} ${assignment.tests.unit || ''} is ${remarks}. ` +
                               `Submitted by ${analyst_signature}. Action required: ${action}.`,
      });
    }

    res.json({
      message      : isEdit ? 'Result updated successfully' : 'Result submitted successfully',
      result       : updated,
      result_status,
      remarks,
      action,
      edits_left   : Math.max(0, 2 - newEditCount),
      is_locked    : newIsLocked,
    });

  } catch (err) {
    console.error('Submit result error:', err);
    res.status(500).json({ error: 'Server error while submitting result' });
  }
};

// ── GET RESULTS FOR A SAMPLE ───────────────────────────────
exports.getResultsBySample = async (req, res) => {
  try {
    const { sample_id } = req.params;

    const { data, error } = await supabase
      .from('sample_test_assignments')
      .select(`
        *,
        tests (
          id, name, code, unit, result_type, display_order,
          test_specifications ( min_value, max_value, display_spec, brand_id, subtype_id )
        ),
        app_users!submitted_by ( full_name )
      `)
      .eq('sample_id', sample_id)
      .order('tests(display_order)');

    if (error) return res.status(400).json({ error: error.message });

    res.json({ results: data || [] });

  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch results' });
  }
};

// ── GET EDIT HISTORY FOR AUDIT ─────────────────────────────
exports.getEditHistory = async (req, res) => {
  try {
    const { assignment_id } = req.params;

    const { data, error } = await supabase
      .from('result_edit_history')
      .select(`*, app_users!edited_by ( full_name )`)
      .eq('assignment_id', assignment_id)
      .order('edited_at', { ascending: false });

    if (error) return res.status(400).json({ error: error.message });

    res.json({ history: data || [] });

  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch edit history' });
  }
};