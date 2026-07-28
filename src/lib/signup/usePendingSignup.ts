'use client';

import { useCallback, useEffect, useRef } from 'react';
import type { BillingPeriod } from '@/lib/pricing';
import { normalizePhone } from '@/lib/utils/phone';
import { memoryCacheGet, memoryCacheSet } from '@/lib/clientMemoryCache';

/**
 * In-memory (tab-scoped) handoff key for partially-entered signup data. This
 * snapshot carries PII (owner name, phone, email, city) so it is NEVER written
 * to sessionStorage/localStorage; the durable copy lives server-side via
 * /api/signup/persist. Exported so the login "resume signup" path can seed it.
 */
export const PENDING_SIGNUP_KEY = 'chq_pending_signup_v1';

export type PendingSignupFormState = {
  centerName: string;
  ownerName: string;
  phone: string;
  email: string;
  city: string;
  plan: string;
  billingPeriod: BillingPeriod;
  referralCode: string;
  notes: string;
};

export type SignupStage = 'info' | 'plan' | 'payment';

export function usePendingSignup(
  setForm: React.Dispatch<React.SetStateAction<PendingSignupFormState>>,
  setStage: React.Dispatch<React.SetStateAction<SignupStage>>,
) {
  const doneHydrate = useRef(false);

  useEffect(() => {
    if (typeof window === 'undefined' || doneHydrate.current) return;
    doneHydrate.current = true;
    const parsed = memoryCacheGet<Partial<PendingSignupFormState> & { stage?: SignupStage }>(
      PENDING_SIGNUP_KEY,
    );
    if (!parsed) return;
    const { stage, ...rest } = parsed;
    if (Object.keys(rest).length) {
      setForm((prev) => ({ ...prev, ...rest }));
    }
    if (stage === 'info' || stage === 'plan' || stage === 'payment') {
      setStage(stage);
    }
  }, [setForm, setStage]);

  const persist = useCallback(async (snapshot: PendingSignupFormState, stage: SignupStage, lastStep: number) => {
    memoryCacheSet(PENDING_SIGNUP_KEY, { ...snapshot, stage });
    try {
      const phone = normalizePhone(snapshot.phone);
      await fetch('/api/signup/persist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phone,
          email: snapshot.email || null,
          center_name: snapshot.centerName,
          owner_name: snapshot.ownerName,
          city: snapshot.city || null,
          plan_key: snapshot.plan,
          billing_period: snapshot.billingPeriod,
          referral_code: snapshot.referralCode || null,
          last_step_completed: lastStep,
        }),
      });
    } catch {
      //
    }
  }, []);

  return { persist };
}
