# Parent consent on the self-enrollment (join-by-link) flow

## Why

When a parent **self-enrolls** a student through a shared join link, the parent
must confirm they are the student's parent / legal guardian **and** consent to
the student's personal data being processed. Adsero un-blocked this parent-facing
path (2026-07-02). It is the parent-facing counterpart to the center-side tick
documented in [`GUARDIAN_CONSENT.md`](./GUARDIAN_CONSENT.md).

> **Interim wording — pending Adsero.** The checkbox text below is interim,
> pending Adsero's final parent-facing wording. It lives in one string per
> language (`join.consentLabel`), so the final swap is a one-line copy change.

## Consent columns — what records what (no conflation)

There are now **three** separate consent concepts on `public.students`. They must
never be mixed up:

| Column(s) | Meaning | Who attests |
| --- | --- | --- |
| `parent_consent_given` / `parent_consent_at` | WhatsApp **parent-pack comms opt-in** (receive notifications). Flipped by the WhatsApp webhook. | Parent, via WhatsApp reply |
| `guardian_consent_confirmed_at` / `guardian_consent_confirmed_by` | The **center** attesting it holds the guardian's consent (center-side add / approve / import). | Center user |
| **`parent_self_enroll_consent_at`** *(this feature)* | The **parent**, on the public join form, attesting they are the parent/legal guardian and consenting to processing. | Self-enrolling parent |

## Data model

One migration (`supabase/migrations/20260702170000_parent_self_enroll_consent.sql`)
adds one nullable column to `public.students`:

- `parent_self_enroll_consent_at timestamptz` — the moment the self-enrolling
  parent attested. Its **presence is the proof**; NULL means no self-enrollment
  attestation was captured for this row.

No `_by` uuid: the self-enrolling parent is unauthenticated (there is no
`public.users` row for them), and the submitted `parent_phone` already lives on
the same student row. Nullable so existing rows and every non-join creation path
are unaffected. The migration ends with `notify pgrst, 'reload schema'`; the
drift snapshot (`db/schema.snapshot`) was regenerated, not hand-edited.

## Server is the gate (not just the checkbox)

Both public join routes reject a submission that does not carry the parent's
consent, and stamp the column on success. A UI checkbox alone is never trusted.
Both routes stay public, rate-limited (`join:${ip}`, 10/hour) and service-role.

| Route | File | Enforcement |
| --- | --- | --- |
| `POST /api/join/pending-enrollment` (used by the public form) | `src/app/api/join/pending-enrollment/route.ts` | `parent_consent !== true` → `403 PARENT_CONSENT_REQUIRED`; `parent_self_enroll_consent_at` stamped on the student insert. |
| `POST /api/join/[center_code]/[group_id]` (sibling route, same data model) | `src/app/api/join/[center_code]/[group_id]/route.ts` | Same gate — closed so it can't be used to bypass the checkbox. |

Out of scope (separate surfaces, confirmed): `join/g/[groupId]` (OTP teacher-group
self-enroll — does not create a `pending_enrollments` row) and the
center-authenticated `students/pending` POST.

## UI

`src/app/[locale]/join/[center_code]/[group_id]/page.tsx` — a **required** checkbox
on the public self-enrollment form (Arabic-first, RTL, logical properties). The
submit button is disabled and submission is blocked until it is ticked; the body
sends `parent_consent: true`.

## Wording (one string per language)

`messages/en.json` / `messages/ar.json`, namespace `join`:

- `consentLabel` — the parent-facing confirmation text (**interim, pending Adsero**).
- `consentRequired` — the error shown if a parent tries to submit without ticking it.

## Note — double capture is intended

The center still approves the self-enrolled student, and that approval is already
gated by the center tick (`guardian_consent_confirmed_*`). Consent is therefore
captured at **both** points — parent-attested at self-enrollment, center-confirmed
at approval. That is intended, not a duplicate to remove.

## Tests

`tests/unit/api/join-parent-consent.test.ts` — for both routes: rejected with
`403 PARENT_CONSENT_REQUIRED` when consent is absent/false (no student inserted),
and `parent_self_enroll_consent_at` stamped (valid ISO timestamp) on success.

## Schema-snapshot note

CI rebuilds the drift snapshot on **Postgres 17**; the baseline uses the PG17-only
`MAINTAIN` privilege, so a full local PG16 rebuild aborts on the baseline. Local
PG16 was used only to compute the **delta** (rebuild with vs without this
migration, `MAINTAIN` stripped identically on both sides so it cancels). The
`MAINTAIN`-stripped PG16 rebuild of the current tree was verified **byte-identical**
to the committed PG17 snapshot, and the "with-migration" rebuild adds exactly the
one new `COLUMN students.parent_self_enroll_consent_at ord=38` line — which is what
was committed. The CI Postgres-17 drift gate confirms it on the PR.
