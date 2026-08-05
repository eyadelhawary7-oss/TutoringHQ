// src/lib/pricing/branchAddon.ts
//
// The "extra branch" add-on (design `Merged-Center-Groups` §04, defect D23).
//
// ── WHY THIS IS CONFIG-DRIVEN AND NOT A HARDCODED 199 ────────────────────────
// 1. `docs/PRICING_SPEC.md` is the source of truth and its **Add-ons** section
//    lists exactly three products: `qr_card` (60), `parent_pack` (12) and
//    `blast` (9.80). There is no extra-branch price in it. Hardcoding 199 would
//    put a charged figure in code that the source-of-truth spec does not carry.
// 2. The design corpus contradicts itself on the number: `Merged-Center-Groups`
//    §04 draws "199 EGP/mo" while the `/pricing` add-ons section draws "extra
//    branch 299/mo" (recorded in `design/BUILD-AFTER-REDESIGN.md`). Two figures,
//    one product. Baking either into code picks one at random and calls it a
//    decision.
// 3. Repo convention: **plan anchors** are byte-locked constants
//    (`PLANS[].quarterlyAllIn`), but every **add-on / fee** price is read from
//    `platform_config` and snapshotted onto the invoice at charge time —
//    `processing_fee_amount`, `whatsappParentPack`, `cardOrderBase`. The branch
//    add-on is an add-on, so it follows the add-on convention.
//
// Consequence, and it is deliberate: there is **no default price**. An absent
// key means "not priced yet", NOT "free" and NOT "199". `getBranchAddonMonthlyPrice`
// returns `null`, the UI notice renders nothing, and the billing engine adds
// exactly 0.00 to the invoice. The feature is inert until Eyad inserts the row.
// This is the same fail-closed posture the notice already shipped with in #313.
//
// ── WHAT IS CHARGED ──────────────────────────────────────────────────────────
// A flat per-extra-branch monthly price, added to the ORG PRIMARY centre's
// existing subscription invoice as part of its VAT-inclusive base. It is NOT a
// second subscription and NOT a second invoice: one invoice, one flat 20 EGP
// processing fee, VAT computed on the whole inclusive total (money rules 3 + 13).

import { getAnnualChargeRounded, normalizeBillingPeriod, ANNUAL_BILLED_MONTHS_DEFAULT } from '@/lib/pricing';

/**
 * The ONE config point for the extra-branch add-on price, in EGP per month,
 * VAT-inclusive (like every other customer-facing price in this codebase).
 *
 * Minted by PR #313 for the add-branch notice; this module makes the same key
 * drive the actual charge, so the price a centre is shown and the price it is
 * billed can never diverge.
 */
export const BRANCH_ADDON_MONTHLY_PRICE_KEY = 'branch_addon.monthly_price_egp';

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Normalise a raw `platform_config` value into a usable price.
 *
 * Returns `null` for absent / non-numeric / non-positive values — there is no
 * fallback price on purpose (see module header). A `0` is treated as unpriced
 * rather than free so that a mistyped key can never silently bill nothing while
 * the UI claims a charge.
 */
export function normalizeBranchAddonPrice(raw: unknown): number | null {
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' ? parseFloat(raw) : NaN;
  if (!Number.isFinite(n) || n <= 0) return null;
  return round2(n);
}

/**
 * Billable extra branches for an organisation: every centre beyond the first.
 *
 * The org's first centre IS the subscription (it carries `all_in_price` and
 * `next_payment_due`); branches 2..N are add-ons. One centre → 0 extras → the
 * add-on never touches a single-branch org's invoice.
 */
export function billableExtraBranchCount(billableCentresInOrg: number): number {
  const n = Number(billableCentresInOrg);
  if (!Number.isFinite(n) || n <= 1) return 0;
  return Math.floor(n) - 1;
}

/**
 * The add-on amount (VAT-inclusive) to add to ONE renewal invoice.
 *
 * Annual centres are billed `monthly × annualMultiplier` (=10) for a 12-month
 * cycle — the same "pay 10, get 12" treatment the plan itself gets in
 * `centerRenewalBaseAmount`. Billing the add-on at ×12 while the plan bills ×10
 * would make the add-on quietly more expensive per month on annual than on
 * monthly, which is the opposite of how every other price in this system works.
 *
 * Returns 0 whenever the price is unset — the fail-closed path.
 */
export function branchAddonChargeForPeriod(opts: {
  extraBranches: number;
  monthlyPrice: number | null;
  billingPeriod: string | null | undefined;
  annualMultiplier?: number;
}): number {
  const rawExtras = Number(opts.extraBranches);
  const extras = Number.isFinite(rawExtras) && rawExtras > 0 ? Math.floor(rawExtras) : 0;
  const price = opts.monthlyPrice;
  if (price == null || price <= 0 || extras <= 0) return 0;

  const perMonth = round2(price * extras);
  if (normalizeBillingPeriod(opts.billingPeriod) === 'annual') {
    const mult =
      Number.isFinite(opts.annualMultiplier) && (opts.annualMultiplier as number) > 0
        ? (opts.annualMultiplier as number)
        : ANNUAL_BILLED_MONTHS_DEFAULT;
    return getAnnualChargeRounded(perMonth, mult);
  }
  return perMonth;
}

/**
 * Which centre in an org carries the add-on: the OLDEST by `created_at`, with
 * the id as a deterministic tiebreak.
 *
 * This matters. Without a single designated payer, an org whose branches each
 * carried a `next_payment_due` would have EVERY branch invoiced for the whole
 * org's extras — the same double-billing shape as the D23 clone this build
 * removes. Pinning the charge to one centre makes over-billing structurally
 * impossible rather than merely unlikely. "Oldest centre" is the same
 * main-branch derivation `GET /api/branches` already uses for its `Current`
 * badge, so the UI and the invoice agree on which row is the parent.
 */
export function resolvePrimaryCentreId(
  centres: readonly { id: string; created_at?: string | null }[],
): string | null {
  if (!centres || centres.length === 0) return null;
  const sorted = [...centres].sort((a, b) => {
    const at = a.created_at ? Date.parse(a.created_at) : Number.POSITIVE_INFINITY;
    const bt = b.created_at ? Date.parse(b.created_at) : Number.POSITIVE_INFINITY;
    if (Number.isFinite(at) && Number.isFinite(bt) && at !== bt) return at - bt;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
  return sorted[0]?.id ?? null;
}

/** The add-on snapshot persisted onto the invoice, so it reprints forever. */
export type BranchAddonSnapshot = {
  branch_addon_count: number;
  branch_addon_unit_price: number;
  branch_addon_total: number;
};

/**
 * Snapshot for `invoices.metadata`. Mirrors the `processing_fee` snapshot rule:
 * an issued invoice must always render from what it stored, never from live
 * config, so changing the price later never rewrites billing history.
 */
export function buildBranchAddonSnapshot(opts: {
  extraBranches: number;
  monthlyPrice: number | null;
  total: number;
}): BranchAddonSnapshot | null {
  if (opts.monthlyPrice == null || opts.total <= 0 || opts.extraBranches <= 0) return null;
  return {
    branch_addon_count: Math.floor(opts.extraBranches),
    branch_addon_unit_price: round2(opts.monthlyPrice),
    branch_addon_total: round2(opts.total),
  };
}
