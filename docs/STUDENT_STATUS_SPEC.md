# Student lifecycle status (filters & badges)

> Synced against the live database and code on 2026-07-18. The five `lifecycle_status`
> values below are the exact live CHECK-constraint members (verified live 2026-07-18).

Canonical definitions for TutoringHQ student lifecycle filters on the Students page and related APIs.

The live constraint is `students_lifecycle_status_check`:
`CHECK (lifecycle_status IN ('enrolled','active','at_risk','inactive','churned'))` (verified live 2026-07-18).

Student balances are **computed live** — there is **no `students.balance_due` column**; the only
balance-related columns are `balance_alert_threshold` (numeric) and `notify_on_balance` (boolean)
(verified live 2026-07-18).

| Filter / status | Meaning |
|-----------------|--------|
| **All** | Every student row for the center (no lifecycle filter). |
| **Active** | Engaged learner: recent attendance / activity per center rules (`lifecycle_status = active`). |
| **At risk** | Low attendance or long gap since last scan; needs follow-up (`at_risk`). |
| **Inactive** | No qualifying recent scans within the configured absence window (`inactive`). |
| **Enrolled** | On roll / registered; may not yet have stable attendance (`enrolled` or unset legacy). |
| **Churned** | Left or formally marked as churned; excluded from active cohort metrics (`churned`). |

UI copy is driven by `students.filter_*`, `students.status_*`, and `students.statusHelp_*` message keys. Product or support docs should reference this table when explaining dashboards and WhatsApp messaging.

Consent-related student columns (distinct from lifecycle) are documented in
[`GUARDIAN_CONSENT.md`](./GUARDIAN_CONSENT.md) and [`PARENT_SELF_ENROLL_CONSENT.md`](./PARENT_SELF_ENROLL_CONSENT.md).
