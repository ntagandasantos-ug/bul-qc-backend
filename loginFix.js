require('dotenv').config();
const bcrypt = require('bcryptjs');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const USERS = [
  { username: 'qc_head',       password: 'BULqc@Head2024!'  },
  { username: 'qc_assistant',  password: 'BULqc@Asst2024!'  },
  { username: 'shift_magezi',  password: 'Magezi@Shift24!'  },
  { username: 'shift_charles', password: 'Charles@Shift24!' },
  { username: 'shift_kato',    password: 'Kato@Shift2024!'  },
  { username: 'shift_emma',    password: 'Emma@Shift2024!'  },
  { username: 'shift_general', password: 'General@Shift24!' },
  { username: 'det_head',      password: 'DetHead@2024!!'   },
  { username: 'det_assistant', password: 'DetAsst@2024!!'   },
];

async function run() {
  console.log('\n BUL QC — Password Update Tool');
  console.log('================================\n');

  // Test connection first
  const { error: connErr } = await supabase
    .from('app_users').select('id').limit(1);
  if (connErr) {
    console.error('❌ Cannot reach Supabase:', connErr.message);
    console.error('   Check your backend/.env keys');
    process.exit(1);
  }
  console.log('✅ Connected to Supabase\n');

  let ok = 0;
  let fail = 0;

  for (const u of USERS) {
    // 1. Generate a fresh bcryptjs hash
    const hash = await bcrypt.hash(u.password, 10);

    // 2. Immediately verify it works
    const check = await bcrypt.compare(u.password, hash);
    if (!check) {
      console.log(`❌ ${u.username} — hash self-check failed`);
      fail++; continue;
    }

    // 3. UPDATE (not insert) the existing user row
    const { data, error } = await supabase
      .from('app_users')
      .update({ password_hash: hash })
      .eq('username', u.username)
      .select('username, password_hash')
      .single();

    if (error) {
      console.log(`❌ ${u.username} — update failed: ${error.message}`);
      fail++;
    } else if (!data) {
      console.log(`⚠️  ${u.username} — user not found in DB`);
      fail++;
    } else {
      // 4. Verify what was stored in DB matches
      const dbCheck = await bcrypt.compare(u.password, data.password_hash);
      console.log(`${dbCheck ? '✅' : '❌'} ${u.username.padEnd(20)} — ${dbCheck ? 'UPDATED & VERIFIED ✓' : 'STORED HASH MISMATCH ✗'}`);
      dbCheck ? ok++ : fail++;
    }
  }

  console.log('\n================================');
  console.log(`✅ Success: ${ok}`);
  console.log(`❌ Failed:  ${fail}`);
  console.log('================================\n');

  if (ok === 0) {
    console.log('❌ Nothing was updated.');
    console.log('   Go to Supabase SQL Editor and run:');
    console.log('   SELECT username FROM app_users;');
    console.log('   Make sure users exist before running this script.\n');
    process.exit(1);
  }

  // Final login simulation
  console.log('Testing login simulation for shift_magezi...');
  const { data: testUser } = await supabase
    .from('app_users')
    .select('username, password_hash, is_active')
    .eq('username', 'shift_magezi')
    .single();

  if (!testUser) {
    console.log('❌ shift_magezi not found\n');
  } else if (!testUser.is_active) {
    console.log('❌ shift_magezi account is INACTIVE — run this in Supabase SQL Editor:');
    console.log('   UPDATE app_users SET is_active = true;');
  } else {
    const loginOk = await bcrypt.compare('Magezi@Shift24!', testUser.password_hash);
    console.log(loginOk
      ? '✅ LOGIN TEST PASSED — shift_magezi will now login successfully!\n'
      : '❌ LOGIN TEST FAILED — hash still not matching\n'
    );
  }

  console.log('NEXT STEPS:');
  console.log('1. Press Ctrl+C in your backend terminal');
  console.log('2. Type: npm run dev  and press ENTER');
  console.log('3. Open http://localhost:3000');
  console.log('4. Username: shift_magezi');
  console.log('5. Password: Magezi@Shift24!\n');
}

run().catch(e => {
  console.error('Unexpected error:', e.message);
  process.exit(1);
});
