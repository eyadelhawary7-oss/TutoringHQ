# Phase 4 consolidation — what merged, what was deleted, and the one question left for Eyad

**Branch:** `claude/phase4-verification-and-payouts`, cut from `origin/master` at `81639a14`
(Public-Legal, #311), which is after #307 (sessions migration) and #311 both landed.

**Status: NOT APPLIED, NOT MERGED.** No migration was run. No write of any kind reached the
database. Every SQL statement issued while producing this branch was a read against
`information_schema`, `pg_policies`, `platform_config` and `supabase_migrations.schema_migrations`.

Three parallel branches built Phase 4 and each passed its own audit; the cross-cutting adjudication
failed all three on eight findings. This branch supersedes all three. It is one coherent thing, and
this document is the reviewer's map to it.

---

## 1. The decision that shaped everything: Territory A's design wins

Where A (`claude/phase4-valify-config-and-client`) and B (`claude/phase4-verification-ui-surfaces`)
disagreed, A wins on every axis. B's own module headers already instructed the handover — *"If
Territory A lands a richer state machine, take theirs and delete this"* — and this branch carries it
out.

The deciding reason is not tidiness. It is **column-level privilege**.

B modelled verification as columns on `public.centers` and `public.teacher_profiles`:
`verification_status`, `verified_at`, `valify_transaction_id`, `verified_name`,
`payout_name_matches`, `national_id`. There was no `REVOKE`/`GRANT` block anywhere in that
migration. Verified live, this session:

| Fact | Query | Result |
|---|---|---|
| Only SELECT policy on `centers` | `pg_policies` | `centers_select_own USING (id = get_auth_center_id())` |
| Only SELECT policy on `teacher_profiles` | `pg_policies` | `teacher_profiles_select_own USING (user_id = auth.uid())` |
| Columns on `public.centers` | `information_schema.columns` | **128** |

**RLS grants a row. It cannot withhold a column.** An authenticated centre owner passes
`centers_select_own` for their own row, so a `national_id` column on that table is readable straight
out of PostgREST with no application code involved. Four existing `select('*')` call sites on
`centers` would have started carrying the number the moment the column appeared, with nobody editing
them — confirmed by reading each one:

- `src/app/api/admin/centers/route.ts:280`
- `src/app/api/admin/centers/route.ts:344`
- `src/app/api/admin/centers/[id]/route.ts:114`
- `src/lib/mrrSnapshot.ts:47`

`VERIFICATION-SPEC` §7.7, §7.8 and §9.2 require the number never be rendered in any UI, owner-facing
or internal. A's `verification_records` table with a column-level `REVOKE ALL` + a `GRANT SELECT
(…)` naming only the safe columns is the only mechanism that delivers that. So A's schema is the
identity schema, and B's column migration is **deleted, not renumbered** — its facts now live in A's
tables.

---

## 2. What was deleted, and where each thing went

| Deleted | Replaced by | Why |
|---|---|---|
| `src/lib/verification/config.ts` | `src/lib/valifyConfig.ts` | Two config points read the same four `VALIFY_*` keys, each declaring itself "THE ONE CONFIG POINT" and naming a different module as the only legal reader. A's placeholder vocabulary is the stricter one — it treats `test` and any value containing `<` as placeholders; B's did not. There is now exactly one `isPlaceholderValue` in the codebase, and it lives in neither config point: see §4a. |
| `src/lib/verification/state.ts` | `src/lib/verificationState.ts` | Two state machines, six statuses beside five states. See §3. |
| `src/lib/verification/readVerificationState.ts` | `getEffectiveVerification()` in `src/lib/verificationStore.ts` | B's reader queried columns on `centers`/`teacher_profiles` that this branch has decided will never exist. |
| `GET /api/verification/state` | `GET /api/verification/status` | Two endpoints answered the same question with different shapes. Neither was a tenancy hole; both were an authority, and there must be one. |
| `supabase/migrations/20260804140000_verification_state_columns.sql` | `…140000_verification_records_proposal.sql` | The column-on-`centers` proposal. Deleted for the reason in §1. |
| `tests/unit/verificationContract.test.ts` | — | It pinned the shape of the two deleted modules. |

**Kept and repointed, not rewritten:** all five components in `src/components/verification/`, both
hooks, and every page-level integration B built. They were the point of that branch and they are
good. They now consume A's `EffectiveVerification`.

`src/lib/verification/uiState.ts` survives as what it always was — a pure view mapping — rewritten
against A's type.

---

## 3. Six outcomes, five states: nothing was lost in the collapse

B carried six statuses: `unverified · pending · verified · failed · expired · provider_error`.
A carries five states plus a separate `last_outcome` field:

```
spec return state   ->  state        last_outcome
Verified            ->  verified     passed
Pending             ->  pending      —
Failed              ->  rejected     failed
Abandoned           ->  unverified   abandoned
Expired             ->  unverified   expired
Provider error      ->  unverified   provider_error
```

Three of B's statuses were outcomes wearing a state's clothes: `expired` and `provider_error` both
leave the provider exactly where they started, and giving each a terminal-looking state invents a
distinction the schema then carries forever. A's model also makes `unconfigured` first-class, which
is the distinction that actually matters to a user — *"we cannot verify anyone"* is not
*"you have not verified"*.

The user-visible distinction B needed **survives**, in `verificationOutcomeNoteKey()`: an expired
link renders a neutral "Not verified" badge with the sentence *"Your last verification link expired
before it was used"* beside it. `tests/unit/verificationFailsVisibly.test.ts` has a dedicated
`describe` block asserting exactly this, so the collapse cannot silently lose the distinction later.

Message keys followed: `badge.failed` → `badge.rejected`; `badge.expired`, `badge.providerError` and
`cta.reason.providerError` became `outcome.*`. A test asserts **no orphaned keys** in either
direction, so a deleted status cannot leave dead copy behind.

---

## 4. ⚠ THE OPEN QUESTION FOR EYAD: two config points, two vendors

**This is not resolved and was deliberately not resolved unilaterally.**

The governing instruction was "ONE clearly named config point". This branch ships **two**:

| Surface | Module | Keys | Vendor |
|---|---|---|---|
| Identity verification | `src/lib/valifyConfig.ts` | `VALIFY_*` (4) | Valify |
| Payout rail | `src/lib/collectionPayout/config.ts` | `COLLECTION_PAYOUT_RAIL_*` (6) | Paymob Payouts |

They cover **disjoint vendors** and **neither module reads the other's keys**. The duplication the
instruction was written against — two modules reading the *same four* `VALIFY_*` keys with two
different placeholder vocabularies — is gone, and that was the headline defect.

### 4a. The placeholder vocabulary: one, and in neither config point

An earlier revision of this branch claimed "there is now exactly one `isPlaceholderValue` in the
codebase" while shipping two, and the claim was also printed in `.env.example`. It was false, and it
was not cosmetic. The two dialects disagreed on 13 of 15 tokens, and they were **not** confined to
disjoint key sets as the table above implies: `scripts/check-env.ts` imported the Valify dialect and
applied it to the `COLLECTION_PAYOUT_RAIL_*` keys, while `collectionPayout/config.ts` applied its own
to the identical keys. With `COLLECTION_PAYOUT_RAIL_CALLBACK_HMAC_SECRET=test`, `npm run check:env`
printed **NOT CONFIGURED** — which an operator reads as "the webhook is closed" — while the module
that actually gates `/api/webhooks/payout-provider` read the secret as **live**, so the webhook would
have stopped 503-ing and begun accepting callbacks HMAC'd with a guessable secret. That is attack A1
in `.env.example`, reached through a disagreement about vocabulary rather than a missing check.

Fixed by extracting **`src/lib/placeholderValue.ts`**, imported by both config points and by
`check-env.ts`. Two config points (§4, still open) is a question; two answers to "is this filled in?"
is a defect, and it is closed.

The shared vocabulary is the **union** of the two dialects, not either one. Neither was a superset:
the Valify list caught `test` and any value containing `<`, which the payout list did not; the payout
list caught `not-configured` and `replace_me`, which the Valify list did not. Adopting either alone
would have silently widened what counts as a live credential on one of the two rails.
`tests/unit/placeholderValue.test.ts` pins all four distinguishing tokens and asserts that no second
implementation has reappeared anywhere under `src/`.

**Option A — keep them separate (what this branch ships).** One module per vendor. Each has its own
guard, its own named refusal causes, and its own lifecycle: Valify has no contract at all, while
Paymob Payouts onboarding is a manual provisioning process on Paymob's side that has not started.
They will become real at different times, for different reasons, negotiated by different people.

**Option B — collapse into one `externalVendorConfig.ts`.** Literally satisfies "one config point".
Costs: a single module holding two unrelated vendors' secrets, one guard answering two questions
whose answers are independent, and a refusal vocabulary that has to be namespaced back apart at
every call site to stay legible.

**Recommendation: Option A.** The instruction's purpose was to prevent *two readers of one
credential set*, which is a correctness problem — divergent placeholder vocabularies mean the same
`.env` is live to one module and dead to the other. Two readers of two disjoint credential sets is
not that problem, and collapsing them would trade a real separation of concerns for a literal
reading of a word. If Eyad wants Option B, it is a mechanical change and no call site outside the
two config modules moves.

**Made visible rather than left to grep:** `npm run check:env` now reports both surfaces by name and
by module path on every run, and `.env.example` cross-references each block from the other.

---

## 5. The money gate is wired to the identity engine

`src/lib/collectionPayout/verificationGate.ts` `resolvePrincipalVerification()` previously ignored
both of its parameters and returned a module-level `SCHEMA_ABSENT` constant unconditionally. The
answer it gave was correct; it was correct **by coincidence rather than by derivation**, and it would
have kept saying "no live source" for the rest of time, including the hour after the migration was
applied.

It now calls `getEffectiveVerification()` and `capabilitiesFor()` with its actual parameters. The
refusal is unchanged in substance and **the refusal is still total** — but it is now derived.

Proof that it is derived, and it is a test rather than a claim: with the same unmigrated database and
only the Valify credentials changed from absent to real, **the cause code changes** —
`verification_provider_not_configured` → `verification_state_not_in_schema`. A constant cannot do
that. Both refusals keep a named, user-legible cause with copy in `ar.json` and `en.json`.

It still cannot be an F26. The query it now issues goes through `verificationStore.ts`, where every
read passes through `isMissingRelation()` and an undefined-table error becomes the named cause
`verification_schema_not_applied` rather than escaping as a 500. The error is **expected, caught and
named** — which is the difference between handling that defect class and being it.

Two hardening changes went in alongside:

- A `center` principal arriving with a null `centerId` is **refused**, not silently gated on its
  `userId`. Gating one subject on another subject's verification is how money reaches the wrong
  person.
- The success arm dropped the `providerReference` it used to declare. `VERIFICATION-SPEC` §9.7 makes
  it backend-only, no consumer in the payout path ever read it, and a field that must never be shown
  is safest when it does not travel through the money path at all. `GET /api/verification/status`
  does not return it either, for the same reason — B's deleted endpoint did, while its own type
  comment said "never rendered in any UI".

---

## 6. Migrations: three proposals became two, with distinct versions, in dependency order

All three branches numbered their migration `20260804140000`.
`supabase_migrations.schema_migrations.version` is a **PRIMARY KEY** — only one could ever have been
recorded, and the others would have looked applied while never having run.

| Order | Version | File | State |
|---|---|---|---|
| 1 | `20260804140000` | `_verification_records_proposal.sql` | proposal, NOT APPLIED |
| 2 | `20260804150000` | `_PROPOSAL_payout_system_1_ledger.sql` | proposal, NOT APPLIED |
| — | — | `_verification_state_columns.sql` | **deleted** (§1) |

Verified live: the highest version in `schema_migrations` is `20260804094631`, so both numbers are
free. Each file keeps its `DO`-block constraint guards, its `IF NOT EXISTS`, its RLS policies in the
same file, and — for the identity schema — its column-level `REVOKE`/`GRANT`. Both carry a
**NOT APPLIED — Eyad applies this by hand** header and an explicit apply-order block that names the
other file.

The dependency runs one way: the payout ledger's money gate reads the identity tables, so applying
the ledger alone yields a payout system whose gate can only refuse.

---

## 7. Every live fact, re-run this session

Finding 8 existed because three agents asserted catalog numbers they had not run. Every number below
was produced by executing the query against project `lczmjpnbuhnsislcvzar` on 4 August 2026, and
every drifted header on the branch was corrected to match.

| Fact | Truth | A said | B said | C said |
|---|---|---|---|---|
| Columns matching `%verif%`/`%national%`/`%kyc%`/`%valify%` in `public` | **6** | 6 ✓ | 12 ✗ | 16 ✗ |
| Columns on `public.centers` | **128** | 108 ✗ | 128 ✓ | 108 ✗ |
| Base tables in `public` | **142** | — | — | 137 ✗ |
| Columns on `public.teacher_profiles` | **24** | — | 24 ✓ | — |
| `verification_records` / `verification_attempts` | **both absent** | ✓ | ✓ | ✓ |
| Highest applied migration version | **`20260804094631`** | — | — | — |
| `platform_config` key `digital_student_fee_collection.enabled` | **EXISTS, `false`** | ✓ | ✓ | ✓ |

The six matching columns, in full — every one OTP or backup bookkeeping, **zero** identity
verification: `backup_log.last_verified_at`, `enrollment_otps.verified_at`,
`phone_verifications.verified_at`, `students.parent_phone_verified`, `students.phone_verified`,
`teacher_signup_otps.verified_at`.

C's header additionally described its 16 matches as including "payout-destination / permission
columns". That pattern cannot match such a column and none did — it was description invented to fit
a count that was itself invented. Fixed, and the correction is written into the file rather than
quietly applied.

**The material conclusion all three reached was right** — zero identity-verification columns, no
verification table, so nothing reads a column that does not exist. That is precisely why the wrong
numbers survived three audits: a correct conclusion does not audit its own premises.

---

## 8. What all three got right, and is preserved

- **No migration applied, no write to the database.** Still true of this branch.
- **`platform_config` key `digital_student_fee_collection.enabled` EXISTS with value `false`**,
  contradicting `PAYOUT-SYSTEM-SPEC` §0 and §9, which say the row is absent. All three caught it
  independently and none wrote an `INSERT` that would have collided. The spec claim is stale; the
  note recording that is kept in `valifyConfig.ts` and in the ledger migration.
- **No request against any of the ~14 new endpoints returns a truthy `verified` or `success` while
  the config holds placeholders.** Re-checked after the rewiring. The client hook, the admin
  availability hook, and the gate all fail closed on network error, 401, malformed body and
  unparseable state.
- **The assumed Valify webhook auth scheme is still visible, not smoothed away.** HMAC-SHA256 over
  the raw body in `X-Valify-Signature` is an **assumption, unconfirmed by the vendor**. It is
  recorded in `valifyConfig.ts`, in `.env.example`, in the webhook route, and — added by this merge —
  in `src/proxy.ts` beside the public prefix, since that is where a reader first meets the route.

### Two webhook prefixes coexist

The A × C conflict in `src/proxy.ts` was resolved, not chosen: `PUBLIC_WEBHOOK_PREFIXES` now carries
both `/api/webhooks/valify` and `/api/webhooks/payout-provider`. Both were correct. Each verifies its
own HMAC with a timing-safe compare and fails closed while its secret holds a placeholder.

### Message catalogues

The B × C conflict in `messages/ar.json` and `messages/en.json` was merged on top of what #311
landed. Both namespaces are present, key-identical across the two files (`i18n:check` passes with
4064 resolved keys), and the `verification.*` keys were revised for the five-state vocabulary.

---

## 9. Gates

```
npm run typecheck            clean
npm run lint                 0 errors (145 pre-existing warnings, none in a file this branch touched)
npm run verify:stabilization i18n ✓  bidi ✓  tolocale ✓
npm run test:unit            198 files, 1831 tests, all passing
npm run check:env            reports both config surfaces as NOT CONFIGURED, which is correct
```

## 10. For the reviewer

Nothing here merges without Eyad. The two migrations are proposals and must be applied by hand, in
the order given in §6, with the tables confirmed present in `information_schema` **before** the code
that reads them deploys. The question in **§4 is genuinely open** and is the one thing on this branch
that wants a decision rather than a review.
