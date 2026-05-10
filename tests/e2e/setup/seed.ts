/**
 * Idempotent DB fixtures for e2e (service role).
 * Requires SUPABASE_SERVICE_ROLE_KEY + NEXT_PUBLIC_SUPABASE_URL + TEST_PHONE (to resolve centre).
 * Optional: TEST_CENTER_ID overrides centre lookup.
 *
 * Teardown: CLEANUP_TEST_DATA=1 removes rows tagged with notes e2e_seed:v1
 */
import { createClient } from '@supabase/supabase-js';
import type { SupabaseClient } from '@supabase/supabase-js';

const SEED_TAG = 'e2e_seed:v1';

const STUDENT_SPECS: { name: string; student_number: string }[] = [
  { name: 'Test Student 01', student_number: 'TEST-00001' },
  { name: 'Test Student 02', student_number: 'TEST-00002' },
  { name: 'Test Student 03', student_number: 'TEST-00003' },
  { name: 'Test Student 04', student_number: 'TEST-00004' },
  { name: 'Test Student 05', student_number: 'TEST-00005' },
  { name: 'Test Student No Card', student_number: 'TEST-NOCARD01' },
];

/** Paid order with blank lines only so roster students stay “without cards” for recommendations. */
const ORDER_PAID_ID = 'e2eca501-2001-4001-8001-000000000001';

function phoneLookupVariants(raw: string): string[] {
  const t = raw.trim();
  const digits = t.replace(/\D/g, '');
  const s = new Set<string>([t]);
  if (digits.length >= 10) {
    s.add(`+${digits}`);
    s.add(digits);
    if (digits.startsWith('0')) s.add(digits.replace(/^0+/, ''));
    if (digits.length > 10) s.add(`+${digits.slice(-10)}`);
  }
  return [...s];
}

type SeedAdmin = SupabaseClient<any, 'public', any>;

async function resolveCenterAndOwner(admin: SeedAdmin): Promise<{ centerId: string; ownerUserId: string | null } | null> {
  const explicit = process.env.TEST_CENTER_ID?.trim();
  if (explicit) {
    const { data: u } = await admin
      .from('users')
      .select('id')
      .eq('center_id', explicit)
      .limit(1)
      .maybeSingle();
    return { centerId: explicit, ownerUserId: (u as { id?: string } | null)?.id ?? null };
  }

  const phone = process.env.TEST_PHONE?.trim();
  if (!phone) return null;

  const variants = phoneLookupVariants(phone);
  const { data: userRow } = await admin
    .from('users')
    .select('id, center_id')
    .in('phone', variants)
    .not('center_id', 'is', null)
    .limit(1)
    .maybeSingle();

  const cid = (userRow as { center_id?: string | null } | null)?.center_id;
  const uid = (userRow as { id?: string | null } | null)?.id ?? null;
  if (!cid) return null;
  return { centerId: cid, ownerUserId: uid };
}

async function cleanupSeed(admin: SeedAdmin, centerId: string): Promise<void> {
  const { data: orders } = await admin.from('card_orders').select('id').eq('center_id', centerId).eq('notes', SEED_TAG);

  const ids = (orders ?? []).map((r) => (r as { id: string }).id).filter(Boolean);
  if (ids.length) {
    await admin.from('card_order_items').delete().in('card_order_id', ids);
    await admin.from('card_orders').delete().in('id', ids);
  }

  const nums = STUDENT_SPECS.map((s) => s.student_number);
  await admin.from('students').delete().eq('center_id', centerId).in('student_number', nums);
}

export async function seedE2EDatabase(): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.warn('[e2e seed] skipping — NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY unset');
    return;
  }

  const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }) as SeedAdmin;

  if (process.env.CLEANUP_TEST_DATA === '1') {
    const resolved = await resolveCenterAndOwner(admin);
    if (resolved) await cleanupSeed(admin, resolved.centerId);
    return;
  }

  const resolved = await resolveCenterAndOwner(admin);
  if (!resolved) {
    console.warn('[e2e seed] skipping — could not resolve centre (set TEST_CENTER_ID or TEST_PHONE)');
    return;
  }

  const { centerId, ownerUserId } = resolved;

  for (const st of STUDENT_SPECS) {
    const { data: existing } = await admin
      .from('students')
      .select('id')
      .eq('center_id', centerId)
      .eq('student_number', st.student_number)
      .maybeSingle();

    if (existing) continue;

    const { error } = await admin.from('students').insert({
      center_id: centerId,
      name: st.name,
      student_number: st.student_number,
      is_active: true,
      payment_status: 'unpaid',
    });

    if (error) {
      console.warn(`[e2e seed] student ${st.student_number}:`, error.message);
    }
  }

  const { data: paidExisting } = await admin.from('card_orders').select('id').eq('id', ORDER_PAID_ID).maybeSingle();

  if (!paidExisting) {
    const insertPaid: Record<string, unknown> = {
      id: ORDER_PAID_ID,
      center_id: centerId,
      created_by: ownerUserId,
      students: [],
      quantity: 2,
      price_per_card: 50,
      delivery_fee: 10,
      total_amount: 110,
      status: 'paid',
      payment_status: 'paid',
      refund_status: null,
      delivery_address: 'E2E Seed Address',
      delivery_governorate: 'cairo',
      delivery_phone: '+201012345678',
      notes: SEED_TAG,
      card_style: 'dark',
    };

    const { error: oErr } = await admin.from('card_orders').insert(insertPaid);
    if (oErr) {
      console.warn('[e2e seed] paid card_order:', oErr.message);
    } else {
      await admin.from('card_order_items').insert({
        card_order_id: ORDER_PAID_ID,
        kind: 'blank',
        student_id: null,
        quantity: 2,
      });
    }
  }
}
