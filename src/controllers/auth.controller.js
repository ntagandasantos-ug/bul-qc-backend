// ============================================================
// FILE: backend/src/controllers/auth.controller.js
// Clean reset — simple reliable login
// ============================================================

require('dotenv').config();
const jwt      = require('jsonwebtoken');
const bcrypt   = require('bcryptjs');
const supabase = require('../config/supabase');

// ── Safe email service import ─────────────────────────────
let sendVerificationCode;
try {
  sendVerificationCode = require('../utils/emailService').sendVerificationCode;
} catch(e) {
  sendVerificationCode = async (email, code, type) => {
    console.log(`[EMAIL FALLBACK] To:${email} Code:${code} Type:${type}`);
    return true;
  };
}

// ── LOGIN ──────────────────────────────────────────────────
exports.login = async (req, res) => {
  try {
    const { username, password, signingAs } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }

    const cleanUsername = username.trim().toLowerCase();
    console.log(`[LOGIN] Attempting login for: "${cleanUsername}"`);

    // Fetch user with all needed relations
    const { data: user, error: fetchErr } = await supabase
      .from('app_users')
      .select(`
        id, full_name, username, password_hash,
        shift_name, is_active,
        role_id,
        roles ( name, level ),
        department_id,
        departments ( name, code )
      `)
      .eq('username', cleanUsername)
      .single();

    if (fetchErr || !user) {
      console.log(`[LOGIN] User not found: "${cleanUsername}"`);
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    if (!user.is_active) {
      return res.status(401).json({ error: 'Account is deactivated. Contact QC Head.' });
    }

    // Verify password using bcryptjs
    const passwordMatch = await bcrypt.compare(password, user.password_hash);
    console.log(`[LOGIN] Password match for "${cleanUsername}": ${passwordMatch}`);

    if (!passwordMatch) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    // Build session
    const expiresAt = new Date(Date.now() + 12 * 60 * 60 * 1000); // 12 hours

    const token = jwt.sign(
      { userId: user.id, username: user.username },
      process.env.JWT_SECRET || 'bul_qc_fallback_secret',
      { expiresIn: '12h' }
    );

    // Create shift record for supervisors
    let shiftId = null;
    if (user.roles?.name === 'Shift Supervisor' && user.shift_name) {
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
      if (shift) shiftId = shift.id;
    }

    // Save session (multi-device — no expiry of other sessions)
    await supabase.from('active_sessions').insert({
      user_id       : user.id,
      shift_id      : shiftId,
      session_token : token,
      expires_at    : expiresAt.toISOString(),
      device_info   : req.headers['user-agent'] || 'Unknown',
      is_expired    : false,
    });

    // Remove password hash before sending
    const { password_hash, ...safeUser } = user;

    console.log(`[LOGIN] ✅ Success for "${cleanUsername}" — Role: ${user.roles?.name}`);

    return res.status(200).json({
      message   : `Welcome, ${user.full_name}!`,
      token,
      user      : safeUser,
      signingAs : signingAs || null,
      expiresAt : expiresAt.toISOString(),
    });

  } catch (err) {
    console.error('[LOGIN] Unexpected error:', err.message);
    return res.status(500).json({ error: 'Login failed. Please try again.' });
  }
};

// ── LOGOUT ─────────────────────────────────────────────────
exports.logout = async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (token) {
      await supabase
        .from('active_sessions')
        .update({
          is_expired    : true,
          logged_out_at : new Date().toISOString(),
        })
        .eq('session_token', token);
    }

    // Deactivate shift if supervisor
    if (req.user?.id && req.user?.roles?.name === 'Shift Supervisor') {
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

// ── GET CURRENT USER ───────────────────────────────────────
exports.getMe = async (req, res) => {
  return res.json({ user: req.user });
};

// ── REQUEST VERIFICATION CODE (for password/username change)
exports.requestChangeCode = async (req, res) => {
  try {
    const { username, password, changeType } = req.body;
    if (!username || !password || !changeType) {
      return res.status(400).json({ error: 'All fields required' });
    }

    const { data: user } = await supabase
      .from('app_users')
      .select('id, email, password_hash')
      .eq('username', username.trim().toLowerCase())
      .single();

    if (!user) return res.status(401).json({ error: 'Invalid username or password' });

    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) return res.status(401).json({ error: 'Invalid username or password' });

    if (!user.email) {
      return res.status(400).json({
        error: 'No email on file. Contact QC Head to add your email.',
      });
    }

    const code    = Math.floor(100000 + Math.random() * 900000).toString();
    const expires = new Date(Date.now() + 10 * 60 * 1000);

    await supabase.from('app_users').update({
      verify_code         : code,
      verify_code_expires : expires.toISOString(),
      verify_change_type  : changeType,
    }).eq('id', user.id);

    await sendVerificationCode(user.email, code, changeType);

    const [local, domain] = user.email.split('@');
    const masked = local.substring(0,2) + '***@' + domain;

    res.json({ message: `Code sent to ${masked}`, masked });
  } catch (err) {
    console.error('requestChangeCode error:', err.message);
    res.status(500).json({ error: 'Failed to send code' });
  }
};

// ── CHANGE PASSWORD ────────────────────────────────────────
exports.changePasswordWithCode = async (req, res) => {
  try {
    const { oldPassword, newPassword, verifyCode } = req.body;

    const { data: u } = await supabase
      .from('app_users')
      .select('id, password_hash, verify_code, verify_code_expires, verify_change_type')
      .eq('id', req.user.id)
      .single();

    if (!u.verify_code) return res.status(400).json({ error: 'No code requested. Start over.' });
    if (u.verify_change_type !== 'password') return res.status(400).json({ error: 'Wrong code type.' });
    if (u.verify_code !== verifyCode?.trim()) return res.status(400).json({ error: 'Wrong code.' });
    if (new Date() > new Date(u.verify_code_expires)) return res.status(400).json({ error: 'Code expired.' });

    const match = await bcrypt.compare(oldPassword, u.password_hash);
    if (!match) return res.status(401).json({ error: 'Current password is incorrect.' });

    const newHash = await bcrypt.hash(newPassword, 12);
    await supabase.from('app_users').update({
      password_hash       : newHash,
      verify_code         : null,
      verify_code_expires : null,
      verify_change_type  : null,
    }).eq('id', req.user.id);

    res.json({ message: 'Password changed successfully' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to change password' });
  }
};

// ── CHANGE USERNAME ────────────────────────────────────────
exports.changeUsernameWithCode = async (req, res) => {
  try {
    const { newUsername, verifyCode } = req.body;

    const { data: u } = await supabase
      .from('app_users')
      .select('verify_code, verify_code_expires, verify_change_type')
      .eq('id', req.user.id)
      .single();

    if (!u.verify_code) return res.status(400).json({ error: 'No code requested. Start over.' });
    if (u.verify_change_type !== 'username') return res.status(400).json({ error: 'Wrong code type.' });
    if (u.verify_code !== verifyCode?.trim()) return res.status(400).json({ error: 'Wrong code.' });
    if (new Date() > new Date(u.verify_code_expires)) return res.status(400).json({ error: 'Code expired.' });

    const clean = newUsername.trim().toLowerCase();
    const { data: taken } = await supabase
      .from('app_users').select('id').eq('username', clean).single();
    if (taken) return res.status(400).json({ error: 'Username already taken.' });

    await supabase.from('app_users').update({
      username            : clean,
      verify_code         : null,
      verify_code_expires : null,
      verify_change_type  : null,
    }).eq('id', req.user.id);

    res.json({ message: `Username changed to "${clean}"` });
  } catch (err) {
    res.status(500).json({ error: 'Failed to change username' });
  }
};
