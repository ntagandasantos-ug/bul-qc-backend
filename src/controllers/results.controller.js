// ============================================================
// FILE: backend/src/controllers/results.controller.js
// FIXED: result_edit_history crash removed, proper error handling
// ============================================================

'use strict';

const supabase = require('../config/supabase');

// ── SUBMIT OR UPDATE A RESULT ────────────────────────────
exports.submitResult = async function(req, res) {
  try {
    const { id } = req.params;

    const {
      result_value,
      analyst_signature,
      result_status,
      remarks,
      action,
      submitted_at,
    } = req.body;

    if (!result_value?.trim()) {
      return res.status(400).json({ error: 'Result value is required' });
    }
    if (!analyst_signature?.trim()) {
      return res.status(400).json({ error: 'Analyst signature is required' });
    }

    // ── Fetch the current assignment ──────────────────────
    const { data: current, error: fetchErr } = await supabase
      .from('sample_test_assignments')
      .select('id, result_value, edit_count, is_locked, sample_id')
      .eq('id', id)
      .single();

    if (fetchErr || !current) {
      console.error('fetchErr:', fetchErr?.message);
      return res.status(404).json({ error: 'Test assignment not found' });
    }

    if (current.is_locked) {
      return res.status(400).json({
        error: 'This result is locked — maximum updates reached',
      });
    }

    const isUpdate  = !!current.result_value;
    const prevCount = current.edit_count || 0;
    const newCount  = isUpdate ? prevCount + 1 : prevCount;
    const isLocked  = newCount >= 2;

    // ── Save edit history (safe — skip if table missing) ──
    if (isUpdate) {
      try {
        await supabase.from('result_edit_history').insert({
          assignment_id   : id,
          old_result_value: current.result_value,
          edited_by       : req.user.id,
          edited_at       : new Date().toISOString(),
        });
      } catch (histErr) {
        // Table may not exist — log and continue
        console.log('result_edit_history insert skipped:', histErr.message);
      }
    }

    // ── Update the assignment ─────────────────────────────
    const { data: updated, error: updateErr } = await supabase
      .from('sample_test_assignments')
      .update({
        result_value      : result_value.trim(),
        result_numeric    : isNaN(parseFloat(result_value))
                              ? null
                              : parseFloat(result_value),
        analyst_signature : analyst_signature.trim(),
        result_status     : result_status  || 'pass',
        remarks           : remarks        || 'OK',
        action            : action         || 'Pass',
        submitted_at      : submitted_at   || new Date().toISOString(),
        edit_count        : newCount,
        is_locked         : isLocked,
      })
      .eq('id', id)
      .select()
      .single();

    if (updateErr) {
      console.error('update error:', updateErr.message);
      return res.status(400).json({ error: updateErr.message });
    }

    // ── Check if all tests are now complete ───────────────
    try {
      const { data: allTests } = await supabase
        .from('sample_test_assignments')
        .select('id, result_value')
        .eq('sample_id', current.sample_id);

      const allDone = allTests?.every(t => t.result_value);
      if (allDone) {
        await supabase
          .from('registered_samples')
          .update({ status: 'complete' })
          .eq('id', current.sample_id);
      } else {
        // Ensure status is in_progress
        await supabase
          .from('registered_samples')
          .update({ status: 'in_progress' })
          .eq('id', current.sample_id)
          .eq('status', 'pending');
      }
    } catch (statusErr) {
      console.log('status update skipped:', statusErr.message);
    }

    return res.json({
      message   : isUpdate ? 'Result updated successfully' : 'Result submitted successfully',
      assignment: updated,
      isLocked,
      editCount : newCount,
      isUpdate,
    });

  } catch (err) {
    console.error('submitResult crash:', err.message);
    return res.status(500).json({ error: 'Failed to submit result: ' + err.message });
  }
};

// ── GET RESULTS FOR A SAMPLE ─────────────────────────────
exports.getResultsBySample = async function(req, res) {
  try {
    const { sampleId } = req.params;

    const { data, error } = await supabase
      .from('sample_test_assignments')
      .select(`
        id, result_value, result_numeric, result_status,
        remarks, action, analyst_signature, submitted_at,
        edit_count, is_locked,
        tests (
          id, name, unit, result_type, display_order,
          test_specifications ( min_value, max_value, display_spec )
        )
      `)
      .eq('sample_id', sampleId)
      .order('tests(display_order)');

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    return res.json({ results: data || [] });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to get results' });
  }
};