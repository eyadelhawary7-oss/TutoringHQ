# Merged file map

**25 files. 110 screens. 503 frames.** Regenerated 6 August 2026, after the InstaPay model
replaced online collection.

**Every screen exists in both English and Arabic. Not every state does.** Some states were only ever
drawn in English, so the two languages are not a 1:1 split of the frame count. Measured across the
set on 6 August 2026: **503 frames, 284 English and 219 Arabic, 1.30:1.** Per-file ratios vary widely
and `Center-Groups` (14:4) and `Center-Students` (11:3) are outliers, not the norm.

Do not read a frame count as "half of these are Arabic".

---

## The files

| File | Screens | Frames | Contents |
|---|---|---|---|
| `Merged-Admin-Accounts.html` | 4 | 16 | Admin Account Detail, Admin Staff, Admin Center Assignments, Admin Referrals |
| `Merged-Admin-Money.html` | 6 | 25 | Admin Fee Collection, Admin Settlement, Admin Finance Health, Admin Receipts, Admin Unpaid Recovery, Admin Billing Pricing |
| `Merged-Admin-Platform.html` | 6 | 26 | Admin Overview, Admin Analytics, Admin Platform, Admin WhatsApp Pack, Admin Promo Codes, Admin Privacy Requests |
| `Merged-CEO.html` | 3 | 12 | CEO Dashboard, CEO Teachers, CEO Centers Benchmark |
| `Merged-Center-Attendance.html` | 2 | 13 | Center Attendance, Attendance Payment Default |
| `Merged-Center-Groups.html` | 4 | 18 | Groups, Rooms, Branches, Schedule |
| `Merged-Center-Home.html` | 3 | 8 | Center Dashboard, Notifications, Active Balance |
| `Merged-Center-Insight.html` | 3 | 13 | Analytics, Benchmarks, Referral Program |
| `Merged-Center-Money.html` | 13 | 51 | Payments, Center Payments, Billing, Center Receipts, InstaPay Invoice, InstaPay Uploaded Receipts, InstaPay Confirm, InstaPay Batch List, InstaPay Duplicate Reference, InstaPay Fee Total, Active Balance, Send Credit, Balance History |
| `Merged-Center-Orders.html` | 4 | 15 | Orders, Order Detail, Order Checkout, Card Orders Coming Soon |
| `Merged-Center-Setup.html` | 10 | 41 | Onboarding, Settings, Settings Billing, Settings Center, Settings Notifications Support, Settings Scanner, Settings Team, Center Team, My Teachers, InstaPay Settings |
| `Merged-Center-Students.html` | 3 | 14 | Students (Roster), Student Detail, Students Import Pending |
| `Merged-Center-WhatsApp.html` | 3 | 12 | WhatsApp, WhatsApp Pack, WhatsApp Custom Flow |
| `Merged-Design-Patterns.html` | 6 | 44 | Empty States, Loading States, Row action patterns, Quick menu rows, Group actions, Expand sheet merge |
| `Merged-Lifecycle.html` | 6 | 18 | Lifecycle Access, Lifecycle States, Lifecycle Status, Center Resubscribe, Teacher Resubscribe, Coming Soon |
| `Merged-Public-App.html` | 6 | 62 | Public Auth, Public Join, Public Self Enrollment, InstaPay Upload, Referral Landing, Offline |
| `Merged-Public-Legal.html` | 1 | 14 | Public Legal |
| `Merged-Public-Marketing.html` | 4 | 12 | Public Landing, Public Audience, Public Pricing, Lead Capture |
| `Merged-Teacher-Groups.html` | 4 | 17 | Teacher Groups, Teacher Group Detail, Teacher Group Invite Pending, Teacher Class Session |
| `Merged-Teacher-Home.html` | 3 | 10 | Teacher Home, Teacher Schedule, Active Balance |
| `Merged-Teacher-Insight.html` | 2 | 8 | Teacher Analytics, Referral Program |
| `Merged-Teacher-Money.html` | 9 | 36 | Teacher Income, Teacher Earnings Calculator, InstaPay Uploaded Receipts, InstaPay Batch List, InstaPay Fee Total, Active Balance, Send Credit, Balance History, Teacher Billing |
| `Merged-Teacher-Setup.html` | 2 | 8 | Teacher Settings, Teacher Centers |
| `Merged-Teacher-Students.html` | 2 | 4 | Teacher Students, Teacher Student Detail |
| `Merged-Teacher-WhatsApp.html` | 1 | 6 | Teacher WhatsApp |

---

## How to read a merged file

**CSS is scoped with `.mgdN`.** Strip it. It never reaches code.

**One section is one screen.** The bar above each section carries its number, name, and the source
file it came from.

**Frames are states, not pages.** Four frames under one screen usually means two states in two
languages, not four screens.

**The two languages are separate screens, not a toggle.** Arabic frames mirror in RTL, use Eastern
Arabic numerals, and drop IBM Plex Mono in favour of weight 600. Do not build one and flip it.

**Sample data is placeholder.** Names, amounts, and dates are illustrative. Never ship them.

**Any UI change bumps `SW_VERSION` in `public/sw.js`.**

---

## What changed on 6 August

`Merged-Verification-Payouts.html` was **deleted**. Identity verification and platform payouts both
ceased to exist when tuition stopped passing through the platform.

Three files gained screens:

- **Center-Attendance** gained the InstaPay default and the one-way lock states.
- **Center-Money** and **Teacher-Money** gained the InstaPay flow, the credit balance, sending
  credit, and the balance ledger.
- **Public-App** gained the parent upload page and lost the card checkout.

`Merged-Center-Insight` and `Merged-Teacher-Insight` gained the referral programme.

---

## The six protected files

These carry money or auth. They never auto-merge and every PR comes to Eyad regardless of size.

`Merged-Public-App` · `Merged-Center-Money` · `Merged-Teacher-Money` · `Merged-Admin-Money` ·
`Merged-Lifecycle` · `Merged-Design-Patterns`

`Merged-Verification-Payouts` was the seventh and no longer exists.
