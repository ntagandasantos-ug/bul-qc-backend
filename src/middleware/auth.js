const jwt      = require('jsonwebtoken');
const supabase = require('../config/supabase');

// ── authenticate: checks the token on every protected request ──
const authenticate = async (req, res, next) => {
  try {
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'No token. Please login first.' });
    }

    const token = header.split(' ')[1];

    // 1. Verify the JWT signature
    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch (e) {
      return res.status(401).json({ error: 'Token is invalid or expired. Please login again.' });
    }

    // 2. Check the session is still active in the database
    const { data: session, error } = await supabase
      .from('active_sessions')
      .select(`
        id, expires_at, is_expired,
        app_users (
          id, full_name, username, shift_name,
          role_id, department_id,
          roles ( name, level ),
          departments ( name, code )
        )
      `)
      .eq('session_token', token)
      .eq('is_expired', false)
      .single();

    if (error || !session) {
      return res.status(401).json({
        error  : 'Session not found. Please login again.',
        code   : 'SESSION_NOT_FOUND',
      });
    }

    // 3. Check 12-hour expiry
    if (new Date() > new Date(session.expires_at)) {
      await supabase
        .from('active_sessions')
        .update({ is_expired: true, logged_out_at: new Date().toISOString() })
        .eq('id', session.id);

      return res.status(401).json({
        error: 'Your 12-hour shift session has ended. Please login again.',
        code : 'SHIFT_EXPIRED',
      });
    }

    // 4. Attach user info to the request for use in controllers
    req.user      = session.app_users;
    req.userRole  = session.app_users.roles;
    req.sessionId = session.id;
    next();

  } catch (err) {
    console.error('Auth middleware error:', err);
    return res.status(500).json({ error: 'Authentication error' });
  }
};

// ── authorize: checks the user's role ──────────────────────
const authorize = (...allowedRoles) => {
  return (req, res, next) => {
    if (!req.userRole) {
      return res.status(403).json({ error: 'Role not found' });
    }
    if (!allowedRoles.includes(req.userRole.name)) {
      return res.status(403).json({
        error: `Access denied. Required role: ${allowedRoles.join(' or ')}`,
      });
    }
    next();
  };
};

module.exports = { authenticate, authorize };