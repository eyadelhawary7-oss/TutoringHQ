import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import * as Sentry from '@sentry/nextjs';
import type { CenterAuthOk } from '@/lib/centerAuth';

/**
 * Group proposal negotiation (teacher -> center) shared shapes and helpers.
 *
 * The negotiation state machine itself lives in the DB as
 * respond_group_proposal(p_proposal_id, p_actor_user_id, p_side, p_action,
 * p_cut_egp, p_note) - turn order, immutability of fee_per_class, the
 * append-only offer log and group creation on accept are all enforced there
 * (plus guard triggers). Routes do authn/authz + input validation and call
 * the RPC; both sides share the list-building below.
 */

export type ProposalRow = {
  id: string;
  teacher_id: string;
  center_id: string;
  subject: string;
  grade_level: string | null;
  fee_per_class: number | string;
  status: string;
  /** Which side opened the negotiation. */
  initiated_by: 'teacher' | 'center';
  accepted_offer_id: string | null;
  opening_message: string | null;
  expires_at: string;
  created_at: string;
};

export const PROPOSAL_COLUMNS =
  'id, teacher_id, center_id, subject, grade_level, fee_per_class, status, initiated_by, accepted_offer_id, opening_message, expires_at, created_at';

export type OfferOut = {
  id: string;
  madeBy: 'teacher' | 'center';
  cutEgp: number;
  note: string | null;
  createdAt: string;
};

export type ProposalOut = {
  id: string;
  centerId: string;
  subject: string;
  gradeLevel: string | null;
  feePerClass: number;
  status: string;
  /** Which side opened the negotiation ('teacher' | 'center'). */
  initiatedBy: 'teacher' | 'center';
  openingMessage: string | null;
  expiresAt: string;
  createdAt: string;
  offerCount: number;
  latestOffer: OfferOut | null;
  /** 'teacher' | 'center' while open (opposite of the latest offer's maker), null otherwise. */
  whoseTurn: 'teacher' | 'center' | null;
  /** Full negotiation history, chronological. */
  offers: OfferOut[];
};

/** Money input: finite, within [min, 1,000,000], at most 2 decimals. */
export function isValidEgp(value: unknown, min: number): value is number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return false;
  if (value < min || value > 1_000_000) return false;
  return Math.abs(value * 100 - Math.round(value * 100)) < 1e-6;
}

type OfferRow = {
  id: string;
  proposal_id: string;
  made_by: 'teacher' | 'center';
  cut_egp: number | string;
  note: string | null;
  created_at: string;
};

/**
 * Decorate proposal rows with their offer history, latest offer, count and
 * whose turn it is. Offers are CORE data for the negotiation UI (the action
 * buttons depend on the latest offer's maker), so the caller treats an error
 * here as a 500 - this returns { error } instead of guessing.
 */
export async function buildProposalList(
  admin: SupabaseClient,
  proposals: ProposalRow[],
): Promise<{ items: ProposalOut[]; error: null } | { items: null; error: { message: string } }> {
  const byProposal = new Map<string, OfferOut[]>();
  if (proposals.length > 0) {
    const { data, error } = await admin
      .from('group_proposal_offers')
      .select('id, proposal_id, made_by, cut_egp, note, created_at')
      .in('proposal_id', proposals.map((p) => p.id))
      .order('created_at', { ascending: true });
    if (error) return { items: null, error };
    for (const raw of (data ?? []) as OfferRow[]) {
      const list = byProposal.get(raw.proposal_id) ?? [];
      list.push({
        id: raw.id,
        madeBy: raw.made_by,
        cutEgp: Number(raw.cut_egp) || 0,
        note: raw.note,
        createdAt: raw.created_at,
      });
      byProposal.set(raw.proposal_id, list);
    }
  }

  const items = proposals.map((p) => {
    const offers = byProposal.get(p.id) ?? [];
    const latest = offers.length > 0 ? offers[offers.length - 1] : null;
    const whoseTurn: ProposalOut['whoseTurn'] =
      p.status === 'open' && latest
        ? latest.madeBy === 'teacher'
          ? 'center'
          : 'teacher'
        : null;
    return {
      id: p.id,
      centerId: p.center_id,
      subject: p.subject,
      gradeLevel: p.grade_level,
      feePerClass: Number(p.fee_per_class) || 0,
      status: p.status,
      initiatedBy: (p.initiated_by === 'center' ? 'center' : 'teacher') as 'teacher' | 'center',
      openingMessage: p.opening_message,
      expiresAt: p.expires_at,
      createdAt: p.created_at,
      offerCount: offers.length,
      latestOffer: latest,
      whoseTurn,
      offers,
    };
  });
  return { items, error: null };
}

/**
 * Map respond_group_proposal RPC errors to HTTP. The RPC raises 23514 for
 * every business rejection with a distinguishing message, P0002 for a
 * vanished proposal. Anything else is infrastructure -> null (caller 500s).
 */
export function mapRespondRpcError(err: {
  code?: string;
  message?: string;
}): NextResponse | null {
  const code = err.code ?? '';
  const msg = err.message ?? '';
  if (code === 'P0002') {
    return NextResponse.json({ error: 'Not found', code: 'NOT_FOUND' }, { status: 404 });
  }
  if (code === '23514') {
    if (msg.includes('not your turn')) {
      return NextResponse.json(
        { error: 'Not your turn', code: 'NOT_YOUR_TURN' },
        { status: 409 },
      );
    }
    if (msg.includes('not open')) {
      return NextResponse.json(
        { error: 'Proposal is not open', code: 'NOT_OPEN' },
        { status: 409 },
      );
    }
    if (msg.includes('exceeds fee_per_class')) {
      return NextResponse.json(
        { error: 'Cut must be less than the fee per class', code: 'CUT_NOT_LESS_THAN_FEE' },
        { status: 400 },
      );
    }
    return NextResponse.json(
      { error: 'Cannot respond', code: 'CANNOT_RESPOND' },
      { status: 409 },
    );
  }
  return null;
}

const PROPOSAL_PRIVILEGED_ROLES = new Set(['owner', 'admin', 'super_admin']);

/**
 * Center-side gate shared by every owner/center proposal MUTATION (create a
 * proposal, respond to one). Owner/admin/super-admin pass; everyone else needs
 * users.can_manage_students. A mutation permission gate fails CLOSED on a
 * lookup error (Rule 149) - an unverifiable caller cannot commit the center to
 * a teacher relationship. Returns a 403 NextResponse to short-circuit, or null
 * when allowed.
 */
export async function ensureCanManageProposals(
  auth: CenterAuthOk,
  routeTag: string,
): Promise<NextResponse | null> {
  if (auth.isSuperAdmin || PROPOSAL_PRIVILEGED_ROLES.has(auth.role)) return null;

  const { data: permsRow, error: permsErr } = await auth.supabaseAdmin
    .from('users')
    .select('can_manage_students')
    .eq('id', auth.userId)
    .maybeSingle();
  if (permsErr) {
    Sentry.withScope((scope) => {
      scope.setTag('route', routeTag);
      scope.setTag('step', 'permission_flags');
      Sentry.captureMessage(
        `group-proposals permission lookup failed: ${permsErr.message}`,
        'warning',
      );
    });
  }
  const canManage =
    !permsErr &&
    (permsRow as { can_manage_students?: boolean | null } | null)?.can_manage_students === true;
  if (!canManage) {
    return NextResponse.json({ error: 'Forbidden', code: 'PERMISSION_REQUIRED' }, { status: 403 });
  }
  return null;
}
