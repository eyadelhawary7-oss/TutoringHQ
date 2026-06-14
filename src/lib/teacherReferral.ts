import crypto from 'crypto';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Teacher referral loop (Item 4). SEPARATE namespace from the center referral
 * program: teacher codes live in teacher_profiles.referral_code (UNIQUE) and
 * the referral graph in teacher_profiles.referred_by_teacher_id. None of the
 * five center referral tables are touched here.
 *
 * Three concerns, all directly callable so they can be unit-tested without a
 * live Paymob event:
 *   1. generation  - every teacher gets a unique, name-derived, uppercase code.
 *   2. resolution  - turn a typed/`?ref` code into the referrer's user_id.
 *   3. grant       - on the referee's FIRST cleared charge, +1 free month to
 *                    both parties, exactly once per referee lifetime.
 */

// Ambiguous glyphs (0/O, 1/I/L) dropped so a code is safe to read aloud / type.
const SUFFIX_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const FALLBACK_PREFIX = 'TEACHER';
const MAX_PREFIX_LEN = 6;

function randomSuffix(len: number): string {
  let out = '';
  for (let i = 0; i < len; i += 1) {
    out += SUFFIX_ALPHABET[crypto.randomInt(SUFFIX_ALPHABET.length)];
  }
  return out;
}

/**
 * Derive the alphabetic prefix from a display name's first token. Arabic (and
 * any non-ASCII) is stripped; if nothing usable remains we fall back to a
 * neutral prefix so an Arabic-only or empty name still yields a valid code.
 */
export function teacherReferralPrefix(displayName: string | null | undefined): string {
  const firstToken = String(displayName ?? '').trim().split(/\s+/)[0] ?? '';
  const ascii = firstToken
    .normalize('NFKD')
    .replace(/[^A-Za-z0-9]/g, '')
    .toUpperCase();
  if (!ascii) return FALLBACK_PREFIX;
  return ascii.slice(0, MAX_PREFIX_LEN);
}

/** One candidate code: NAME-derived prefix + random suffix (e.g. "AHMED7X"). */
export function generateTeacherReferralCodeCandidate(
  displayName: string | null | undefined,
  suffixLen = 2,
): string {
  return teacherReferralPrefix(displayName) + randomSuffix(Math.max(2, suffixLen));
}

/**
 * Generate a code that does not already exist on teacher_profiles.referral_code.
 * Never throws and always returns a code: on a transient lookup error it simply
 * moves on (the DB UNIQUE index is the final backstop), and the suffix grows
 * with each attempt so collisions are exhausted quickly. A teacher with no
 * usable ASCII name gets the neutral "TEACHER…" prefix.
 */
export async function createUniqueTeacherReferralCode(
  supabase: SupabaseClient,
  displayName: string | null | undefined,
): Promise<string> {
  const prefix = teacherReferralPrefix(displayName);
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const suffixLen = attempt < 6 ? 2 : attempt < 10 ? 3 : 4;
    const candidate = prefix + randomSuffix(suffixLen);
    try {
      const { data, error } = await supabase
        .from('teacher_profiles')
        .select('user_id')
        .eq('referral_code', candidate)
        .maybeSingle();
      // On a lookup error we cannot confirm uniqueness; skip to a fresh candidate
      // rather than risk colliding (or blocking signup).
      if (!error && !data) return candidate;
    } catch {
      /* fall through to the next attempt */
    }
  }
  // Astronomically unlikely: a long random suffix all but guarantees uniqueness.
  return prefix + randomSuffix(8);
}

/**
 * Resolve a referral code to the referring teacher's user_id, or null. Mirrors
 * the center signup behaviour: trim + uppercase the input, single-source lookup,
 * and an invalid/empty/unknown code is silently ignored (returns null, never
 * throws) so it can never block a signup.
 */
export async function resolveTeacherReferralCode(
  supabase: SupabaseClient,
  code: unknown,
): Promise<string | null> {
  const clean = typeof code === 'string' ? code.trim().toUpperCase() : '';
  if (!clean) return null;
  try {
    const { data, error } = await supabase
      .from('teacher_profiles')
      .select('user_id')
      .eq('referral_code', clean)
      .maybeSingle();
    if (error || !data) return null;
    return (data as { user_id: string | null }).user_id ?? null;
  } catch {
    return null;
  }
}

export type GrantReferralResult = {
  granted: boolean;
  reason:
    | 'granted'
    | 'no_referee'
    | 'no_profile'
    | 'not_referred'
    | 'self_referral'
    | 'no_subscription'
    | 'already_rewarded'
    | 'error';
  referrerId?: string | null;
  referrerCredited?: boolean;
};

/**
 * Flat referral reward (Path A): when a referred teacher clears their FIRST real
 * charge, grant +1 free_months_credit to BOTH the referee and the referrer.
 *
 * Fired from combinedPaymentFinalize (the only cleared-charge point) AFTER the
 * subscription write succeeds, for both the teacher_resubscribe and
 * teacher_upgrade branches. Trial start is NOT a charge (the provisioning
 * trigger never goes through finalize), so a trialing teacher is never rewarded.
 *
 * Idempotency: the durable marker teacher_subscriptions.referral_rewarded_at
 * gates the whole thing - a re-delivered webhook or any later charge finds the
 * marker set and no-ops. The marker is written in the SAME conditional UPDATE
 * (guarded `referral_rewarded_at IS NULL`) that grants the referee's credit, so
 * two concurrent finalizes cannot both grant.
 *
 * Anti-abuse: no grant when referred_by_teacher_id is null, or when referrer ==
 * referee (self-referral), or when the marker is already set. Exactly one grant
 * per referee, ever.
 *
 * Plain UPDATEs throughout: the lifecycle guard only blocks status changes, so
 * free_months_credit / referral_rewarded_at writes pass with no RPC or flag.
 * Consumption (record_subscription_payment decrementing free_months_credit) is
 * already built and is NOT touched here.
 */
export async function grantReferralReward(
  supabase: SupabaseClient,
  refereeTeacherId: string | null | undefined,
): Promise<GrantReferralResult> {
  if (!refereeTeacherId) return { granted: false, reason: 'no_referee' };

  // 1. Who referred this teacher? (referral graph lives on teacher_profiles.)
  const { data: profile, error: profErr } = await supabase
    .from('teacher_profiles')
    .select('referred_by_teacher_id')
    .eq('user_id', refereeTeacherId)
    .maybeSingle();
  if (profErr || !profile) return { granted: false, reason: 'no_profile' };
  const referrerId = (profile as { referred_by_teacher_id: string | null })
    .referred_by_teacher_id;
  if (!referrerId) return { granted: false, reason: 'not_referred' };
  if (referrerId === refereeTeacherId) return { granted: false, reason: 'self_referral' };

  // 2. Referee subscription: idempotency marker + current credit.
  const { data: refereeSub, error: subErr } = await supabase
    .from('teacher_subscriptions')
    .select('id, free_months_credit, referral_rewarded_at')
    .eq('teacher_id', refereeTeacherId)
    .maybeSingle();
  if (subErr || !refereeSub) return { granted: false, reason: 'no_subscription' };
  const sub = refereeSub as {
    id: string;
    free_months_credit: number | null;
    referral_rewarded_at: string | null;
  };
  if (sub.referral_rewarded_at) return { granted: false, reason: 'already_rewarded' };

  // 3. Grant the referee + set the marker in one conditional UPDATE. The
  //    `referral_rewarded_at IS NULL` guard + .select() row count make this safe
  //    against a concurrent finalize: the loser updates 0 rows and bails.
  const nowIso = new Date().toISOString();
  const { data: updatedRows, error: refereeUpdErr } = await supabase
    .from('teacher_subscriptions')
    .update({
      free_months_credit: Number(sub.free_months_credit ?? 0) + 1,
      referral_rewarded_at: nowIso,
    })
    .eq('id', sub.id)
    .is('referral_rewarded_at', null)
    .select('id');
  if (refereeUpdErr) return { granted: false, reason: 'error' };
  if (!updatedRows || (updatedRows as unknown[]).length === 0) {
    // Lost the race: another finalize already rewarded this referee.
    return { granted: false, reason: 'already_rewarded' };
  }

  // 4. Grant the referrer (+1) - best effort. A referrer who has not yet created
  //    a subscription row (no private group yet) simply has no row to credit;
  //    the referee grant + marker still stand.
  let referrerCredited = false;
  const { data: referrerSub } = await supabase
    .from('teacher_subscriptions')
    .select('id, free_months_credit')
    .eq('teacher_id', referrerId)
    .maybeSingle();
  if (referrerSub) {
    const rSub = referrerSub as { id: string; free_months_credit: number | null };
    const { error: referrerUpdErr } = await supabase
      .from('teacher_subscriptions')
      .update({ free_months_credit: Number(rSub.free_months_credit ?? 0) + 1 })
      .eq('id', rSub.id);
    referrerCredited = !referrerUpdErr;
  }

  // Audit (best-effort; the grant itself already succeeded).
  await supabase.from('audit_log').insert({
    action: 'teacher_referral_rewarded',
    entity_type: 'teacher_subscription',
    entity_id: sub.id,
    user_id: refereeTeacherId,
    center_id: null,
    details: {
      referrer_teacher_id: referrerId,
      referrer_credited: referrerCredited,
      free_months_granted: 1,
      rewarded_at: nowIso,
    },
  });

  return { granted: true, reason: 'granted', referrerId, referrerCredited };
}
