# Working rules

**6 August 2026.** The facts and habits that are not in any design file and are expensive to
rediscover.

---

## The project

**TutoringHQ**, an Arabic-first RTL SaaS for Egyptian tutoring centers and independent teachers.

| | |
|---|---|
| Customer-facing domain | `tutoringhq.app` |
| Repo | `eyadelhawary7-oss/CenterHQ` (internal name is still CenterHQ) |
| Vercel project | `center-hq`, `master` auto-deploys |
| Supabase project | `lczmjpnbuhnsislcvzar`, eu-west-2 |
| Auth email suffix | `@centerhq.local` |
| Support and business phone | +20 106 4668885 |
| Company | EHG Intelligence Egypt, GAFI LLC |
| Legal counsel | Adsero |

**Pre-launch.** No real customers. Two test centers, both `is_test = true`. Paymob in test mode.
Nothing charges anyone.

---

## Database rules, each learned the hard way

**Schema truth comes from catalog introspection only.** `information_schema.columns`,
`pg_constraint`, `pg_policies`, `pg_proc`. Never from migration files, never from documentation, and
never from the migration ledger, which has been confirmed to hold rows for migrations that were
never applied.

**One SELECT per Supabase MCP call.** A multi-statement block silently drops every result but the
last. That is not an error you will see; it is an answer that is quietly wrong.

**`NOTIFY pgrst, 'reload schema'` after every DDL block.** A stale PostgREST cache caused silent
production failures. The DDL succeeds, the app keeps using the old shape, and nothing complains.

**Merging is not applying.** A migration merged to `master` is a file in a folder. It reaches
production only when someone applies it. This has bitten twice.

**Verify after applying, against the catalog.** Not against the migration file, not against the fact
that the statement returned without error.

**Phantom columns are the root cause of most bugs here.** `students.balance_due` never existed, code
selected it anyway, PostgREST returned 400 for the whole query and fifteen screens went dark.
Confirm a column exists before any route ships.

---

## Money rules

**No refunds. Ever.** There is no `refunded` status. A correction becomes credit.

**All prices are VAT-inclusive.**

**20 EGP processing fee** on every platform invoice, VAT inclusive.

**Commission base is revenue, price divided by 1.14.** Never hardcoded.

**Rate and loyalty are stamped per cohort at close.** No retroactive recalculation, ever.

**Group billing is `fee_per_class` only.** Per-session, monthly and bundle-of-N do not exist.

**Lockout:** a center locks at 11:59 PM on the day of an unpaid invoice. A teacher drops to free
tier. Both are inert until Paymob leaves test mode.

---

## Sales commission

Flat-rate ladder: **10, 20, 30, 40, 40, 50 percent** with loyalty tiers. Stamped per cohort at
close. The team leader earns an override on rep tier 1, tier 2 and loyalty.

**House accounts:** a signup from marketing with no live rep claim earns no commission. The lead
form at `/talk-to-us` auto-creates a claim for the territory rep, and a claim lapses after 5 days
with no logged contact.

Sales team leader started August. Reps onboarding September.

This is separate from **referral commission**, which is the customer-facing 25/10/5 recurring
percentage. Two different systems, do not conflate them.

---

## Working with Eyad

**He plans in chat, Claude Code executes in a terminal, he reviews and merges.**

**He merges PRs on GitHub mobile using the green button at the bottom of the Conversation tab
only.** The merge-line buttons at the top have caused accidental reversions.

**He applies migrations himself**, and has direct Supabase access from chat.

**All money and auth PRs come to him**, regardless of size. So do all migrations.

**He wants short, plain answers.** No jargon, no em dashes, no lengthy explanation. Honest pushback
is expected and welcomed.

**He makes the final call on money, legal and brand.** Surface the tradeoffs, take a position, then
execute once he decides.

---

## Build discipline

**Any UI change bumps `SW_VERSION` in `public/sw.js`.** It must exceed what production serves, not
increment per PR. Two PRs at the same version merge cleanly; a PR that jumps ahead conflicts.

**No automated process touches production unattended.**

**One writer per file**, regardless of how many sections that file holds.

**A shared primitive belongs in foundations.** If the same fix is needed in more than three files,
stop and say so rather than repeating it.

**Design files are authoritative.** A screen must be visually identical to its design, not merely
structurally similar. Omission is acceptable for missing data, never for missing effort.

---

## The failure patterns worth knowing

Every serious bug found in this codebase has been one of two shapes.

**One number with two sources.** A monthly price computed five ways. Two referral tables disagreeing
about what is owed. Two `EmptyState` components. Two teal palettes. `students.payment_status`
alongside a real balance calculation. When something looks wrong, ask what else computes it.

**A check that measures the wrong thing.** A grep matching a name rather than an import. A gate
comparing a rebuild to a snapshot where neither is production. A pay window anchored to a date that
had already passed. `substring(-11)` returning the whole string when the string is shorter than 11.
A count taken after rows were dropped and presented as the input.

Both are invisible until someone checks the thing itself rather than the report about it.

---

## The stack

Next.js, React, Tailwind v4, TypeScript. Supabase for Postgres and auth. Vercel for hosting, with
`master` auto-deploying. Upstash Redis for rate limiting. Meta WhatsApp Cloud API. Bosta for courier,
which only matters once card orders unpark.

---

## Tenant isolation, and it is not what it looks like

**RLS is live but it is not what protects you.** The policies read `auth.uid()` through
`get_auth_center_id()`, and `anon` and `authenticated` both have `rolbypassrls = false`. So RLS is a
real, reachable boundary for anything holding the anon key.

**But the service-role client bypasses it entirely**, and most server routes use service role.

**What actually enforces tenant isolation is application code**: `centerAuth.ts`,
`requireOwnerAdminCenter.ts` and `dbProxyScope.ts`, each deriving the center from the session rather
than from anything the client sends.

That was audited on 5 August and came back clean: no route takes a center identifier from a request
parameter and trusts it. But **it holds by convention.** A new route that forgets the filter is
caught by no policy, no test and no type error. It simply returns another center's data.

**So the posture is defence in depth with application code as the load-bearing layer.** Anyone
auditing this, including a penetration tester, will find that in an hour. Say it plainly rather than
implying the database enforces it.

Two durable fixes are logged and neither is built: per-family cross-tenant denial tests, and moving
the remaining service-role reads back behind RLS.

---

## CI gates

Eight real checks: build, lint, type-check, unit tests, E2E smoke, security audit, i18n namespace
parity, and schema drift. Supabase preview and informational Playwright skip on most PRs, correctly.

**`schema-drift` compares a rebuild against `db/schema.snapshot`, and neither side is production.**
That means it can confirm a `GRANT` landed and can say nothing at all about whether a `REVOKE`
achieved anything on the live database. Any grant or revoke change needs a live catalog check;
green here is not evidence for it.

**Never edit or skip a test to reach green.** A test edited to pass is how the upgrade-route fault
survived for months.

**Regenerate the snapshot after any DDL**, or schema drift fails on the next PR for a reason that
looks unrelated.

---

## Branches and PRs

One branch per screen area, named for what it does. Work is pushed before a container restart can
lose it, since containers have died mid-run three times.

**PRs stop at open plus green.** Agents do not merge. A PR touching money, auth, account state or a
protected file comes to Eyad regardless of size.

**A branch sitting at an old SHA after a squash merge is not an open PR.** Check merge state against
`master` with `git log`, never against a branch head or an API field.

---

## Things that exist and are easy to miss

**QR attendance.** Scanning a printed QR ID card at the door is a real path alongside the checklist.
Cards are ordered through the platform, which is the parked card-orders revenue stream.

**Parent portal tokens.** `parent_portal_tokens` exists with expiry and revocation. Short-lived
revokable links are how a parent reaches anything without an account.

**PIN is the primary login.** Phone plus a six-digit PIN, with lockout counters. Not a password.

**Global app chrome is out of scope for the redesign.** The hamburger, top bar and bottom tab bar
live in a root layout and appear in no merged design file. That is a deliberate boundary, not a gap,
and it has been re-raised twice.

---

## Before the receipt reader ships

**It needs an accuracy test against real screenshots, not sample data.** The spec puts this before
launch deliberately, and it should not be compressed.

The reader returns structured fields and never sees database contents. That boundary is what keeps
the extraction step contained, and it should stay that way.

A reader that is confidently wrong is worse than one that fails, because a confident wrong amount
gets confirmed by a tired person at 9pm.
