// src/lib/collectionPayout/money.ts
//
// Minor-unit money for the payout ledger. PURE — no I/O, no Supabase, no Date.
//
// PAYOUT-SYSTEM-SPEC.md §3 invariant 1: "Every posting is in piastres, as an
// integer. No floats anywhere in the money path."
//
// The rest of this codebase speaks EGP decimals (numeric columns, Paymob
// payloads, the legacy withdrawal_requests / payout_requests tables). This
// module owns the boundary, and it is deliberately noisy about it: every
// conversion is a named function, so a piastres value can never be silently
// compared against an EGP one. §7.2 records that exact hazard — "a cap written
// as 10000 compared on the wrong side of the conversion is either 100 EGP or
// 1,000,000 EGP".
//
// Naming rule enforced by convention throughout Territory C: a variable holding
// piastres ends in `Minor`. A variable holding EGP ends in `Egp` or carries no
// suffix. There is no third unit.

/** 1 EGP = 100 piastres. */
export const MINOR_PER_EGP = 100;

export class MoneyUnitError extends Error {
  readonly cause: string;
  constructor(cause: string, message: string) {
    super(message);
    this.name = 'MoneyUnitError';
    this.cause = cause;
  }
}

/**
 * EGP decimal → piastres integer.
 *
 * THROWS on a non-finite input rather than coercing to 0. A silent zero in a
 * money path is a fabricated balance, which is the one outcome this whole
 * territory exists to prevent.
 */
export function egpToMinor(egp: number): number {
  const n = Number(egp);
  if (!Number.isFinite(n)) {
    throw new MoneyUnitError('non_finite_egp', `Not a finite EGP amount: ${String(egp)}`);
  }
  // Round half away from zero at the piastre, then assert integrality. Using
  // Math.round on (n * 100) alone drifts on values like 4.035 * 100 = 403.49999.
  const scaled = Math.round((n + Number.EPSILON * Math.sign(n || 1)) * MINOR_PER_EGP);
  if (!Number.isSafeInteger(scaled)) {
    throw new MoneyUnitError('minor_out_of_range', `EGP amount does not fit in piastres: ${n}`);
  }
  return scaled;
}

/** Piastres integer → EGP decimal, for display and for legacy numeric columns. */
export function minorToEgp(minor: number): number {
  assertMinor(minor);
  return Math.round(minor) / MINOR_PER_EGP;
}

/** Throws unless `minor` is a safe non-negative integer number of piastres. */
export function assertMinor(minor: number, label = 'amount'): asserts minor is number {
  if (!Number.isSafeInteger(minor)) {
    throw new MoneyUnitError('minor_not_integer', `${label} must be an integer piastre amount, got ${String(minor)}`);
  }
}

/** Throws unless `minor` is a safe integer >= 0. */
export function assertNonNegativeMinor(minor: number, label = 'amount'): void {
  assertMinor(minor, label);
  if (minor < 0) {
    throw new MoneyUnitError('minor_negative', `${label} must not be negative, got ${minor}`);
  }
}

/**
 * Sum piastre amounts. Integer-exact; no float accumulation.
 * An empty list sums to 0 — that is a true zero, not an unknown.
 */
export function sumMinor(amounts: number[]): number {
  let total = 0;
  for (const a of amounts) {
    assertMinor(a, 'entry');
    total += a;
    if (!Number.isSafeInteger(total)) {
      throw new MoneyUnitError('minor_out_of_range', 'Piastre sum exceeded safe integer range');
    }
  }
  return total;
}

/**
 * VAT already contained inside a VAT-INCLUSIVE piastre amount:
 *   vat = inclusive × r / (1 + r)
 *
 * Same arithmetic as src/lib/pricing/taxMath.ts `explodeInclusive`, carried into
 * integer piastres so the printed VAT is exactly r of the printed base, as an
 * Egyptian فاتورة ضريبية requires. VAT is 14% INCLUSIVE and is the only tax —
 * the former 6% service fee and 0.5% stamp duty are gone.
 */
export function vatInsideMinor(inclusiveMinor: number, vatRate: number): number {
  assertNonNegativeMinor(inclusiveMinor, 'inclusive');
  const r = Number(vatRate);
  if (!Number.isFinite(r) || r <= 0 || r >= 1) {
    throw new MoneyUnitError('bad_vat_rate', `VAT rate out of range: ${String(vatRate)}`);
  }
  return Math.round((inclusiveMinor * r) / (1 + r));
}

/** Base (ex-VAT) slice of a VAT-inclusive piastre amount. base + vat === inclusive, exactly. */
export function baseInsideMinor(inclusiveMinor: number, vatRate: number): number {
  return inclusiveMinor - vatInsideMinor(inclusiveMinor, vatRate);
}

/** Apply a fractional rate to a piastre amount, rounding half up to the piastre. */
export function applyRateMinor(amountMinor: number, rate: number): number {
  assertNonNegativeMinor(amountMinor, 'amount');
  const r = Number(rate);
  if (!Number.isFinite(r) || r < 0) {
    throw new MoneyUnitError('bad_rate', `Rate out of range: ${String(rate)}`);
  }
  return Math.round(amountMinor * r);
}
