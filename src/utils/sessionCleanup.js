const supabase = require('../config/supabase');

const expireOldSessions = async () => {
  try {
    const { error } = await supabase.rpc('expire_old_sessions');
    if (error) console.error('Session cleanup error:', error.message);
  } catch (err) {
    console.error('Session cleanup failed:', err.message);
  }
};

module.exports = { expireOldSessions };