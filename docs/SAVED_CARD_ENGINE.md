# Saved-Card Engine (Phase 1)

Last updated: 2026-06-24

Card-on-file + auto-charge capability. **Built and unit-tested, but NOT yet
wired to any cron or live payment flow.** Phase 2 wires `chargeSavedCard()` into
the midnight billing run. Going live also depends on credentials that do not
exist yet (see "Founder / Paymob actions").

## What it does

- **Save a card once (1a):** capture the Paymob card **token** at a customer's
  first/initial payment and store it (token, last 4, brand, expiry month/year,
  stored-credential reference). **The raw card number (PAN) is never stored** —
  `saved_cards.card_last4` is constrained to exactly 4 digits.
- **Auto-charge (1b):** `chargeSavedCard()` charges a saved card with **no
  customer present** (merchant-initiated, `is_3d_secure: false`) using the
  recurring integration id, replaying the stored-credential reference.
- **Consent (1c):** explicit customer consent (store + auto-charge) is recorded
  before a card is stored for recurring use. Arabic-first text; snapshotted.
- **Validity check (1d):** a small authorization is placed and immediately voided
  at save time so a dead card is caught before the first real billing.

## Reliability

- **Idempotency:** the charge **intent** is persisted (`card_charge_intents`,
  status `created`) **before** Paymob is called, then flipped to `submitted`
  immediately before the network call. The `idempotency_key`
  (`mit:v1:{ownerType}:{ownerId}:{invoiceId}:{billingPeriod}`) is **UNIQUE** —
  the same logical charge always maps to the same intent. A completed success is
  replayed (`already_charged`), never re-charged. A key reused with a **different**
  charge body (amount/owner/invoice) is rejected (`idempotency_conflict`). An
  attempt left `submitted` (network timeout / pending) is **not re-charged
  blindly** — it returns `needs_reconciliation` for Phase 2 to settle.

## Schema

Migration `supabase/migrations/20260624120000_saved_card_engine.sql`:

- `saved_cards` — token + display metadata only (never the PAN); one **active**
  card per owner (partial unique index).
- `saved_card_consents` — append-only consent records.
- `card_charge_intents` — idempotent MIT charge intents (the reconciliation
  anchor).
- `saved_card_events` — append-only lifecycle audit.

All four are **service-role only** (RLS enabled, no user-facing policies; grants
revoked from `anon`/`authenticated`). Customers are polymorphic: `owner_type`
(`center` | `teacher`) + `owner_id`.

> The migration is committed but **applied on review** — it is a real-money
> schema change. Run it (and `NOTIFY pgrst, 'reload schema'`, which it includes)
> when approved.

## Code

`src/lib/savedCard/`:

- `autoCharge.ts` — `chargeSavedCard()` — **the keystone**. Callable + tested.
- `saveCard.ts` — `saveCardFromFirstPayment()` + `parsePaymobTokenCallback()`.
- `consent.ts` — canonical consent text (`CONSENT_TEXT`, `CONSENT_VERSION`),
  `recordConsent()`.
- `idempotency.ts` — `buildIdempotencyKey()`, `buildRequestFingerprint()`.
- `paymobRecurring.ts` — real Paymob classic-Accept HTTP client (charge-with-token
  + authorize-and-void). Injected via an interface so the engine is tested with a
  fake (no network).
- `store.ts` — service-role Supabase persistence adapter.

**Paymob config — one source of truth:** `src/lib/paymobConfig.ts` is the single
module the whole platform reads every Paymob credential/id from (API key,
integration id, iframe id, HMAC secret, recurring integration id). No file reads
`process.env.PAYMOB_*` for these directly. Secret values stay in env.

API: `POST /api/billing/saved-card/consent` (owner-only, CSRF) records center
consent. i18n: `savedCard.consent.*` in `messages/{ar,en}.json`.

Tests: `tests/unit/savedCard*.test.ts` prove — token stored never PAN,
auto-charge hits the right token/amount, idempotency prevents a double charge,
consent required before storage, validity check rejects a dead card.

## Founder / Paymob actions (blocks go-live, not the build)

1. **Recurring integration id** — `PAYMOB_RECURRING_INTEGRATION_ID`. A dedicated
   RECURRING / MOTO integration credential Eyad must request from his Paymob
   account manager. **It does not exist yet.** Until set, the engine returns
   `recurring_integration_not_configured` and never charges. **One-place change:**
   set the env var and the whole platform picks it up — the only code that reads
   it is `getPaymobRecurringIntegrationId()` in `src/lib/paymobConfig.ts`.
2. **Live credentials** — live auto-charging also waits on Paymob LIVE
   credentials (company registration). Phase 1 builds + tests the mechanism; it
   does not make auto-charge live in production.

## Not in Phase 1 (Phase 2)

The midnight cron, the fallback/iframe flow, retries/dunning, and wiring the
Paymob **TOKEN callback** into the webhook (plus requesting tokenization on the
first-payment payment key) — all Phase 2. `parsePaymobTokenCallback()` +
`saveCardFromFirstPayment()` are the ready capture mechanism for that wiring.
