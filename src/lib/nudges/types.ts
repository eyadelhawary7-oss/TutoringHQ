// Unified billing nudge / dunning engine — shared types for centers AND teachers.
//
// One engine drives both owner types off the now-shared invoice + subscription
// tables. The only owner-specific differences are (a) where the pay link points
// (/pay vs /teacher/pay) and (b) the lock-context copy (center summary-screen
// lock vs teacher free-tier drop). Everything else is identical.

export type OwnerType = 'center' | 'teacher';

/** The discrete steps in the nudge sequence (also the ledger idempotency key). */
export type NudgeStep =
  | 'prebill_t3' // 3 days before billing — manual-pay owners only
  | 'prebill_t1' // 1 day before billing — manual-pay owners only
  | 'due_today' // billing day, still unpaid (manual-pay OR failed auto-charge) = grace day
  | 'locked' // after lock — summary-screen (center) / free-tier (teacher)
  | 'card_expiry_t30' // saved card expires before next billing, ~30 days out
  | 'card_expiry_t7'; // saved card expires before next billing, ~7 days out

export interface OwnerRef {
  ownerType: OwnerType;
  ownerId: string;
}

export interface SavedCardInfo {
  last4: string;
  /** 1–12 */
  expMonth: number;
  /** 4-digit year */
  expYear: number;
  status: string;
}

/**
 * Everything the engine needs to decide a single owner's nudges. Built once from
 * the live billing/subscription/invoice/saved-card data and consumed by BOTH the
 * scheduled cron (which sends WhatsApp) and the live banner endpoint (which never
 * touches the ledger). Keeping it a plain object makes the decision logic pure
 * and unit-testable.
 */
export interface OwnerNudgeState {
  owner: OwnerRef;
  /** Display name (owner / center / teacher) for message personalisation. */
  displayName: string | null;
  /** Cairo calendar date (YYYY-MM-DD) of the upcoming/most-recent billing day. */
  billingDayCairo: string | null;
  /** Billing-period idempotency key, 'YYYY-MM' (derived from the billing day). */
  cycleKey: string | null;
  /** Current cycle invoice satisfied (paid / fully credited) → stop the sequence. */
  paid: boolean;
  /** There is an open, payable invoice for this cycle right now. */
  hasOpenInvoice: boolean;
  invoiceId: string | null;
  /** Remaining amount to pay this cycle (EGP). */
  amountDue: number;
  /**
   * Will this owner have to pay manually this cycle? True when there is no usable
   * saved card, OR recurring auto-charge cannot run (integration not configured),
   * OR the issuing bank rejected the recurring charge (auth-required / hard
   * decline). This is the population pre-billing reminders target.
   */
  manualPayExpected: boolean;
  savedCard: SavedCardInfo | null;
}

/** Structured banner payload — the component localises + formats it. */
export interface BannerNudge {
  kind: 'prebill' | 'due_today' | 'locked' | 'card_expiry';
  ownerType: OwnerType;
  amountDue: number;
  billingDayCairo: string | null;
  /** For 'prebill' — whole days until billing (1–3). */
  daysUntil: number | null;
  cardLast4: string | null;
  /** For 'card_expiry' — 'MM/YY'. */
  cardExpiry: string | null;
  /** Relative path the CTA navigates to (pay or update-card surface). */
  ctaHref: string;
}
