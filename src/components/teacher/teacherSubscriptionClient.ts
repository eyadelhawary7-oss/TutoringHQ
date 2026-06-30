'use client';

import { supabase } from '@/lib/supabase';
import { getCsrfHeaders } from '@/lib/csrf-client';

export type TeacherSubscriptionStatus = {
  has_subscription: boolean;
  status: string | null;
  plan_key: string;
  price_gross: number;
  std_price_gross: number;
  pro_price_gross: number;
  payments_enabled: boolean;
  trial_ends_at: string | null;
  current_period_start: string | null;
  current_period_end: string | null;
  next_billing_at: string | null;
  grace_until: string | null;
  free_months_credit: number;
  blast_credits_purchased: number;
  blast_credits_subscription: number;
  annual_multiplier?: number;
  billing_interval?: 'monthly' | 'annual';
};

/** Fetch the teacher's subscription + credits state. Returns null if signed out or on error. */
export async function fetchTeacherSubscription(): Promise<TeacherSubscriptionStatus | null> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return null;
  const res = await fetch('/api/teacher/subscription/status', {
    headers: { Authorization: `Bearer ${session.access_token}` },
  });
  if (!res.ok) return null;
  return (await res.json()) as TeacherSubscriptionStatus;
}

/**
 * Authenticated POST helper for teacher subscription mutations (CSRF attached).
 * Returns the raw Response so callers can branch on status codes (503/429/422).
 */
export async function teacherSubscriptionPost(
  path: string,
  body?: unknown,
): Promise<Response | null> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return null;
  return fetch(path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
      ...(await getCsrfHeaders(session.access_token)),
    },
    body: JSON.stringify(body ?? {}),
  });
}
