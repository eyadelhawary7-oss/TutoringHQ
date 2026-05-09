'use client';

import { useCallback, useEffect, useRef } from 'react';
import type { BillingPeriod } from '@/lib/pricing';
import { toSignupIntlPhone } from '@/lib/signup/phoneIntl';

const SESSION_KEY = 'chq_pending_signup_v1';

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
    try {
      const raw = sessionStorage.getItem(SESSION_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Partial<PendingSignupFormState> & { stage?: SignupStage };
      const { stage, ...rest } = parsed;
      if (Object.keys(rest).length) {
        setForm((prev) => ({ ...prev, ...rest }));
      }
      if (stage === 'info' || stage === 'plan' || stage === 'payment') {
        setStage(stage);
      }
    } catch {
      //
    }
  }, [setForm, setStage]);

  const persist = useCallback(async (snapshot: PendingSignupFormState, stage: SignupStage, lastStep: number) => {
    try {
      sessionStorage.setItem(SESSION_KEY, JSON.stringify({ ...snapshot, stage }));
    } catch {
      //
    }
    try {
      const phone = toSignupIntlPhone(snapshot.phone);
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
