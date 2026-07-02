# Guardian-consent confirmation on center-side student add

## Why

The center — not CenterHQ — is the party responsible for holding the guardian's
consent to process a student's personal data. That obligation will be worded by
Adsero in the center agreement and the data processing agreement. This feature
records the center's confirmation **at the moment it adds or approves a
student**, so the contract clause has concrete proof behind it: **who** confirmed
and **when**.

> **Interim wording — pending Adsero.** The checkbox text is a placeholder. It
> lives in exactly one place per language so Adsero's final wording is a
> one-line copy change, not a code change (see [Wording](#wording-one-string-per-language)).

## What changed (before → after)

| Flow | Before | After |
| --- | --- | --- |
| Add a student (students page) | Fill the form, save. | A required "I have the guardian's consent" checkbox must be ticked; the server rejects the save if the confirmation is missing and stamps who/when on success. |
| Onboarding first student | Enter name/phone, continue. | Same required checkbox; server-enforced. |
| Approve a pending enrollment | Review request, approve. | Same required checkbox in the review dialog; server-enforced; stamped on the approved student row. |
| Bulk CSV/XLSX import | Map columns, import. | One "consent for all imported students" checkbox on the final preview step; server enforces it per row. |
| **Existing students** | — | **Untouched. Not retroactively blocked.** The requirement applies only to new center-side adds/approvals going forward. |

## Data model

One migration (`supabase/migrations/20260702160000_guardian_consent_on_student_add.sql`)
adds two nullable columns to `public.students`:

- `guardian_consent_confirmed_at timestamptz` — when the confirmation was made.
- `guardian_consent_confirmed_by uuid` — the confirming center user (`public.users.id`).

Together they are the proof. Both are nullable so existing rows are unaffected.
`guardian_consent_confirmed_by` is a plain `uuid` with no FK — matching the
existing `parent_consent_*` columns and `approve_student_rpc`'s `p_approved_by` —
because the value is an immutable audit fact that must survive even if the user
row is later removed.

## Server is the gate (not just the checkbox)

Every center-side create/approve path rejects the request when the confirmation
is absent, and stamps `guardian_consent_confirmed_at = now()` /
`guardian_consent_confirmed_by = the calling user` on success. A UI checkbox
alone is never trusted.

| Path | File | Enforcement |
| --- | --- | --- |
| Direct add **and** bulk import | `src/app/api/db/route.ts` | On a `students` insert by a center caller (direct scope), each row must carry `guardian_consent_confirmed === true` or the insert is rejected (`403 GUARDIAN_CONSENT_REQUIRED`). The transient flag is stripped and the two columns stamped server-side. Super-admins (tenant management) are exempt but still recorded if they send the flag. |
| Onboarding wizard | `src/app/api/onboarding/add-student/route.ts` | `guardianConsentConfirmed !== true` → `403`; columns stamped on insert. |
| Onboarding (legacy route, not UI-wired) | `src/app/api/onboarding/first-student/route.ts` | Same gate — closed so the route can't be used to bypass the checkbox. |
| Approve pending enrollment | `src/app/api/students/pending/[id]/approve/route.ts` | `guardianConsentConfirmed !== true` → `403` before the approval RPC; columns stamped on the student row after it succeeds. |

The direct-add form and the bulk importer both write through the legacy
`/api/db` proxy, so gating that one `students`-insert path covers both.

## UI

Required checkboxes, Arabic-first / RTL, logical properties only:

- `src/app/[locale]/students/page.tsx` — add-student modal.
- `src/app/[locale]/students/pending/page.tsx` — approve-enrollment dialog.
- `src/app/[locale]/onboarding/page.tsx` — onboarding step 1.
- `src/app/[locale]/students/import/page.tsx` — bulk import preview step (blocks the Import button until ticked).

## Wording (one string per language)

`messages/en.json` and `messages/ar.json`, namespace `guardianConsent`:

- `checkboxLabel` — the confirmation text shown on every checkbox.
- `required` — the error shown if a center tries to proceed without ticking it.

Every flow reads the same `guardianConsent.checkboxLabel`. **To adopt Adsero's
final wording, edit these two strings only.**

## Out of scope — flagged for Adsero, not built here

- **Parent-facing self-enrollment (join-by-link) consent.** When a parent
  self-registers via `/join/...`, that is a *different* consent (the parent
  consenting directly, not the center attesting it holds consent) and a
  legal-design question. It is intentionally **not** designed here. The
  join-created student is inactive until a center approves it, and that approval
  step *is* gated by this feature.
- **Teacher-portal private students** (`/api/teacher/private/groups/.../roster`)
  are a separate product surface (centre-less teachers) with their own consent
  question; not covered by this center-side change.

## Tests

- `tests/unit/api/db-route-guardian-consent.test.ts` — reject without the flag
  (single and bulk), stamp + strip on success, whole-batch rejection if any row
  is unconfirmed.
- `tests/unit/api/onboarding-add-student-consent.test.ts` — reject / stamp.
- `tests/unit/api/onboarding-first-student-route.test.ts` — reject / stamp
  (existing suite extended).
- `tests/unit/api/students-pending-approve-consent.test.ts` — reject before the
  approval RPC / stamp on the approved row.

## Schema-snapshot note

The drift snapshot (`db/schema.snapshot`) is generated with Postgres 17 in CI to
match production. Postgres 17 could not be installed in this build environment
(the package mirror is blocked by egress policy). The migration's delta was
therefore produced by the real introspection tool on Postgres 16 by diffing a
rebuild **with** the migration against one **without** it — so any
version-specific deparse noise cancels — and the resulting two `COLUMN` lines
were spliced into the committed snapshot. This was verified to be byte-identical
to a full Postgres-16 rebuild of all migrations, and the only change to the
committed snapshot is the two new column lines. The CI Postgres-17 drift gate
will confirm it on the PR.
