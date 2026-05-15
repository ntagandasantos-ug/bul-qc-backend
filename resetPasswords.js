require('dotenv').config();
const bcrypt   = require('bcryptjs');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// ── All users and their passwords ─────────────────────────
const users = [
  { username: 'qc_head',        password: 'BULqc@Head2024!'  },
  { username: 'qc_assistant',   password: 'BULqc@Asst2024!'  },
  { username: 'shift_magezi',   password: 'Magezi@Shift24!'  },
  { username: 'shift_charles',  password: 'Charles@Shift24!' },
  { username: 'shift_kato',     password: 'Kato@Shift2024!'  },
  { username: 'shift_emma',     password: 'Emma@Shift2024!'  },
  { username: 'shift_general',  password: 'General@Shift24!' },
  { username: 'det_head',       password: 'DetHead@2024!!'   },
  { username: 'det_assistant',  password: 'DetAsst@2024!!'   },
  { username: 'ref_head',       password: 'RefHead@2024!!'  },
  { username: 'ref_assistant',  password: 'RefAsst@2024!!'  },
  { username: 'fp_head',        password: 'FPHead@2024!!' },
  { username: 'fp_assistant',   password: 'FPAsst@2024!!' },
  { username: 'soap_head',      password: 'SoapHead@2024!!' },
  { username: 'soap_assistant', password: 'SoapAsst@2024!!' },
];

async function resetAllPasswords() {
  console.log('\n🔐 BUL QC — Password Reset Tool');
  console.log('================================\n');

  // First check Supabase connection
  const { data: check, error: checkErr } = await supabase
    .from('app_users')
    .select('id, username')
    .limit(1);

  if (checkErr) {
    console.error('❌ Cannot connect to Supabase!');
    console.error('   Error:', checkErr.message);
    console.error('\n   FIX: Check your .env file:');
    console.error('   - SUPABASE_URL must be your real project URL');
    console.error('   - SUPABASE_SERVICE_KEY must be the service_role key (NOT anon key)');
    process.exit(1);
  }

  console.log('✅ Supabase connected successfully\n');

  let successCount = 0;
  let failCount    = 0;

  for (const u of users) {
    try {
      // Generate bcryptjs hash (rounds=12 for security)
      const hash = await bcrypt.hash(u.password, 12);

      // Update in Supabase
      const { data, error } = await supabase
        .from('app_users')
        .update({ password_hash: hash })
        .eq('username', u.username)
        .select('id, username')
        .single();

      if (error) {
        // User might not exist — try inserting
        console.log(`⚠️  ${u.username} — not found in DB. Did you run the Phase 2 SQL?`);
        failCount++;
      } else if (!data) {
        console.log(`⚠️  ${u.username} — user not found (no rows matched)`);
        failCount++;
      } else {
        console.log(`✅  ${u.username} — password reset successfully`);
        successCount++;
      }
    } catch (err) {
      console.error(`❌  ${u.username} — ERROR: ${err.message}`);
      failCount++;
    }
  }

  console.log('\n================================');
  console.log(`✅ Success: ${successCount} users`);
  if (failCount > 0) {
    console.log(`❌ Failed:  ${failCount} users`);
    console.log('\nFor failed users, run the Phase 2 SQL script first,');
    console.log('then run this script again.');
  }

  // Verify by testing one login
  console.log('\n🧪 Testing shift_magezi login...');
  const { data: testUser } = await supabase
    .from('app_users')
    .select('username, password_hash')
    .eq('username', 'shift_magezi')
    .single();

  if (testUser) {
    const testValid = await bcrypt.compare('Magezi@Shift24!', testUser.password_hash);
    if (testValid) {
      console.log('✅ TEST PASSED — shift_magezi can now login successfully!\n');
    } else {
      console.log('❌ TEST FAILED — hash still not matching. Check your Supabase service key.\n');
    }
  } else {
    console.log('❌ shift_magezi user not found in database.\n');
  }

  process.exit(0);
}

resetAllPasswords();