'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import type { VerificationState, VerificationUnavailableCause } from '@/lib/verification/state';

/**
 * Admin-side accessor for whether identity verification is live at all.
 *
 * Same fail-closed contract as `useVerificationState`: never null, never
 * optimistic, and every failure mode resolves to unavailable-with-a-cause. An
 * admin screen that cannot reach this endpoint must not draw "Connected".
 */
function unavailable(cause: VerificationUnavailableCause, detail: string): VerificationState {
  return { available: false, cause, detail };
}

export function useAdminVerificationAvailability(): {
  state: VerificationState;
  loading: boolean;
} {
  const [state, setState] = useState<VerificationState>(() =>
    unavailable('provider_not_configured', 'Verification availability has not loaded yet.'),
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
          setState(
            unavailable(
              'provider_not_configured',
              `Verification availability request failed with ${res.status}.`,
            ),
          );
          return;
        }
        const json = (await res.json()) as { state?: VerificationState };
        if (cancelled) return;
        if (!json.state || typeof json.state.available !== 'boolean') {
          setState(
            unavailable('provider_not_configured', 'Verification availability response malformed.'),
          );
          return;
        }
        setState(json.state);
      } catch {
        if (!cancelled) {
          setState(
            unavailable('provider_not_configured', 'Verification availability request threw.'),
          );
        }
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
