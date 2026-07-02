# TutoringHQ — Full Platform Audit (plain-language report)

**Date:** 2 July 2026 · **Scope:** database, security, backend, frontend, and every money/data loophole a customer or attacker could use · **Method:** read-only inspection of the live database and the whole codebase. Nothing was changed, no migrations were run, the summer billing engine was only looked at, never triggered.

---

## The one-line answer

**Your daily loops work.** A center can sign up, add a teacher's group, add students, take QR attendance offline and sync it, record a fee, and message parents. A teacher can sign up, start a trial, create a group, attach to a center, and detach again without needing the center's permission. Both journeys run end-to-end today with no dead end.

**Your money is well-defended.** We went hunting for ways a customer could get free time, free money, or extra usage without paying — the referral farming, the credit tricks, the plan-switch round-trips, the teacher student-cap overage. We did not find a single open money loophole. The worst bug you ever had — the one that minted spendable wallet credit when a center downgraded — is confirmed dead and cannot come back without someone deliberately re-adding it.

**The real problems are data-exposure and privacy, not money.** The most dangerous findings are two ways for someone to read other centers' data, plus your legal/privacy paperwork being unfinished. None of them lets anyone steal money, but two of them leak personal information right now.

---

## The single most dangerous finding

**Any logged-in user can pull any other center's full staff list — names' roles and phone numbers — just by changing a number in a web address.** The staff-list feature trusts whatever center ID the browser sends instead of checking that you actually belong to that center. Since anyone can create a free account, and center IDs are not secret, one customer can quietly harvest the phone numbers of staff at every other center on the platform. This is a live cross-tenant privacy leak that needs no special access. It is a small, quick fix.

## Top 10 in priority order

1. **Staff-list leak (`/api/center-users`)** — any logged-in user reads any center's staff phones + roles. *Customer-exploitable alone.* Quick fix.
2. **Content-access log is world-readable** — a completely unauthenticated person (no login at all) can read the log of which student accessed which content, and when, across *every* center. *Exploitable by anyone.* Quick fix.
3. **Billing-figures leak (`/api/billing/payg-calculate`)** — sending a center ID with no login returns that center's pay-as-you-go billing numbers. No names, but it's an authentication bypass. *Exploitable by anyone.* Quick fix.
4. **Privacy policy and terms are placeholders** — the customer-facing legal pages still say "pending legal review." For an Egyptian platform handling minors' data under PDPL, shipping stub legal text is a compliance and trust risk. *Not exploitable, but a legal exposure.* Needs a lawyer, not a coder.
5. **Data-rights requests go into a black hole** — the privacy-request form works and saves requests, but there is no admin screen to see or action them, and no 30-day deadline tracking. People exercise their legal right to their data and nobody can respond. *Compliance gap.* Medium effort.
6. **Parent portal links live for a full year and can't be switched off** — the link WhatsApped to a parent exposes a child's name, attendance, balance and schedule for 12 months, is stored in plain text, and there is no way to revoke a leaked link early. *A forwarded link is the risk.* Medium effort.
7. **Financial audit trail can be quietly edited** — the commission audit log (a money record) can be changed or deleted by a super-admin with no lock, unlike your main audit log which is properly frozen. *Needs insider access.* Medium effort.
8. **Deleting a center or student wipes its financial and audit history** — several money/audit tables are wired to cascade-delete, so a hard delete silently destroys payments, invoices, commissions and audit records instead of preserving them. *Needs insider/admin action.* Medium effort.
9. **The database doesn't stop negative money** — about 85 money columns (payments, invoices, commissions, credit) have no "must be ≥ 0" guard, so a bug anywhere upstream could write a negative amount and the database would accept it. *Not directly exploitable, a safety net that's missing.* Medium effort.
10. **Your code and your live database have drifted apart** — the repo only contains the last few weeks of database migrations; everything older exists only in the live database. And a migration meant to remove the old `pin_code` login column was written but never applied, so that column still exists in production. *Operational risk if you ever rebuild.* Medium effort.

Everything below the top 10 is either polish (unreachable pages, duplicate database indexes, cosmetic cron-monitoring drift) or already-correct-and-verified (webhooks, secrets handling, rate limiting, card-data storage, CSRF).

---

## What we checked and found solid (so you can sleep)

- **No open money loophole.** All nine plan-switching guardrails hold; downgrades only take effect at renewal and never mint credit; upgrades only activate after payment clears; the teacher student-cap overage math is exactly right (a 130-student Scale teacher gets billed correctly as two separate invoices); referrals can't be farmed by self-referral or recycled sign-ups; promo codes are single-use; credit can't go negative or be withdrawn improperly; the summer free window can't be tricked into an early charge and its first-charge gate is still switched off ("HELD").
- **Payment plumbing is safe.** The steps that touch money are wrapped so they either fully happen or fully undo; there are proper guards so a payment can't be recorded twice; the nightly reconciliation with Paymob only ever corrects in the one safe direction and leaves everything else for a human.
- **Attackers are kept out of the usual doors.** Webhooks (Paymob, WhatsApp, Bosta) all verify their signatures before doing anything. No secret keys leak into the browser. Every scheduled job is password-protected. There's no place that runs arbitrary database commands. No cross-site-scripting holes in the parts users can influence. Public forms and one-time-code endpoints are rate-limited.
- **Card data is stored correctly** — only the payment provider's token and the last 4 digits, never the full card number, and only after explicit consent.
- **The brand is clean** — no customer-facing screen, message, or email leaks the internal "CenterHQ" name; users only ever see "TutoringHQ."
- **Right-to-left Arabic layout and number/date formatting** follow the rules everywhere in the app.

---

## Bottom line for you

Nothing here is an emergency that puts money at risk tonight. But items 1–3 are leaking data right now and are all fast fixes — those should be first. Items 4 and 5 (legal pages, data-rights handling) matter because you serve minors under Egyptian privacy law, and they need decisions from you, not just code. The rest is a healthy backlog of hardening and cleanup for a platform that is, underneath, in genuinely strong shape.

*Full technical detail with file names, line numbers and database queries is in the companion file `AUDIT_2026-07-02_TECHNICAL.md`.*
