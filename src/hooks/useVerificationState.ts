'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import type {
  VerificationState,
  VerificationSubjectKind,
  VerificationUnavailableCause,
} from '@/lib/verification/state';

/**
 * Client-side accessor for the caller's own verification state.
 *
 * Every verification-aware surface uses this hook and NOTHING ELSE. No screen
 * re-derives verification from a plan name, a config flag, a feature toggle or
 * a locally cached boolean. One fetch, one state machine, one answer.
 *
 * FAILS CLOSED, ALWAYS. Network error, 401, malformed body, still loading — all
 * of them resolve to an `available: false` state with a named cause, never to
 * `verified` and never to a bare `null` a caller might treat as "fine". The
 * worst outcome this feature can produce is a green checkmark backed by no
 * integration, so there is no code path here that can produce one.
 */

/** The shape returned while the fetch is in flight, and on every failure. */
function unavailable(cause: VerificationUnavailableCause, detail: string): VerificationState {
  return { available: false, cause, detail };
}

export type UseVerificationStateResult = {
  /** Never null. Unavailable-with-cause until proven otherwise. */
  state: VerificationState;
  subjectKind: VerificationSubjectKind | null;
  loading: boolean;
};

export function useVerificationState(): UseVerificationStateResult {
  const [state, setState] = useState<VerificationState>(() =>
    unavailable('state_source_missing', 'Verification state has not loaded yet.'),
  );
  const [subjectKind, setSubjectKind] = useState<VerificationSubjectKind | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();
        if (cancelled) return;
        if (!session) {
          setState(
            unavailable('state_source_missing', 'No session; verification state not readable.'),
          );
          return;
        }
        const res = await fetch('/api/verification/state', {
          headers: { Authorization: `Bearer ${session.access_token}` },
        });
        if (cancelled) return;
        if (!res.ok) {
          setState(
            unavailable(
              'state_source_missing',
              `Verification state request failed with ${res.status}.`,
            ),
          );
          return;
        }
        const json = (await res.json()) as {
          subjectKind?: VerificationSubjectKind;
          state?: VerificationState;
        };
        if (cancelled) return;
        // A body without a usable state is a failure, not an empty success.
        if (!json.state || typeof json.state.available !== 'boolean') {
          setState(
            unavailable('state_source_missing', 'Verification state response was malformed.'),
          );
          return;
        }
        setSubjectKind(json.subjectKind ?? null);
        setState(json.state);
      } catch {
        if (!cancelled) {
          setState(unavailable('state_source_missing', 'Verification state request threw.'));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return { state, subjectKind, loading };
}
