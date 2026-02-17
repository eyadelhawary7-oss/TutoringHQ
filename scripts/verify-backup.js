/**
 * Backup verification script.
 * Run against a restored test database to verify data integrity.
 *
 * Usage:
 *   TEST_SUPABASE_URL=https://xxx.supabase.co TEST_SUPABASE_SERVICE_KEY=key npm run verify-backup
 *
 * Requires: Restore a Supabase backup to a separate project first, then use that project's credentials.
 */

const { createClient } = require('@supabase/supabase-js');

const TEST_PROJECT_URL = process.env.TEST_SUPABASE_URL;
const TEST_PROJECT_KEY = process.env.TEST_SUPABASE_SERVICE_KEY;

async function verifyBackup() {
  console.log('🔍 Starting backup verification...\n');

  if (!TEST_PROJECT_URL || !TEST_PROJECT_KEY) {
    console.error('❌ Missing test database credentials.');
    console.error('   Set TEST_SUPABASE_URL and TEST_SUPABASE_SERVICE_KEY environment variables.');
    console.error('   Example: TEST_SUPABASE_URL=https://xxx.supabase.co TEST_SUPABASE_SERVICE_KEY=key npm run verify-backup');
    process.exit(1);
  }

  const supabase = createClient(TEST_PROJECT_URL, TEST_PROJECT_KEY);
  const checks = [];

  // Check 1: Table counts
  const tables = ['centers', 'users', 'students', 'payments', 'student_groups', 'audit_log'];

  for (const table of tables) {
    try {
      const { count, error } = await supabase.from(table).select('*', { count: 'exact', head: true });

      if (error) {
        checks.push({ table, status: '❌ FAIL', error: error.message });
      } else {
        checks.push({ table, status: '✅ PASS', count: count ?? 0 });
      }
    } catch (err) {
      checks.push({ table, status: '❌ FAIL', error: err?.message || 'Unknown error' });
    }
  }

  // Check 2: Orphaned students (students with center_id not in centers)
  try {
    const { data: centers } = await supabase.from('centers').select('id');
    const { data: students } = await supabase.from('students').select('id, center_id').limit(50000);

    const centerIds = new Set((centers || []).map((c) => c.id));
    const orphanedCount = (students || []).filter(
      (s) => s.center_id != null && !centerIds.has(s.center_id)
    ).length;

    if (orphanedCount > 0) {
      checks.push({ check: 'Orphaned students', status: '⚠️  WARNING', count: orphanedCount });
    } else {
      checks.push({ check: 'Orphaned students', status: '✅ PASS', count: 0 });
    }
  } catch (err) {
    checks.push({ check: 'Orphaned students', status: '❌ FAIL', error: err?.message || 'Unknown error' });
  }

  // Check 3: Orphaned payments (payments with student_id not in students)
  try {
    const { data: students } = await supabase.from('students').select('id').limit(50000);
    const { data: payments } = await supabase.from('payments').select('id, student_id').limit(50000);

    const studentIds = new Set((students || []).map((s) => s.id));
    const orphanedPayments = (payments || []).filter((p) => !studentIds.has(p.student_id)).length;

    if (orphanedPayments > 0) {
      checks.push({ check: 'Orphaned payments', status: '⚠️  WARNING', count: orphanedPayments });
    } else {
      checks.push({ check: 'Orphaned payments', status: '✅ PASS', count: 0 });
    }
  } catch (err) {
    checks.push({ check: 'Orphaned payments', status: '❌ FAIL', error: err?.message || 'Unknown error' });
  }

  // Check 4: Date integrity (centers have valid created_at)
  try {
    const { data: centerDates } = await supabase
      .from('centers')
      .select('created_at')
      .order('created_at', { ascending: true })
      .limit(1);

    const { data: latestCenters } = await supabase
      .from('centers')
      .select('created_at')
      .order('created_at', { ascending: false })
      .limit(1);

    const oldest = centerDates?.[0]?.created_at;
    const newest = latestCenters?.[0]?.created_at;

    if (oldest && newest) {
      checks.push({
        check: 'Date integrity',
        status: '✅ PASS',
        detail: `oldest: ${oldest}, newest: ${newest}`,
      });
    } else if (!centerDates?.length && !latestCenters?.length) {
      checks.push({ check: 'Date integrity', status: '✅ PASS', detail: 'No centers (empty DB)' });
    } else {
      checks.push({ check: 'Date integrity', status: '⚠️  WARNING', detail: 'Could not verify dates' });
    }
  } catch (err) {
    checks.push({ check: 'Date integrity', status: '❌ FAIL', error: err?.message || 'Unknown error' });
  }

  // Print results
  console.log('📊 Verification Results:\n');
  for (const c of checks) {
    if (c.table) {
      console.log(`  ${c.status} ${c.table}: ${c.count ?? c.error ?? 'N/A'}`);
    } else {
      console.log(`  ${c.status} ${c.check}: ${c.count ?? c.detail ?? c.error ?? 'N/A'}`);
    }
  }

  const failed = checks.filter((c) => c.status.includes('FAIL'));
  const warnings = checks.filter((c) => c.status.includes('WARNING'));
  const passed = checks.length - failed.length - warnings.length;

  console.log(`\n✅ Passed: ${passed}`);
  console.log(`⚠️  Warnings: ${warnings.length}`);
  console.log(`❌ Failed: ${failed.length}\n`);

  if (failed.length > 0) {
    console.log('❌ Backup verification FAILED');
    process.exit(1);
  } else if (warnings.length > 0) {
    console.log('⚠️  Backup verification passed with warnings');
  } else {
    console.log('✅ Backup verification PASSED');
  }
}

verifyBackup().catch((err) => {
  console.error(err);
  process.exit(1);
});
