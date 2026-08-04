'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import type { ValifyUnconfiguredCause } from '@/lib/valifyGuardLogic';
import type { EffectiveVerification } from '@/lib/verificationState';

/**
 * Admin-side accessor for whether identity verification is live at all.
 *
 * Same fail-closed contract as `useVerificationState`: never null, never
 * optimistic, and every failure mode resolves to `unconfigured` with a named
 * cause. An admin screen that cannot reach this endpoint must not draw
 * "Connected".
 *
 * Shape is A's `EffectiveVerification`, the same type the server-side state
 * machine returns, so the admin surfaces and the provider surfaces read one
 * vocabulary.
 */
function unconfigured(cause: ValifyUnconfiguredCause): EffectiveVerification {
  return {
    state: 'unconfigured',
    cause,
    isVerified: false,
    canStartVerification: false,
    verified_at: null,
    last_outcome: null,
  };
}

const STATES = ['unconfigured', 'unverified', 'pending', 'verified', 'rejected'] as const;
const CAUSES = ['valify_not_configured', 'verification_schema_not_applied'] as const;

export function useAdminVerificationAvailability(): {
  state: EffectiveVerification;
  loading: boolean;
} {
  const [state, setState] = useState<EffectiveVerification>(() =>
    unconfigured('valify_not_configured'),
  );
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();
        if (cancelled) return;
        const res = await fetch('/api/admin/verification/availability', {
          headers: session ? { Authorization: `Bearer ${session.access_token}` } : undefined,
        });
        if (cancelled) return;
        if (!res.ok) {
          setState(unconfigured('valify_not_configured'));
          return;
        }
        const json = (await res.json()) as { state?: Record<string, unknown> };
        if (cancelled) return;
        const s = json.state;
        if (
          !s ||
          typeof s.state !== 'string' ||
          !(STATES as readonly string[]).includes(s.state) ||
          typeof s.isVerified !== 'boolean'
        ) {
          setState(unconfigured('valify_not_configured'));
          return;
        }
        setState({
          state: s.state as EffectiveVerification['state'],
          cause:
            typeof s.cause === 'string' && (CAUSES as readonly string[]).includes(s.cause)
              ? (s.cause as ValifyUnconfiguredCause)
              : null,
          isVerified: s.isVerified === true && s.state === 'verified',
          canStartVerification: s.canStartVerification === true,
          verified_at: typeof s.verified_at === 'string' ? s.verified_at : null,
          last_outcome: null,
        });
      } catch {
        if (!cancelled) setState(unconfigured('valify_not_configured'));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return { state, loading };
}
