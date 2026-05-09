# Student lifecycle status (filters & badges)

Canonical definitions for CenterHQ student lifecycle filters on the Students page and related APIs.

| Filter / status | Meaning |
|-----------------|--------|
| **All** | Every student row for the center (no lifecycle filter). |
| **Active** | Engaged learner: recent attendance / activity per center rules (`lifecycle_status = active`). |
| **At risk** | Low attendance or long gap since last scan; needs follow-up (`at_risk`). |
| **Inactive** | No qualifying recent scans within the configured absence window (`inactive`). |
| **Enrolled** | On roll / registered; may not yet have stable attendance (`enrolled` or unset legacy). |
| **Churned** | Left or formally marked as churned; excluded from active cohort metrics (`churned`). |

UI copy is driven by `students.filter_*`, `students.status_*`, and `students.statusHelp_*` message keys. Product or support docs should reference this table when explaining dashboards and WhatsApp messaging.
