/**
 * Full reset of 6 audit users: delete broken SQL-seeded auth rows and recreate via Admin API,
 * then re-insert public.users / public.admin_users. Run from project root with .env.local present.
 */
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

function loadEnvLocal() {
  const path = new URL('.env.local', import.meta.url);
  const raw = readFileSync(path, 'utf8');
  const out = {};
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

const env = loadEnvLocal();
const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceKey) {
  console.error(
    'Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local',
  );
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const accounts = [
  {
    id: 'aaaaaaaa-1111-1111-1111-111111111111',
    email: '201111111111@centerhq.local',
    password: '111111',
    phone: '+201111111111',
    name: 'Audit Super Admin',
    userRole: 'super_admin',
    centerId: null,
    adminRole: 'super_admin',
  },
  {
    id: 'aaaaaaaa-2222-2222-2222-222222222222',
    email: '201222222222@centerhq.local',
    password: '222222',
    phone: '+201222222222',
    name: 'Audit Internal Admin',
    userRole: 'super_admin',
    centerId: null,
    adminRole: 'admin',
  },
  {
    id: 'aaaaaaaa-3333-3333-3333-333333333333',
    email: '201333333333@centerhq.local',
    password: '333333',
    phone: '+201333333333',
    name: 'أحمد المالك',
    userRole: 'owner',
    centerId: 'cccccccc-1111-1111-1111-111111111111',
    adminRole: null,
  },
  {
    id: 'aaaaaaaa-4444-4444-4444-444444444444',
    email: '201444444444@centerhq.local',
    password: '444444',
    phone: '+201444444444',
    name: 'محمد المساعد',
    userRole: 'assistant',
    centerId: 'cccccccc-1111-1111-1111-111111111111',
    adminRole: null,
  },
  {
    id: 'aaaaaaaa-5555-5555-5555-555555555555',
    email: '201555555555@centerhq.local',
    password: '555555',
    phone: '+201555555555',
    name: 'سعيد البسيط',
    userRole: 'owner',
    centerId: 'cccccccc-2222-2222-2222-222222222222',
    adminRole: null,
  },
  {
    id: 'aaaaaaaa-6666-6666-6666-666666666666',
    email: '201666666666@centerhq.local',
    password: '666666',
    phone: '+201666666666',
    name: 'Test Assistant 2',
    userRole: 'assistant',
    centerId: 'cccccccc-2222-2222-2222-222222222222',
    adminRole: null,
  },
];

for (const u of accounts) {
  await supabase.from('users').delete().eq('id', u.id);
  await supabase.from('admin_users').delete().eq('id', u.id);
  await supabase.auth.admin.deleteUser(u.id);

  const { data: created, error: authErr } = await supabase.auth.admin.createUser({
    id: u.id,
    email: u.email,
    password: u.password,
    email_confirm: true,
    phone_confirm: true,
  });

  if (authErr || !created?.user) {
    console.error(`x auth ${u.email}: ${authErr?.message ?? 'no user returned'}`);
    continue;
  }

  const { error: insUsersErr } = await supabase.from('users').insert({
    id: u.id,
    center_id: u.centerId,
    role: u.userRole,
    phone: u.phone,
    name: u.name,
    pin_code: u.password,
    preferred_locale: 'ar',
    can_scan: true,
    can_view_payments: true,
    can_record_payments: true,
    can_view_dashboard: true,
    can_view_revenue: true,
    can_manage_students: true,
    can_manage_groups: true,
    can_manage_rooms: true,
    can_view_schedule: true,
    can_view_settings: true,
    can_allow_late_entry: true,
    is_active: true,
  });

  if (insUsersErr) {
    console.error(`x users(insert) ${u.email}: ${insUsersErr.message}`);
    continue;
  }

  if (u.adminRole != null) {
    const { error: insAdminErr } = await supabase.from('admin_users').insert({
      id: u.id,
      name: u.name,
      email: u.email,
      role: u.adminRole,
      phone: u.phone,
      custom_permissions: [],
    });
    if (insAdminErr) {
      console.error(`x admin_users(insert) ${u.email}: ${insAdminErr.message}`);
      continue;
    }
  }

  console.log(`OK ${u.email}`);
}
