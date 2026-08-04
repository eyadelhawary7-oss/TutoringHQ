'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import type { ValifyUnconfiguredCause } from '@/lib/valifyGuardLogic';
import type { EffectiveVerification, VerificationOutcome } from '@/lib/verificationState';

/**
 * Client-side accessor for the caller's own verification state.
 *
 * Every verification-aware surface uses this hook and NOTHING ELSE. No screen
 * re-derives verification from a plan name, a config flag, a feature toggle or a
 * locally cached boolean. One fetch, one state machine, one answer.
 *
 * THE ENDPOINT IS `GET /api/verification/status`. It used to be
 * `GET /api/verification/state`; two endpoints answered the same question with
 * different response shapes, and that one is deleted. The shape here is A's
 * `EffectiveVerification` — the same type the server-side state machine returns,
 * so client and server cannot describe the same provider differently.
 *
 * FAILS CLOSED, ALWAYS. Network error, 401, malformed body, still loading — all
 * of them resolve to `state: 'unconfigured'` with a named cause, never to
 * `verified` and never to a bare `null` a caller might treat as "fine". The worst
 * outcome this feature can produce is a green checkmark backed by no integration,
 * so there is no code path here that can produce one: `isVerified` is only ever
 * set from the server's own `isVerified` boolean, and every other exit sets it
 * false.
 *
 * The type-only imports above are erased at compile time, so pulling
 * `verificationState.ts` and `valifyGuardLogic.ts` in here costs nothing at
 * runtime and puts no server env read into the client bundle.
 */

/** The `EffectiveVerification` returned while the fetch is in flight, and on every failure. */
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
const OUTCOMES = ['passed', 'failed', 'abandoned', 'expired', 'provider_error'] as const;
const CAUSES = ['valify_not_configured', 'verification_schema_not_applied'] as const;

/**
 * Parse a response body into the state machine's own type.
 *
 * Every field is checked. An unrecognised `state` is not coerced to something
 * convenient — it returns null and the caller falls back to unconfigured, which
 * is the only reading of "we do not understand the server" that cannot lie.
 */
function parseEffective(body: unknown): EffectiveVerification | null {
  if (body == null || typeof body !== 'object') return null;
  const b = body as Record<string, unknown>;
  if (typeof b.state !== 'string' || !(STATES as readonly string[]).includes(b.state)) return null;
  if (typeof b.isVerified !== 'boolean') return null;
  const cause =
    typeof b.cause === 'string' && (CAUSES as readonly string[]).includes(b.cause)
      ? (b.cause as ValifyUnconfiguredCause)
      : null;
  const lastOutcome =
    typeof b.lastOutcome === 'string' && (OUTCOMES as readonly string[]).includes(b.lastOutcome)
      ? (b.lastOutcome as VerificationOutcome)
      : null;
  return {
    state: b.state as EffectiveVerification['state'],
    cause,
    // The server already guarantees this, but a client that re-derives the one
    // dangerous boolean from the state string as well costs nothing and closes
    // the case where a proxy or a future revision hands back a mismatched pair.
    isVerified: b.isVerified === true && b.state === 'verified',
    canStartVerification: b.canStartVerification === true,
    verified_at: typeof b.verifiedAt === 'string' ? b.verifiedAt : null,
    last_outcome: lastOutcome,
  };
}

export type VerificationSubjectKind = 'center' | 'teacher';

export type UseVerificationStateResult = {
  /** Never null. Unconfigured-with-cause until proven otherwise. */
  state: EffectiveVerification;
  subjectKind: VerificationSubjectKind | null;
  loading: boolean;
};

export function useVerificationState(): UseVerificationStateResult {
  const [state, setState] = useState<EffectiveVerification>(() =>
    unconfigured('valify_not_configured'),
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
          setState(unconfigured('valify_not_configured'));
          return;
        }
        const res = await fetch('/api/verification/status', {
          headers: { Authorization: `Bearer ${session.access_token}` },
        });
        if (cancelled) return;
        if (!res.ok) {
          setState(unconfigured('valify_not_configured'));
          return;
        }
        const json: unknown = await res.json();
        if (cancelled) return;
        const parsed = parseEffective(json);
        // A body we cannot parse is a failure, not an empty success.
        if (!parsed) {
          setState(unconfigured('valify_not_configured'));
          return;
        }
        const kind = (json as { subjectKind?: unknown }).subjectKind;
        setSubjectKind(kind === 'center' || kind === 'teacher' ? kind : null);
        setState(parsed);
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

  return { state, subjectKind, loading };
}
