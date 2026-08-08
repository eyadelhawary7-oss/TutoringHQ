# Re-diff — 8 August 2026

Twelve merged design files diffed against the **live running app**, rendered at 390px in
both locales as the owner of Test Center 333. One agent per FILE, never per screen.

Reported as **frames exercised out of frames drawn**, because a single parity fraction that
counts unexercised frames as passing is "done" wearing a number.

---

## The numbers

Frames counted by `class="phone"` and nothing else — the one element present exactly once per
frame in all 25 files. `.frame`, `.cap` and `.ar` are optional decoration that varies by file
age, and counting them produced two wrong totals before this rule was fixed.

| File | Drawn | Exercisable | Exercised | Blocked |
|---|---|---|---|---|
| `Merged-Center-Attendance` | 13 | 3 | **3** | 10 |
| `Merged-Center-Home` | 8 | 6 | **6** | 2 |
| `Merged-Center-Insight` | 13 | 8 | **8** | 5 |
| `Merged-Center-Money` *(protected)* | 50 | 13 | **11** | 39 |
| `Merged-Center-Orders` | 15 | 2 | **2** | 13 |
| `Merged-Center-Setup` | 41 | 36 | **20** | 21 |
| `Merged-Center-WhatsApp` | 12 | 3 | **3** | 9 |
| `Merged-Public-App` *(protected)* | 62 | 20 | **14** | 48 |
| `Merged-Public-Legal` | 14 | 12 | **12** | 2 |
| `Merged-Public-Marketing` | 12 | 10 | **10** | 2 |
| `Merged-Design-Patterns` *(protected)* | 44 | 27 | **15** | 29 |
| `Merged-Lifecycle` *(protected)* | 18 | 5 | **5** | 13 |
| **Total** | **302** | — | **109** | **193** |

109 + 193 = 302. Every per-file row sums the same way; the totals were re-derived from the
twelve reports rather than accumulated by hand.

Every blocked frame is named individually in its file's report, categorised as one of:
`no-data` (the feature exists, live data cannot produce that state) · `not-built` (genuinely
absent) · `credential` (needs a role this session did not have) · `tooling` (the capture
failed) · `by-design` (an empty state a seeded centre cannot reach).

**A `tooling` block is not a finding.** A capture that failed, bounced to `/login`, or stayed
skeletal was *not measured*, which is a different claim from *not built*, and the harness
manifest keeps the two apart so an agent cannot collapse them.

---

## Coverage of the whole set

| | Files | Frames |
|---|---|---|
| Diffed here | 12 | 302 |
| **Blocked on credentials** | **11** | **158** |
| Diffed earlier (`Center-Groups`, `Center-Students`) | 2 | 32 |
| **Total** | **25** | **492** |

302 + 158 + 32 = 492, which matches a live `class="phone"` count across all 25 files.

**The 11 blocked files need a login this session did not have.** The four `Admin-*`/`CEO`
files need an admin session and the seven `Teacher-*` files need a teacher session; the one
credential available was the Test Center 333 owner. Six auth users exist — one `super_admin`,
three teachers — so the accounts are there, only the PINs are missing. Minting a session with
the service-role key was refused by policy and was not worked around.

Those 11 files are **not** reported as failing or as absent features. They are unmeasured.

---

## The harness

`scripts/rediff/capture-batch.mjs` captures many routes with one browser: screenshot plus
rendered text, plus a manifest recording `finalUrl`, page errors, HTTP errors, whether the
route bounced to `/login`, and whether skeletons survived the settle.

Two faults were found in it **before** the fan-out rather than after, each of which would have
had twelve agents reporting built screens as missing:

- The earlier harness stripped `nav,aside,header` as "chrome" and cut real content with it.
  This app renders the centre name, the plan chip and the verification badge **inside**
  `<header>`, so `/en/dashboard` captured 15 characters and read as an empty screen. It now
  strips only `script,style` — repetitive chrome in the text is harmless, missing content is
  not.
- A fixed sleep photographed skeleton cards and a "Compiling…" pill. It now waits for network
  idle, gives skeletons one more settle, and **records** whether they survived it.

Both were caught by opening a screenshot instead of trusting a character count, which is the
same discipline the reports are held to: extracted text proves what a screen *says*, only a
rendered image proves what it *shows*.

---

## Reading these reports

Each report separates **divergences ruled against the APP** (real defects) from **divergences
ruled against the DRAWING** (stale design). That split matters more than the totals: a
divergence is not automatically an app defect, and on several files the drawing is the stale
half.

Where a report contradicts an entry in `design/FINDINGS.md`, the report states what it ran.
`FINDINGS` entries are claims to check, not evidence.
