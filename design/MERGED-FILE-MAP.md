# TutoringHQ - Merged file map

**103 screen files merged into 26.** Last rebuilt 25 July 2026. Every original is kept in `_originals/`; nothing was deleted.

Each merged file is one standalone HTML page: a title block, a table of contents, then one numbered section per screen. Every screen keeps its own CSS, scoped under a wrapper class so screens cannot restyle each other.

Every file opens with a comment block for whoever implements it, listing the screens inside and seven rules for reading the file. The one that matters most: **CSS is scoped, so `.mgd4 .pins` means `.pins`, and the `.mgdN` prefix must be stripped before the styles reach the codebase.**


## Public

Everything a stranger sees before signing in

| File | Screens | Size | ~Tokens | Contains |
|---|---|---|---|---|
| **Merged-Public-Marketing** | 4 | 150k | 46,616 | Public Landing · Public Audience · Public Pricing · Lead Capture |
| **Merged-Public-App** | 6 | 149k | 46,395 | Public Auth · Public Join · Public Self Enrollment · Parent Payment · Referral Landing · Offline |
| **Merged-Public-Legal** | 1 | 44k | 13,921 | Public Legal |

## Center

The owner and assistant portal

| File | Screens | Size | ~Tokens | Contains |
|---|---|---|---|---|
| **Merged-Center-Home** | 2 | 36k | 11,193 | Center Dashboard Verified · Notifications |
| **Merged-Center-Students** | 4 | 126k | 39,215 | Students (Roster) · Student Detail · Center Students Verified · Students Import Pending |
| **Merged-Center-Groups** | 5 | 131k | 40,950 | Groups · Center Groups Verified · Rooms · Branches · Schedule |
| **Merged-Center-Attendance** | 2 | 53k | 16,658 | Center Attendance Verified · Center Collect ForMe |
| **Merged-Center-Money** | 5 | 118k | 36,889 | Payments · Center Payments Verified · Billing · Center Withdrawal Verified · Center Receipts Verified |
| **Merged-Center-Insight** | 3 | 74k | 23,113 | Analytics · Benchmarks · Referrals |
| **Merged-Center-WhatsApp** | 3 | 59k | 18,431 | WhatsApp · WhatsApp Pack · WhatsApp Custom Flow |
| **Merged-Center-Orders** | 4 | 81k | 25,442 | Orders · Order Detail · Order Checkout · Card Orders Coming Soon |
| **Merged-Center-Setup** | 9 | 180k | 56,109 | Onboarding · Settings · Settings Billing · Settings Center · Settings Notifications Support · Settings Scanner · Settings Team · Center Team Verified · My Teachers |

## Teacher

The independent teacher portal

| File | Screens | Size | ~Tokens | Contains |
|---|---|---|---|---|
| **Merged-Teacher-Home** | 2 | 51k | 15,952 | Teacher Home · Teacher Schedule |
| **Merged-Teacher-Students** | 2 | 33k | 10,544 | Teacher Students · Teacher Student Detail |
| **Merged-Teacher-Groups** | 5 | 117k | 36,572 | Teacher Groups · Teacher Group Detail · Teacher Group Invite Pending · Teacher Class Session · Teacher Class Session Verified |
| **Merged-Teacher-Money** | 5 | 113k | 35,163 | Teacher Income · Teacher Earnings Calculator · Teacher Billing · Teacher Instant Payout · Teacher Collect Optin |
| **Merged-Teacher-Insight** | 2 | 64k | 19,890 | Teacher Analytics · Teacher Referrals |
| **Merged-Teacher-WhatsApp** | 1 | 27k | 8,533 | Teacher WhatsApp |
| **Merged-Teacher-Setup** | 2 | 70k | 21,846 | Teacher Settings · Teacher Centers |

## Admin and CEO

Internal only, never seen by a customer

| File | Screens | Size | ~Tokens | Contains |
|---|---|---|---|---|
| **Merged-Admin-Money** | 7 | 169k | 52,519 | Admin Fee Collection · Admin Settlement · Admin Finance Health · Admin Receipts · Admin Withdrawals Analytics · Admin Unpaid Recovery · Admin Billing Pricing |
| **Merged-Admin-Accounts** | 4 | 103k | 32,069 | Admin Account Detail · Admin Staff · Admin Center Assignments · Admin Referrals |
| **Merged-Admin-Platform** | 6 | 146k | 45,539 | Admin Overview · Admin Analytics · Admin Platform · Admin WhatsApp Pack · Admin Promo Codes · Admin Privacy Requests |
| **Merged-CEO** | 3 | 59k | 18,440 | CEO Dashboard · CEO Teachers · CEO Centers Benchmark |

## Shared

Surfaces that belong to more than one role

| File | Screens | Size | ~Tokens | Contains |
|---|---|---|---|---|
| **Merged-Lifecycle** | 6 | 71k | 22,194 | Lifecycle Access · Lifecycle States · Lifecycle Status · Center Resubscribe · Teacher Resubscribe · Coming Soon |
| **Merged-Verification-Payouts** | 6 | 111k | 34,735 | Settings Verification · Verification In Context · Payout Verification · Withdrawal Payout Details · Center Teacher Payouts · Receipts |
| **Merged-Design-Patterns** | 4 | 85k | 26,657 | Row action patterns · Quick menu rows · Group actions · Expand sheet merge |

## Totals

| | |
|---|---|
| Files | 26 |
| Screens | 103 |
| Largest | Merged-Center-Setup, 9 screens, ~56,000 tokens |
| Smallest | Merged-Teacher-WhatsApp, 1 screen, ~8,500 tokens |
| Every file fits a working context | yes, all under 60,000 tokens |

## Why Public is three files

Public was one 83,000 token file, too large to open and still have room to write code against it.
It split along a real seam:

- **Marketing** is the pages a stranger reads in a browser: landing, the two audience pages, pricing, and the lead capture form.
- **App** is what behaves like the app: sign up and log in, join by link, self enrollment by code, parent payment, referral landing, offline fallback.
- **Legal** is the four documents the footer opens plus the data rights form. Separate because a lawyer opens it alone and it changes with the law, not with marketing.

## Why the portals were not combined further

Combining the nine Center files into one produces a 257,000 token file, past the point where an
implementer can read it at all. The current shape keeps every file openable while still grouping
screens by the area a person actually works on.

## If you need to change one screen

Open the merged file, find the screen by its section bar, and edit inside its `mgdN` wrapper.
The original single screen is still in `_originals/` if you would rather work on it alone and re-merge.

## Naming

Five source files use spaces around the dash (`Screen - Groups`) rather than the house style.
They sit inside the merges, so the inconsistency does not show at the top level.
