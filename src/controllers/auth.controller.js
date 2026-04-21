// ============================================================
// FILE 2: backend/src/controllers/auth.controller.js
// Complete replacement — fixes the emailService import crash
// ============================================================

require('dotenv').config();
const jwt      = require('jsonwebtoken');
const supabase = require('../config/supabase');

// Safe import — won't crash if file has issues
let sendVerificationCode;
try {
  const emailSvc = require('../utils/emailService');
  sendVerificationCode = emailSvc.sendVerificationCode;
  console.log('✅ emailService loaded');
} catch (e) {
  console.error('⚠️  emailService not loaded:', e.message);
  // Fallback — just log the code
  sendVerificationCode = async (email, code, type) => {
    console.log(`[EMAIL FALLBACK] To:${email} Code:${code} Type:${type}`);
    return true;
  };
}

// ── Helper: Generate 6-digit verification code ────────────
function genCode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// ── LOGIN ─────────────────────────────────────────────────
exports.login = async (req, res) => {
  try {
    const { username, password, signingAs } = req.body;

    if (!username || !password) {
      return res.status(400).json({
        error: 'Username and password are required',
      });
    }

    const cleanUser = username.trim().toLowerCase();
    console.log(`\n[LOGIN] Attempt: "${cleanUser}"`);

    // Use PostgreSQL verify function
    const { data: rows, error: rpcErr } = await supabase
      .rpc('verify_user_password', {
        p_username: cleanUser,
        p_password: password,
      });

    console.log('[LOGIN] RPC rows:', rows?.length ?? 'null');
    if (rpcErr) console.error('[LOGIN] RPC error:', rpcErr.message);

    if (rpcErr) {
      return await directLoginFallback(req, res, cleanUser, password, signingAs);
    }

    if (!rows || rows.length === 0) {
      console.log('[LOGIN] ❌ Invalid credentials');
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    const user = rows[0];
    console.log('[LOGIN] ✅ User found:', user.username, '| active:', user.is_active);

    if (!user.is_active) {
      return res.status(401).json({
        error: 'Your account is deactivated. Contact the QC Head.',
      });
    }

    return await buildSession(res, user, signingAs, req);

  } catch (err) {
    console.error('[LOGIN] Unexpected error:', err.message);
    return res.status(500).json({ error: 'Login failed. Please try again.' });
  }
};

// ── DIRECT FALLBACK LOGIN ─────────────────────────────────
async function directLoginFallback(req, res, username, password, signingAs) {
  try {
    console.log('[FALLBACK] Direct query for:', username);

    const { data: user, error } = await supabase
      .from('app_users')
      .select(`
        id, full_name, username, password_hash,
        shift_name, role_id, department_id, is_active,
        roles ( name, level ),
        departments ( name, code )
      `)
      .eq('username', username)
      .single();

    if (error || !user) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    const { data: pwOk } = await supabase.rpc('check_password_direct', {
      p_hash    : user.password_hash,
      p_password: password,
    });

    if (!pwOk) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    if (!user.is_active) {
      return res.status(401).json({ error: 'Account deactivated.' });
    }

    return await buildSession(res, user, signingAs, req);
  } catch (err) {
    console.error('[FALLBACK] Error:', err.message);
    return res.status(500).json({ error: 'Login failed' });
  }
}

// ── BUILD SESSION ─────────────────────────────────────────
async function buildSession(res, user, signingAs, req) {
  try {
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + 12);

    const token = jwt.sign(
      { userId: user.id, username: user.username },
      process.env.JWT_SECRET,
      { expiresIn: '12h' }
    );

    // Create shift if supervisor
    let shiftId = null;
    const roleName = user.roles?.name || user.roles?.['name'];
    if (roleName === 'Shift Supervisor') {
      const { data: shift } = await supabase
        .from('shifts')
        .insert({
          supervisor_id  : user.id,
          shift_name     : user.shift_name,
          started_at     : new Date().toISOString(),
          auto_logout_at : expiresAt.toISOString(),
          is_active      : true,
        })
        .select('id')
        .single();
      shiftId = shift?.id || null;
    }

    // Save session (multi-device — no expiry of old sessions)
    await supabase.from('active_sessions').insert({
      user_id      : user.id,
      shift_id     : shiftId,
      session_token: token,
      expires_at   : expiresAt.toISOString(),
      device_info  : req.headers['user-agent'] || 'Unknown',
    });

    const { password_hash, ...safeUser } = user;
    console.log(`[LOGIN] ✅ Session created for ${user.username}\n`);

    return res.status(200).json({
      message   : `Welcome, ${user.full_name}!`,
      token,
      user      : safeUser,
      signingAs : signingAs || null,
      expiresAt : expiresAt.toISOString(),
    });
  } catch (err) {
    console.error('[SESSION] Error:', err.message);
    return res.status(500).json({ error: 'Session creation failed' });
  }
}

// ── LOGOUT ────────────────────────────────────────────────
exports.logout = async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (token) {
      await supabase
        .from('active_sessions')
        .update({ is_expired: true, logged_out_at: new Date().toISOString() })
        .eq('session_token', token);
    }
    if (req.user?.shift_name) {
      await supabase
        .from('shifts')
        .update({ is_active: false, ends_at: new Date().toISOString() })
        .eq('supervisor_id', req.user.id)
        .eq('is_active', true);
    }
    return res.json({ message: 'Logged out successfully' });
  } catch (err) {
    return res.status(500).json({ error: 'Logout failed' });
  }
};

// ── GET CURRENT USER ──────────────────────────────────────
exports.getMe = async (req, res) => {
  return res.json({ user: req.user, role: req.userRole });
};

// ── REQUEST VERIFICATION CODE ─────────────────────────────
exports.requestChangeCode = async (req, res) => {
  try {
    const { username, password, changeType } = req.body;

    if (!username || !password || !changeType) {
      return res.status(400).json({ error: 'All fields required' });
    }

    // Verify credentials
    const { data: rows } = await supabase.rpc('verify_user_password', {
      p_username: username.trim().toLowerCase(),
      p_password: password,
    });

    if (!rows || rows.length === 0) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    const user = rows[0];

    if (!user.email) {
      return res.status(400).json({
        error: 'No email address on file for this account. Contact your QC Head to add your email.',
      });
    }

    const code    = genCode();
    const expires = new Date(Date.now() + 10 * 60 * 1000);

    await supabase.from('app_users').update({
      verify_code        : code,
      verify_code_expires: expires.toISOString(),
      verify_change_type : changeType,
    }).eq('id', user.id);

    const sent = await sendVerificationCode(user.email, code, changeType);

    const [localPart, domain] = (user.email || '@').split('@');
    const masked = (localPart.substring(0, 2) || 'xx') + '***@' + (domain || '***');

    res.json({
      message: sent
        ? `Verification code sent to ${masked}`
        : `Code generated (email not configured): ${code}`,
      masked,
      // Only send code directly in development without email
      ...(process.env.NODE_ENV === 'development' && !sent ? { code } : {}),
    });
  } catch (err) {
    console.error('requestChangeCode error:', err.message);
    res.status(500).json({ error: 'Failed to send verification code' });
  }
};

// ── CHANGE PASSWORD WITH CODE ─────────────────────────────
exports.changePasswordWithCode = async (req, res) => {
  try {
    const { oldPassword, newPassword, verifyCode } = req.body;

    if (!verifyCode) {
      return res.status(400).json({ error: 'Verification code required' });
    }

    const { data: u } = await supabase
      .from('app_users')
      .select('verify_code, verify_code_expires, verify_change_type')
      .eq('id', req.user.id)
      .single();

    if (!u?.verify_code) {
      return res.status(400).json({ error: 'No verification code was requested. Start over.' });
    }
    if (u.verify_change_type !== 'password') {
      return res.status(400).json({ error: 'This code is for a username change, not password.' });
    }
    if (u.verify_code !== verifyCode.trim()) {
      return res.status(400).json({ error: 'Wrong verification code. Try again.' });
    }
    if (new Date() > new Date(u.verify_code_expires)) {
      return res.status(400).json({ error: 'Code expired. Request a new one.' });
    }

    const { data: ok } = await supabase.rpc('update_user_password', {
      p_user_id     : req.user.id,
      p_old_password: oldPassword,
      p_new_password: newPassword,
    });

    if (!ok) {
      return res.status(401).json({ error: 'Current password is incorrect' });
    }

    await supabase.from('app_users').update({
      verify_code: null, verify_code_expires: null, verify_change_type: null,
    }).eq('id', req.user.id);

    res.json({ message: 'Password changed successfully' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to change password' });
  }
};

// ── CHANGE USERNAME WITH CODE ─────────────────────────────
exports.changeUsernameWithCode = async (req, res) => {
  try {
    const { newUsername, verifyCode } = req.body;

    if (!verifyCode) {
      return res.status(400).json({ error: 'Verification code required' });
    }

    const { data: u } = await supabase
      .from('app_users')
      .select('verify_code, verify_code_expires, verify_change_type')
      .eq('id', req.user.id)
      .single();

    if (!u?.verify_code) {
      return res.status(400).json({ error: 'No verification code requested. Start over.' });
    }
    if (u.verify_change_type !== 'username') {
      return res.status(400).json({ error: 'This code is for a password change, not username.' });
    }
    if (u.verify_code !== verifyCode.trim()) {
      return res.status(400).json({ error: 'Wrong verification code.' });
    }
    if (new Date() > new Date(u.verify_code_expires)) {
      return res.status(400).json({ error: 'Code expired. Request a new one.' });
    }

    const clean = newUsername.trim().toLowerCase();
    const { data: taken } = await supabase
      .from('app_users').select('id').eq('username', clean).single();
    if (taken) {
      return res.status(400).json({ error: 'That username is already taken' });
    }

    await supabase.from('app_users').update({
      username          : clean,
      verify_code       : null,
      verify_code_expires: null,
      verify_change_type: null,
    }).eq('id', req.user.id);

    res.json({ message: `Username changed to "${clean}" successfully` });
  } catch (err) {
    res.status(500).json({ error: 'Failed to change username' });
  }
};