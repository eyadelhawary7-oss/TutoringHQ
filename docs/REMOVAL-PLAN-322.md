# Removal plan: PR #322

**6 August 2026. Approved as a plan. Not started.** Four PRs, A to D, in order.

`#322` was "Phase 4: identity verification + online collection + payout System 1, as one branch",
merged 4 August: 68 files, 13,881 insertions. The model changed two days later and every line of it
describes something `design/NEW-MODEL.md` says no longer exists.

---

## What was established before planning

**The schema was never applied.** Both migrations are proposals. The live catalog holds no
verification, valify, collection or settlement table. Only `commission_payouts`, `payout_requests`
and `phone_verifications` exist, all pre-dating #322 and all belonging to other systems. There is no
production schema to unwind.

**Nothing faults today.** `verificationStore.ts` is reached from live pages, via `VerificationBadge`
to `useVerificationState.ts:111` to `GET /api/verification/status`, but it cannot fail. Two
independent guards sit in front of the missing tables:

1. `getEffectiveVerification` (`verificationStore.ts:131`) calls `getValifyConfigStatus()` and
   returns on the unconfigured branch before the table is ever named.
2. If it were configured, `isMissingRelation` catches `42P01`, `42703`, `PGRST205` and `PGRST204`
   plus three message patterns, and maps the result to `verification_schema_not_applied` rather than
   throwing.

`VerificationBadge.tsx:52` returns null with no state, so nothing renders either. This is dead
weight, not a live fault, which is why the order below is safe.

**The live surface is small.** 34 files match an import of the dead modules, but 13 of those are the
modules importing each other. Only four components reach real pages.

---

## Stage A. Sever the live pages

The only user-visible part. Four components across five files:

| Site | Imports |
|---|---|
| `src/app/[locale]/dashboard/page.tsx` | `VerificationBadge` |
| `src/app/[locale]/attendance/page.tsx` | `VerificationBadge` |
| `src/app/[locale]/teacher/(portal)/page.tsx` | `VerificationBadge`, `CollectForYouCard` |
| `src/app/[locale]/teacher/(portal)/settings/page.tsx` | `VerificationBadge`, `CollectPaymentsRow` |
| `src/app/[locale]/admin/centers/page.tsx` | `adminVerificationView` |

Also `#344`'s Teacher-Setup §01 verified chip, which is the same `VerificationBadge`.

Remove the import and its render site. Each renders nothing today, so the visual diff should be
empty. If a layout shifts, that is a real finding and belongs in the PR body.

---

## Stage B. Routes, cron, and the middleware allowlist

**13 routes:**

```
src/app/api/admin/center-payouts/route.ts
src/app/api/admin/center-payouts/[id]/approve/route.ts
src/app/api/admin/center-payouts/[id]/release/route.ts
src/app/api/admin/verification/availability/route.ts
src/app/api/collection/enable/route.ts
src/app/api/collection/status/route.ts
src/app/api/cron/payout-reconciliation/route.ts
src/app/api/payouts/request/route.ts
src/app/api/verification/start/route.ts
src/app/api/verification/return/route.ts
src/app/api/verification/status/route.ts
src/app/api/webhooks/valify/route.ts
src/app/api/webhooks/payout-provider/route.ts
```

**`vercel.json`:** the `payout-reconciliation` cron entry and its `maxDuration` override.

**`src/proxy.ts`, and this one is not optional.** #322 added `/api/webhooks/valify` and
`/api/webhooks/payout-provider` to `PUBLIC_WEBHOOK_PREFIXES`. Those prefixes are unauthenticated by
design, with no Origin check and no session, on the understanding that each handler verifies its own
HMAC. **Delete the routes without deleting the entries and the allowlist keeps two public prefixes
pointing at handlers that no longer exist.** That is a security hole created by a cleanup. Both
entries come out in the same PR as the routes.

One gain worth recording: the valify entry carries a note in `proxy.ts` that its HMAC scheme is
**assumed** to be HMAC-SHA256 hex over the raw body in `X-Valify-Signature`, and was never confirmed
by the vendor. Removing the route retires that assumption instead of resolving it.

---

## Stage C. Modules and tests

**Modules**, 22 files: `src/lib/collectionPayout/` (10), `src/components/verification/` (5),
`src/lib/verification/` (1), `src/lib/valify*.ts` (3), `src/lib/verification*.ts` (3). Plus the two
hooks `useVerificationState.ts` and `useAdminVerificationAvailability.ts`.

**EXCEPTION — do not delete `src/lib/placeholderValue.ts`. Lift it out first.** It reads as dead
because its only importer is `valifyConfig.ts`, but it is the intended fix for a live defect:
`?? ','` and `|| ','` render a bare comma as the missing-value placeholder in **127 places across 29
files** (`design/FINDINGS.md` entry 22). Deleting it with the dead model throws away the replacement
and guarantees someone rewrites it later. **Move it out of the dead set and drop the `valifyConfig`
dependency before stage C runs**, so the file survives the removal and the 127 sites can be migrated
onto it as separate work.

**Tests**, the 11 files #322 introduced:

```
tests/unit/api/valify-webhook.test.ts
tests/unit/api/verification-entrypoints-unconfigured.test.ts
tests/unit/collectionPayoutConfig.test.ts
tests/unit/collectionPayoutEngine.test.ts
tests/unit/payoutRequestFrontDoor.test.ts
tests/unit/placeholderValue.test.ts
tests/unit/valifyClient.test.ts
tests/unit/valifyGuard.test.ts
tests/unit/verificationFailsVisibly.test.ts
tests/unit/verificationState.test.ts
tests/unit/verificationStore.test.ts
```

---

## Stage D. The unapplied migrations

```
supabase/migrations/20260804140000_verification_records_proposal.sql      569 lines
supabase/migrations/20260804150000_PROPOSAL_payout_system_1_ledger.sql   1477 lines
```

Deleting the files is the whole job. Neither reached production, so there is nothing to reverse and
no catalog check to run afterwards.

---

## Stage E. Deferred

i18n cleanup. A grep for verification, collect and payout keys returns 83 lines in `messages/en.json`,
but that over-matches live strings such as collection rate. **83 is an upper bound, not a count.**
Narrow it to a real number before proposing anything. Held deliberately.

---

## Do not touch

These look like #322 and are not. They belong to referral credit withdrawal and staff commission
payouts, which are a different system, still live, and carry five of the seven defects in
`STATE-OF-PLAY.md`.

```
src/app/api/referrals/payout/route.ts
src/app/api/admin/payouts/route.ts
src/app/api/admin/payouts/[id]/route.ts
src/app/api/admin/payouts/[id]/pdf/route.ts
src/app/api/payouts/[id]/pdf/route.ts
tests/unit/payoutRequestAuthority.test.ts
```

`payoutRequestAuthority.test.ts` is the trap. It reads as a #322 file and came from `#319`.

Tables `payout_requests` and `commission_payouts` stay. So does `phone_verifications`, which is phone
OTP and unrelated to identity verification despite the name.

---

## Notes for whoever runs this

Every stage touches money-adjacent or auth-adjacent surfaces, so every PR comes to Eyad regardless of
size, per `CLAUDE-CODE-HANDOFF.md`.

Any UI change in stage A bumps `SW_VERSION` in `public/sw.js`.

Stages run in order because severing imports first is what makes each later deletion safe. Deleting a
module while a page still imports it fails the build; doing it the other way round does not.
