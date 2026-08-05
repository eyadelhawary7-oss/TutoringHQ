import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';
import { getBranchAddonMonthlyPrice } from '@/lib/pricingConfig';
import { parseBodyWithLimit } from '@/lib/validate';
import { centerAccessGateResponse } from '@/lib/centerAccessGate';
import { validateCSRFRequest } from '@/lib/csrf';

async function getAuthContext(request: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceKey) return null;

  const authHeader = request.headers.get('Authorization');
  const accessToken = authHeader?.replace('Bearer ', '');
  if (!accessToken) return null;

  const supabaseAuth = createClient(supabaseUrl, supabaseAnonKey, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });

  const { data: { user }, error } = await supabaseAuth.auth.getUser();
  if (error || !user) return null;

  const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { persistSession: false },
  });

  const { data: userRecord } = await supabaseAdmin
    .from('users')
    .select('id, center_id, organization_id')
    .eq('id', user.id)
    .maybeSingle();

  if (!userRecord) return null;

  let orgId = (userRecord as { organization_id?: string }).organization_id;
  const centerId = (userRecord as { center_id?: string | null }).center_id ?? null;
  if (!orgId && centerId) {
    const { data: center } = await supabaseAdmin
      .from('centers')
      .select('organization_id')
      .eq('id', centerId)
      .maybeSingle();
    orgId = (center as { organization_id?: string } | null)?.organization_id ?? undefined;
  }
  if (!orgId) {
    return { organizationId: null, userId: user.id, supabaseAdmin, centerId };
  }

  return { organizationId: orgId, userId: user.id, supabaseAdmin, centerId };
}

/** POST: Add a new branch (center) to the user's organization. Owner only. */
export async function POST(request: NextRequest) {
  try {
    const ctx = await getAuthContext(request);
    if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    // Fail-closed CSRF on this state-changing POST (creates a center). Same pattern as the
    // pay route: validateCSRFRequest returns false when CSRF_SECRET is unset/malformed.
    if (!validateCSRFRequest(request, ctx.userId)) {
      return NextResponse.json({ error: 'Invalid CSRF token' }, { status: 403 });
    }

    const { organizationId, supabaseAdmin } = ctx;

    // Part 6 (CLOSE as leak): the hand-rolled auth here skipped the suspension /
    // lock gate. A locked centre must not add branches. Gate on the caller's centre.
    if (ctx.centerId) {
      const gate = await centerAccessGateResponse(supabaseAdmin, ctx.centerId);
      if (gate) return gate;
    }

    if (!organizationId) {
      return NextResponse.json(
        { error: 'Multi-branch requires an organization. Your centre may need a data migration.' },
        { status: 400 },
      );
    }

    const { data: userRecord } = await supabaseAdmin
      .from('users')
      .select('role')
      .eq('id', ctx.userId)
      .maybeSingle();

    if ((userRecord as { role?: string } | null)?.role !== 'owner') {
      return NextResponse.json({ error: 'Only owners can add branches' }, { status: 403 });
    }

    const body = (await parseBodyWithLimit(request, 65536).catch(() => ({}))) as Record<string, unknown>;
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name || name.length < 2) {
      return NextResponse.json({ error: 'Branch name required (min 2 characters)' }, { status: 400 });
    }
    // The design's "Area / address" field. It maps to the EXISTING
    // `centers.district` (text, nullable) — there is no `centers.address`
    // column in the live catalog and none may be added here. Optional: a branch
    // with no area recorded is valid, and stores NULL rather than ''.
    const districtRaw = typeof body.district === 'string' ? body.district.trim() : '';
    const district = districtRaw.length > 0 ? districtRaw.slice(0, 200) : null;

    // Get first center in org for the NON-MONEY defaults a branch inherits.
    // `billing_amount` / `all_in_price` are deliberately NOT read here — see below.
    const { data: firstCenter } = await supabaseAdmin
      .from('centers')
      .select('plan, billing_type, billing_period, phone, owner_name')
      .eq('organization_id', organizationId)
      .limit(1)
      .maybeSingle();

    const fc = firstCenter as {
      plan?: string;
      billing_type?: string;
      billing_period?: string;
      phone?: string;
      owner_name?: string;
    } | null;

    /**
     * D23 FIX — a branch is an ADD-ON, not a second subscription.
     *
     * This route used to clone the parent's `billing_amount` and `all_in_price`
     * onto the new branch's own `centers` row. That was wrong in two distinct,
     * separately harmful ways:
     *
     *  1. **MRR double-count (live today).** `getImpliedMonthlyMrr` counts any
     *     centre row by `status` + `is_test` alone (`src/lib/pricing.ts`), so a
     *     cloned branch added a whole second plan price to admin/CEO subscription
     *     MRR — a reported-revenue figure inflated by a branch nobody billed.
     *  2. **A latent second invoice.** The row carried a full plan price while
     *     only `next_payment_due IS NULL` kept `runSubscriptionBillingCron` from
     *     invoicing it. Any path that later stamped a due date on a branch would
     *     have started charging the org twice, silently and correctly-looking.
     *
     * A branch therefore stores **no independent price**: `billing_amount` 0 and
     * `all_in_price` NULL, and (as before) no `next_payment_due`. The org's charge
     * for it is the flat add-on, added to the PRIMARY centre's existing renewal
     * invoice by `runSubscriptionBillingCron` — one org, one subscription, one
     * invoice, one processing fee.
     *
     * `plan` is still inherited: it is NOT NULL in the live catalog and drives
     * feature entitlement (capacity caps etc.), which a branch genuinely shares
     * with its parent. It no longer implies a price, because the price columns
     * it used to be read alongside are now empty.
     */
    const insert: Record<string, unknown> = {
      name,
      organization_id: organizationId,
      plan: fc?.plan ?? 'starter',
      billing_type: fc?.billing_type ?? 'fixed',
      billing_period: fc?.billing_period ?? 'monthly',
      billing_amount: 0,
      all_in_price: null,
      status: 'active',
      owner_name: fc?.owner_name ?? '',
      phone: fc?.phone ?? null,
      district,
    };

    const { data: newCenter, error } = await supabaseAdmin
      .from('centers')
      .insert(insert)
      .select('id, name')
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Update org plan to 'multi' if this is the first additional branch
    const { count } = await supabaseAdmin
      .from('centers')
      .select('*', { count: 'exact', head: true })
      .eq('organization_id', organizationId);

    if ((count ?? 0) >= 2) {
      await supabaseAdmin
        .from('organizations')
        .update({ plan: 'multi' })
        .eq('id', organizationId);
    }

    return NextResponse.json({ branch: newCenter });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

/**
 * PATCH: Rename a branch / set its area. Owner only, CSRF-required, and
 * org-scoped: the target centre must belong to the caller's organization —
 * a centre id from another tenant is a 404, indistinguishable from "gone".
 *
 * This exists so the Branches screen's Edit action works on EVERY branch of
 * the org. The legacy /api/db proxy force-scopes `centers` writes to the
 * caller's OWN centre (and new proxy callers are banned), so without this
 * route a sibling branch could never be renamed.
 */
export async function PATCH(request: NextRequest) {
  try {
    const ctx = await getAuthContext(request);
    if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    if (!validateCSRFRequest(request, ctx.userId)) {
      return NextResponse.json({ error: 'Invalid CSRF token' }, { status: 403 });
    }

    const { organizationId, supabaseAdmin } = ctx;

    // Same suspension / lock gate as POST: a locked centre must not edit branches.
    if (ctx.centerId) {
      const gate = await centerAccessGateResponse(supabaseAdmin, ctx.centerId);
      if (gate) return gate;
    }

    if (!organizationId) {
      return NextResponse.json(
        { error: 'Multi-branch requires an organization. Your centre may need a data migration.' },
        { status: 400 },
      );
    }

    const { data: userRecord } = await supabaseAdmin
      .from('users')
      .select('role')
      .eq('id', ctx.userId)
      .maybeSingle();

    if ((userRecord as { role?: string } | null)?.role !== 'owner') {
      return NextResponse.json({ error: 'Only owners can edit branches' }, { status: 403 });
    }

    const body = (await parseBodyWithLimit(request, 65536).catch(() => ({}))) as Record<string, unknown>;
    const id = typeof body.id === 'string' ? body.id.trim() : '';
    if (!id) {
      return NextResponse.json({ error: 'Branch id required' }, { status: 400 });
    }

    const updates: Record<string, unknown> = {};
    if (body.name !== undefined) {
      const name = typeof body.name === 'string' ? body.name.trim() : '';
      if (!name || name.length < 2) {
        return NextResponse.json({ error: 'Branch name required (min 2 characters)' }, { status: 400 });
      }
      updates.name = name;
    }
    if (body.district !== undefined) {
      // Same mapping as POST: the design's "Area / address" is the existing
      // `centers.district` (verified live) — never a new address column.
      const districtRaw = typeof body.district === 'string' ? body.district.trim() : '';
      updates.district = districtRaw.length > 0 ? districtRaw.slice(0, 200) : null;
    }
    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });
    }

    // ORG SCOPE, enforced in the WHERE clause itself: the update matches only a
    // centre that carries the caller's organization_id. Zero rows back = not
    // yours or not there; both answer 404.
    const { data: updated, error } = await supabaseAdmin
      .from('centers')
      .update(updates)
      .eq('id', id)
      .eq('organization_id', organizationId)
      .select('id, name, district')
      .maybeSingle();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    if (!updated) {
      return NextResponse.json({ error: 'Branch not found' }, { status: 404 });
    }

    try {
      await supabaseAdmin.from('audit_log').insert({
        center_id: id,
        user_id: ctx.userId,
        action: 'branch_update',
        entity_type: 'centers',
        entity_id: id,
        details: updates,
      });
    } catch (auditErr) {
      console.error('[PATCH /api/branches] audit_log', auditErr);
    }

    return NextResponse.json({ branch: updated });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

/** GET: List all branches (centers) in the user's organization. Respects branch_user_assignments. */
export async function GET(request: NextRequest) {
  try {
    const ctx = await getAuthContext(request);
    if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { organizationId, userId, supabaseAdmin, centerId } = ctx;

    // Part 6 (CLOSE as leak): inherit the suspension / lock gate the hand-rolled
    // auth skipped. A locked centre sees only the invoice and a pay button.
    if (centerId) {
      const gate = await centerAccessGateResponse(supabaseAdmin, centerId);
      if (gate) return gate;
    }

    if (!organizationId) {
      if (centerId) {
        const { data: singleCenter, error: cErr } = await supabaseAdmin
          .from('centers')
          .select('id, name, logo_url, district, created_at')
          .eq('id', centerId)
          .maybeSingle();
        if (cErr) {
          return NextResponse.json({ error: cErr.message }, { status: 500 });
        }
        return NextResponse.json({
          branches: singleCenter ? [singleCenter] : [],
          plan: 'single',
        });
      }
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get centers in org. If user has branch_user_assignments for this org, filter to those only.
    const { data: assignments } = await supabaseAdmin
      .from('branch_user_assignments')
      .select('center_id')
      .eq('user_id', userId)
      .eq('organization_id', organizationId);

    const hasAssignments = (assignments?.length ?? 0) > 0;
    const assignedCenterIds = (assignments ?? []).map((a) => a.center_id);

    // `created_at` feeds the client's "main branch" tag — the org's OLDEST
    // centre. There is no primary/main marker column in the live catalog
    // (organizations has none; adding one is a recorded migration ask), so the
    // derivation is documented rather than invented.
    let query = supabaseAdmin
      .from('centers')
      .select('id, name, logo_url, district, created_at')
      .eq('organization_id', organizationId)
      .order('name');

    if (hasAssignments) {
      query = query.in('id', assignedCenterIds);
    }

    const { data: centers, error } = await query;

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Get org plan + name. `organizations.name` is NOT NULL in the live catalog
    // but the row itself can be missing, so the caller still needs a fallback.
    const { data: org } = await supabaseAdmin
      .from('organizations')
      .select('plan, name')
      .eq('id', organizationId)
      .single();

    /**
     * THE ONE CONFIG POINT for the design's "Extra branch add-on" notice:
     * platform_config key `branch_addon.monthly_price_egp`, read through the
     * shared `getBranchAddonMonthlyPrice()` so the price a centre is SHOWN here
     * is read from the same place the billing engine CHARGES from — the two can
     * never drift apart.
     *
     * The key does not exist live (re-verified 2026-08-05), so this returns null,
     * the client renders no price notice, and `runSubscriptionBillingCron` adds
     * exactly 0.00 to the invoice. Setting the key turns both on together, with
     * no code change. Never an invented 199.
     */
    const branchAddonMonthlyPriceEgp = await getBranchAddonMonthlyPrice();

    return NextResponse.json({
      branches: centers ?? [],
      plan: (org as { plan?: string } | null)?.plan ?? 'single',
      organization_name: (org as { name?: string } | null)?.name ?? null,
      branch_addon_monthly_price_egp: branchAddonMonthlyPriceEgp,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
